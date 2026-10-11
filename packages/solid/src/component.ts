import {
  eraseRuntime,
  makeRuntime,
  ResourceFailure,
  RuntimeTypeId,
  type AnySunfallArcRuntime,
  type Resource,
  type ResourceRef,
  type ResourceStoreModule,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { Cause, Context, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { AsyncResult } from "effect/reactivity";
import { pipeArguments, type Pipeable } from "effect/Pipeable";
import {
  createComponent,
  createMemo,
  createRoot,
  Errored,
  getOwner,
  Loading,
  onCleanup,
  runWithOwner,
  type Accessor,
} from "solid-js";
import { render as renderSolid, type JSX } from "@solidjs/web";
import { createResourceSuspense } from "./resource-binding.js";
import { RuntimeProvider, useRuntime } from "./runtime.js";

const ComponentTypeId = "~@sunfall/arc-solid/Component";

/**
 * A typed Solid component definition: `P` props, `E` typed render failures,
 * `R` services its setup needs.
 *
 * JSX erases types (every element is `JSX.Element`), so services and failures
 * flow through definitions instead: inside another component's setup,
 * `yield* Child` adds the child's `E` and `R` to the parent and returns a plain
 * Solid component `(props: P) => JSX.Element`.
 *
 * `E` is phantom at the Effect level: yielding a component never fails. A
 * failing setup, a failing provided Layer, or a failed `Component.resource`
 * read surfaces when the component *renders*, by throwing to the nearest Solid
 * `<Errored>` boundary, which is where `Component.catchTags` handles it.
 *
 * Two phases:
 * - **setup** (the generator body) runs once per Arc runtime, not per instance.
 *   It resolves services, binds resources, and may register finalizers; its
 *   Scope lives as long as the runtime and closes on runtime disposal.
 * - **render** (the returned function) runs per instance under a Solid owner,
 *   like any Solid component. Keep per-instance state here.
 *
 * @example
 * ```tsx
 * const ProjectCard = Component.make("ProjectCard", function* () {
 *   const project = yield* Component.resource(ProjectById);
 *   return (props: { readonly id: string }) => <article>{project(props.id).name}</article>;
 * });
 * ```
 */
export interface Component<in P, out E = never, out R = never> extends Pipeable {
  readonly [ComponentTypeId]: {
    readonly _P: (props: P) => void;
    readonly _E: () => E;
    readonly _R: () => R;
  };
  /** Display name, used for diagnostics. */
  readonly name: string;
  [Symbol.iterator](): Effect.EffectIterator<Effect.Effect<Component.Render<P>, E, R>>;
}

interface ComponentImpl<P, E, R> extends Component<P, E, R> {
  /** Real setup: services `R` plus the runtime-lifetime setup `Scope`. */
  readonly setup: Effect.Effect<Component.Render<P>, E, R | Scope.Scope>;
}

type AnyComponent = Component<any, any, any>;

/** Runtime a setup runs in; provided by the host, read by `Component.resource`. */
const SetupRuntime = Context.Reference<AnySunfallArcRuntime<unknown> | undefined>(
  "@sunfall/arc-solid/Component/SetupRuntime",
  { defaultValue: () => undefined },
);

const impl = <P, E, R>(component: Component<P, E, R>): ComponentImpl<P, E, R> =>
  component as ComponentImpl<P, E, R>;

/** Instantiates a render function as a Solid component (untracked, under its own owner). */
const instantiate = <P>(render: Component.Render<P>, props: P): JSX.Element =>
  createComponent(
    render as (props: Record<string, any>) => JSX.Element,
    props as Record<string, any>,
  );

const failedRender =
  (error: unknown): Component.Render<any> =>
  () => {
    throw error;
  };

/**
 * Runs a setup and turns its failure into a render that throws, so the failure
 * reaches Solid boundaries (and `catchTags`) instead of failing the parent's
 * setup. Interruption still propagates.
 */
const prepare = <P, E, R>(
  component: Component<P, E, R>,
): Effect.Effect<Component.Render<P>, never, R | Scope.Scope> =>
  Effect.flatMap(Effect.exit(impl(component).setup), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : Cause.hasInterruptsOnly(exit.cause)
        ? Effect.failCause(exit.cause as Cause.Cause<never>)
        : Effect.succeed(failedRender(Cause.squash(exit.cause))),
  );

const ComponentProto = {
  [ComponentTypeId]: {
    _P: (_: unknown) => undefined,
    _E: () => undefined,
    _R: () => undefined,
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  [Symbol.iterator](this: AnyComponent) {
    return prepare(this)[Symbol.iterator]();
  },
};

const makeComponent = <P, E, R>(
  name: string,
  setup: Effect.Effect<Component.Render<P>, E, R | Scope.Scope>,
): Component<P, E, R> =>
  Object.assign(Object.create(ComponentProto) as ComponentImpl<P, E, R>, { name, setup });

const mapRender = <P, E, R>(
  self: Component<P, E, R>,
  f: (render: Component.Render<P>) => Component.Render<P>,
): Component<P, E, R> => makeComponent(self.name, Effect.map(prepare(self), f));

// ---------------------------------------------------------------------------
// Runtime host: per-runtime setup memo, owned by the runtime's Resource Store
// ---------------------------------------------------------------------------

interface HostEntry {
  /** Fails only with the runtime's own startup error (`ER`), or is interrupted. */
  readonly fiber: Fiber.Fiber<Component.Render<any>, unknown>;
  waiters: number;
}

interface Host extends ResourceStoreModule {
  readonly scope: Scope.Closeable;
  readonly entries: Map<AnyComponent, HostEntry>;
}

const HostKey: unique symbol = Symbol.for("@sunfall/arc-solid/Component/Host");

/** One host per runtime (Resource Store); store disposal interrupts setups and closes their Scope. */
const hostFor = (runtime: AnySunfallArcRuntime<unknown>): Host => {
  const registry = runtime.resourceStore.moduleRegistry;
  const existing = registry.get(HostKey) as Host | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const scope = Scope.makeUnsafe();
  const entries = new Map<AnyComponent, HostEntry>();
  const host: Host = {
    scope,
    entries,
    disposeEffect: Effect.suspend(() => {
      const fibers = Array.from(entries.values(), (entry) => entry.fiber);
      entries.clear();
      return Effect.andThen(Fiber.interruptAll(fibers), Scope.close(scope, Exit.void));
    }),
  };
  registry.register(HostKey, host);
  return host;
};

/**
 * Starts (or reuses) the setup of a root component in `runtime`. Each root
 * setup gets a child of the runtime's setup Scope: it is closed right away if
 * setup fails or is interrupted, and otherwise lives until runtime disposal.
 */
const setupFor = (component: AnyComponent, runtime: AnySunfallArcRuntime<unknown>): HostEntry => {
  const host = hostFor(runtime);
  const existing = host.entries.get(component);
  if (existing !== undefined) {
    return existing;
  }
  const scope = Scope.forkUnsafe(host.scope);
  const setup = Effect.gen(function* () {
    const exit = yield* Effect.exit(impl(component).setup);
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    yield* Scope.close(scope, exit);
    return Cause.hasInterruptsOnly(exit.cause)
      ? yield* Effect.failCause(exit.cause as Cause.Cause<never>)
      : failedRender(Cause.squash(exit.cause));
  }).pipe(
    Effect.provideService(Scope.Scope, scope),
    Effect.provideService(SetupRuntime, runtime),
    // An interrupted setup is forgotten, so the next mount runs it again.
    Effect.onInterrupt(() =>
      Effect.andThen(
        Effect.sync(() => {
          if (host.entries.get(component) === entry) {
            host.entries.delete(component);
          }
        }),
        Scope.close(scope, Exit.void),
      ),
    ),
  );
  const entry: HostEntry = {
    fiber: runtime.runFork(setup),
    waiters: 0,
  };
  host.entries.set(component, entry);
  return entry;
};

/** Awaits a root setup; interrupting the last waiter interrupts a still-running setup. */
const awaitSetup = <P, ER>(
  component: Component<P, never, never>,
  runtime: AnySunfallArcRuntime<unknown>,
): Effect.Effect<Component.Render<P>, ER> =>
  Effect.suspend(() => {
    const entry = setupFor(component, runtime);
    entry.waiters++;
    return (Fiber.join(entry.fiber) as Effect.Effect<Component.Render<P>, ER>).pipe(
      Effect.onExit((exit) =>
        Effect.suspend(() => {
          entry.waiters--;
          return Exit.isFailure(exit) &&
            entry.waiters === 0 &&
            entry.fiber.pollUnsafe() === undefined
            ? Fiber.interrupt(entry.fiber)
            : Effect.void;
        }),
      ),
    );
  });

/** Host token Solid awaits while an embedded component's setup is still running. */
const setupRenderToken = <P>(fiber: Fiber.Fiber<Component.Render<P>, unknown>) =>
  Effect.runPromise(Fiber.join(fiber));

const renderFromExit = <P>(exit: Exit.Exit<Component.Render<P>, unknown>): Component.Render<P> =>
  Exit.isSuccess(exit) ? exit.value : failedRender(Cause.squash(exit.cause));

// ---------------------------------------------------------------------------
// Resource reads
// ---------------------------------------------------------------------------

/** A runtime view whose effects also see the setup's context (provided Layers and services). */
const withSetupContext = (
  runtime: AnySunfallArcRuntime<unknown>,
  context: Context.Context<never>,
): AnySunfallArcRuntime<unknown> => {
  const withContext = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
    Effect.provideContext(effect, context as Context.Context<R>) as Effect.Effect<A, E>;
  return {
    [RuntimeTypeId]: RuntimeTypeId,
    managed: runtime.managed,
    resourceStore: runtime.resourceStore,
    disposeEffect: runtime.disposeEffect,
    provide: (effect, options) => runtime.provide(withContext(effect), options),
    runFork: (effect, options) => runtime.runFork(withContext(effect), options),
    runSync: (effect) => runtime.runSync(withContext(effect)),
  };
};

interface ResourceReaderEntry<A> {
  readonly read: Accessor<A>;
  readonly dispose: () => void;
  users: number;
}

/**
 * Render-time reader shared by every instance in one runtime. Each ref key gets
 * one fiber-backed async memo in a detached Solid root, reference-counted by
 * the owners that read it and disposed when the last one cleans up.
 */
const makeResourceReader = <I, A, E, R>(
  runtime: AnySunfallArcRuntime<unknown>,
  family: (input: I) => ResourceRef<I, A, E, R>,
) => {
  const entries = new Map<string, ResourceReaderEntry<A>>();
  const read = (input: I): A => {
    const ref = family(input);
    let entry = entries.get(ref.key);
    if (entry === undefined) {
      const created = runWithOwner(null, () =>
        createRoot(
          (dispose): ResourceReaderEntry<A> => ({
            read: createResourceSuspense(runtime, ref),
            dispose,
            users: 0,
          }),
        ),
      );
      entries.set(ref.key, created);
      entry = created;
    }
    if (getOwner() !== null) {
      const current = entry;
      current.users++;
      onCleanup(() => {
        current.users--;
        if (current.users === 0 && entries.get(ref.key) === current) {
          entries.delete(ref.key);
          current.dispose();
        }
      });
    }
    return entry.read();
  };
  const dispose = (): void => {
    const current = Array.from(entries.values());
    entries.clear();
    for (const entry of current) {
      entry.dispose();
    }
  };
  return { read, dispose };
};

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

type Tags<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;

const tagOf = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly _tag?: unknown })._tag === "string"
    ? (value as { readonly _tag: string })._tag
    : undefined;

/** Server-safe empty render for Solid's `render` target type. */
type MountTarget = Parameters<typeof renderSolid>[1];

type MountArgs<P, RuntimeServices, ER> = {} extends P
  ? [options?: Component.MountOptions<P, RuntimeServices, ER>]
  : [options: Component.MountOptions<P, RuntimeServices, ER> & { readonly props: P }];

/** Typed Solid component definitions; see {@link Component}. */
export namespace Component {
  /** Plain Solid component a `Component<P, E, R>` renders as. */
  export type Render<P> = (props: P) => JSX.Element;

  /** Props of a render function: `{}` when it takes none. */
  export type PropsOf<F> = F extends () => unknown
    ? {}
    : F extends (props: infer P) => unknown
      ? P
      : never;

  /** Typed failures accumulated by a setup generator. */
  export type ErrorOf<Eff> = [Eff] extends [never]
    ? never
    : Eff extends Effect.Effect<infer _A, infer E, infer _R>
      ? E
      : never;

  /** Services accumulated by a setup generator; the runtime-lifetime `Scope` is always provided. */
  export type ServicesOf<Eff> = [Eff] extends [never]
    ? never
    : Exclude<Eff extends Effect.Effect<infer _A, infer _E, infer R> ? R : never, Scope.Scope>;

  /** Handlers accepted by `catchTags`: only tags the component can fail with. */
  export type Handlers<E> = {
    readonly [Tag in Tags<E>]?: (
      error: Extract<E, { readonly _tag: Tag }>,
      reset: () => void,
    ) => JSX.Element;
  };

  /** Options for `Component.mount`. */
  export interface MountOptions<P, RuntimeServices = never, ER = never> {
    /**
     * Host-owned runtime to mount into. Omit it to let the mount own a fresh
     * runtime, disposed when the mount's Scope closes. Services still come from
     * `Component.provide`; this only shares Resource Store state and lifetime.
     * Its startup failures (`ER`) fail the mount.
     */
    readonly runtime?: SunfallArcRuntime<RuntimeServices, ER> | AnySunfallArcRuntime<ER>;
    /** Root props; required when the root component has required props. */
    readonly props?: P;
  }

  /**
   * Defines a component from a setup generator that returns its render function.
   *
   * `yield*` services, resources, and child components in setup; their failures
   * and services accumulate into the component's `E` and `R`. Setup runs once
   * per Arc runtime; the returned render function runs per instance.
   *
   * @example
   * ```tsx
   * const Dashboard = Component.make("Dashboard", function* () {
   *   const Card = yield* ProjectCard.pipe(
   *     Component.catchTags({ ProjectNotFound: () => <p>Gone</p> }),
   *     Component.loading(() => <Spinner />),
   *   );
   *   return () => <Card id={selected()} />;
   * });
   * ```
   */
  export const make = <
    Eff extends Effect.Effect<any, any, any>,
    Rendered extends (props: any) => JSX.Element,
  >(
    name: string,
    body: () => Generator<Eff, Rendered, never>,
  ): Component<PropsOf<Rendered>, ErrorOf<Eff>, ServicesOf<Eff>> =>
    makeComponent(name, Effect.gen(body) as Effect.Effect<Render<any>, any, any>);

  /**
   * Binds a Resource family in setup and returns a render-time reader.
   *
   * The family's load error joins the component's `E` and its services join
   * `R` (satisfied by the setup's context, including `Component.provide`).
   * Reading a pending value suspends the nearest Solid `<Loading>`; a failed
   * load throws `ResourceFailure` (its `result` holds the failure `Cause`) to
   * the nearest `<Errored>`, which `catchTags` matches by the typed error's `_tag`. Reads share the
   * fiber-backed async memo of `useResourceSuspense`.
   */
  export const resource = <I, A, E, R>(
    family: (input: I) => ResourceRef<I, A, E, R>,
  ): Effect.Effect<(input: I) => A, Resource.LoadError<E>, R> =>
    Effect.gen(function* () {
      const runtime = yield* SetupRuntime;
      if (runtime === undefined) {
        return yield* Effect.die(
          new Error("Component.resource(...) must be yielded inside a Component setup."),
        );
      }
      const context = yield* Effect.context<never>();
      const reader = makeResourceReader(withSetupContext(runtime, context), family);
      yield* Effect.addFinalizer(() => Effect.sync(reader.dispose));
      return reader.read;
    }) as Effect.Effect<(input: I) => A, never, R>;

  /**
   * Handles typed render failures by `_tag`, removing them from `E`.
   *
   * Only tags in `E` are accepted, and each handler receives exactly that
   * member of `E` plus Solid's boundary `reset`. At runtime the render is
   * wrapped in a Solid `<Errored>`; a `ResourceFailure` is matched by the
   * `_tag` of `AsyncResult.error(failure.result)`. Unmatched failures (including
   * defects) rethrow to the next outer boundary.
   */
  export const catchTags =
    <
      E,
      const H extends Handlers<E> & {
        readonly [Tag in Exclude<keyof H, Tags<E>>]: never;
      },
    >(
      handlers: H,
    ) =>
    <P, R>(self: Component<P, E, R>): Component<P, Exclude<E, { readonly _tag: keyof H }>, R> =>
      mapRender(
        self,
        (render) => (props) =>
          createComponent(Errored, {
            fallback: (error, reset) => {
              const thrown = error();
              // A ResourceFailure matches by its typed error; defects and
              // interruptions carry no `_tag` and rethrow.
              const target =
                thrown instanceof ResourceFailure
                  ? Option.getOrUndefined(AsyncResult.error(thrown.result))
                  : thrown;
              const tag = tagOf(target);
              const handler =
                tag !== undefined && Object.hasOwn(handlers, tag)
                  ? (
                      handlers as Record<string, (error: unknown, reset: () => void) => JSX.Element>
                    )[tag]
                  : undefined;
              if (handler === undefined) {
                throw thrown;
              }
              return handler(target, reset);
            },
            get children() {
              return instantiate(render, props);
            },
          }),
      ) as Component<P, any, R>;

  /** Shows `fallback` while reads inside the render are pending (a Solid `<Loading>`). Type-neutral. */
  export const loading =
    (fallback: () => JSX.Element) =>
    <P, E, R>(self: Component<P, E, R>): Component<P, E, R> =>
      mapRender(
        self,
        (render) => (props) =>
          createComponent(Loading, {
            get fallback() {
              return fallback();
            },
            get children() {
              return instantiate(render, props);
            },
          }),
      );

  /**
   * Provides services to the component's setup (and its resource loads),
   * removing `ROut` from `R`.
   *
   * The Layer is built once per runtime in the setup Scope, so scoped services
   * live until the runtime is disposed. Layer failures join `E` and render like
   * any other setup failure.
   */
  export const provide =
    <ROut, LE, RIn>(layer: Layer.Layer<ROut, LE, RIn>) =>
    <P, E, R>(self: Component<P, E, R>): Component<P, E | LE, Exclude<R, ROut> | RIn> =>
      makeComponent(
        self.name,
        Effect.flatMap(Layer.build(layer), (context) =>
          Effect.provideContext(impl(self).setup, context),
        ),
      ) as Component<P, E | LE, Exclude<R, ROut> | RIn>;

  /**
   * Mounts a fully provided, fully handled component into a DOM container.
   *
   * Only `Component<P, never, never>` is accepted: every service provided and
   * every typed failure handled. The result is a scoped acquisition, the
   * Effect-native shape for "something that lives until released": the Solid
   * tree (and an owned runtime) stay mounted while the caller's `Scope` is open
   * and are disposed, tree first, when it closes. Setup completes before the
   * first render; interrupting the mount while setup runs interrupts the setup
   * and renders nothing.
   *
   * @example
   * ```ts
   * Component.mount(App.pipe(Component.provide(AppLive)), root).pipe(
   *   Effect.andThen(Effect.never),
   *   Effect.scoped,
   *   Effect.runFork,
   * );
   * ```
   */
  export const mount = <P, RuntimeServices = never, ER = never>(
    component: Component<P, never, never>,
    container: MountTarget,
    ...[options]: MountArgs<P, RuntimeServices, ER>
  ): Effect.Effect<void, ER, Scope.Scope> =>
    Effect.gen(function* () {
      const runtime: AnySunfallArcRuntime<unknown> =
        (options?.runtime === undefined ? undefined : eraseRuntime(options.runtime)) ??
        (yield* Effect.acquireRelease(
          Effect.sync(() => eraseRuntime(makeRuntime())),
          (owned) => owned.disposeEffect.pipe(Effect.ignore({ log: true })),
        ));
      const render = yield* awaitSetup<P, ER>(component, runtime);
      const props = (options?.props ?? {}) as P;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          renderSolid(
            () =>
              createComponent(RuntimeProvider, {
                runtime,
                get children() {
                  return instantiate(render, props);
                },
              }),
            container,
          ),
        ),
        (dispose) => Effect.sync(dispose),
      );
    });

  /**
   * Embeds a fully provided, fully handled component in an existing Solid tree.
   *
   * The returned Solid component runs setup in the nearest `RuntimeProvider`
   * runtime (once per runtime, shared with `mount`). While an asynchronous setup
   * is still running it suspends the nearest `<Loading>`.
   */
  export const embed =
    <P>(component: Component<P, never, never>): Render<P> =>
    (props) => {
      const { fiber } = setupFor(component, useRuntime<unknown>());
      const exit = fiber.pollUnsafe();
      if (exit !== undefined) {
        return instantiate(renderFromExit(exit), props);
      }
      const ready = createMemo<Render<P>>(() => setupRenderToken(fiber));
      return createMemo(() => instantiate(ready(), props)) as unknown as JSX.Element;
    };
}
