import {
  makeRuntime,
  RuntimeTypeId,
  runWithRuntime,
  Signal,
  type ActionInterrupted,
  type AnySunfallArcRuntime,
  type Resource,
  type Route,
  type RouteViewTypeId,
  type SunfallArcRuntime,
  type Action,
  type ActionResult,
  type State,
  StateRefTypeId,
} from "@sunfall/arc-core";
import {
  eraseRuntime,
  makeActionInstance,
  resourceRenderCause,
  resourceRowKey,
  resourceRowPositions,
  resourceRowsIndex,
  SignalWrites,
  startStateOnRuntime,
  withSignalTransition,
  type ResourceStoreModule,
} from "@sunfall/arc-core/internal";
import { Cause, Context, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect";
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
  untrack,
  type Accessor,
  type Owner,
} from "solid-js";
import { hydrate as hydrateSolid, render as renderSolid, type JSX } from "@solidjs/web";
import { setupRenderFailure, typedRenderFailure } from "./render-failure.js";
import { projectView } from "./view-projection.js";
import {
  bindLiveQuery,
  type LiveQueryHandle as LiveQueryBindingHandle,
  type LiveQueryInput as LiveQueryBindingInput,
  type LiveQueryOptions as LiveQueryBindingOptions,
  type LiveQueryRenderError,
} from "./live-query.js";
import { createResourceSuspense, type ResourceSuspense } from "./resource-binding.js";
import { createBrowserRouter, type BrowserRouter, type RouterOptions } from "./router.js";

const ComponentTypeId = "~@sunfall/arc-solid/Component";
const RouteViewKey: typeof RouteViewTypeId = "~@sunfall/arc-core/RouteView";

/**
 * A typed Solid component definition: `P` props, `E` typed render failures,
 * `R` services its setup needs.
 *
 * JSX erases types (every element is `JSX.Element`), so services and failures
 * flow through definitions instead: inside another component's setup,
 * `yield* Child` adds the child's `E` and `R` to the parent and returns a plain
 * Solid component `(props: P) => JSX.Element`.
 *
 * Setup (the generator body) runs **once per instance**, with that instance's
 * props, under its Solid owner. It binds resources, actions, states, and
 * streams (each adding its services and failures to the component type) and
 * returns the render function. Anything shared per runtime is shared by
 * construction: Resources live in the runtime's Resource Store, and
 * `Component.provide` builds its Layer once per runtime. The instance's Scope
 * closes when Solid disposes the instance.
 *
 * `E` is phantom at the Effect level: yielding a component never fails. A
 * failing setup, a failing provided Layer, or a failed `Component.resource`
 * read surfaces when the component *renders*, by throwing to the nearest Solid
 * `<Errored>` boundary, which is where `Component.catchTags` handles it.
 *
 * @example
 * ```tsx
 * const ProjectCard = Component.define("ProjectCard", function* (props: { readonly id: string }) {
 *   const project = yield* Component.resource(ProjectById);
 *   return () => <article>{project(props.id).name}</article>;
 * });
 * ```
 */
export interface Component<in P, out E = never, out R = never> extends Pipeable, Route.View<P> {
  readonly [ComponentTypeId]: {
    readonly _P: (props: P) => void;
    readonly _E: () => E;
    readonly _R: () => R;
  };
  /** Display name, used for diagnostics. */
  readonly name: string;
  [Symbol.iterator](): Effect.EffectIterator<Effect.Effect<Component.Solid<P>, E, R>>;
}

interface ComponentImpl<P, E, R> extends Component<P, E, R> {
  /** Per-instance setup: services `R` plus the instance `Scope`. */
  readonly setup: (props: P) => Effect.Effect<Component.Render, E, R | Scope.Scope>;
}

type AnyComponent = Component<any, any, any>;

const impl = <P, E, R>(component: Component<P, E, R>): ComponentImpl<P, E, R> =>
  component as ComponentImpl<P, E, R>;

const isComponent = (value: unknown): value is AnyComponent =>
  typeof value === "object" && value !== null && ComponentTypeId in value;

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

/** Where a component instance runs: the root runtime plus the context its parent's setup saw. */
interface Environment {
  readonly runtime: AnySunfallArcRuntime<unknown>;
  readonly context: Context.Context<never>;
}

interface InstanceState {
  /** The component's name; prefixes its named callbacks and streams. */
  readonly name: string;
  readonly runtime: AnySunfallArcRuntime<unknown>;
  readonly owner: Owner | null;
  readonly scope: Scope.Scope;
}

/** The instance a setup runs for; read by setup-time bindings. */
const CurrentInstance = Context.Reference<InstanceState | undefined>(
  "@sunfall/arc-solid/Component/CurrentInstance",
  { defaultValue: () => undefined },
);

const failedRender =
  (error: unknown): Component.Render =>
  () => {
    throw error;
  };

const renderFromExit = (exit: Exit.Exit<Component.Render, unknown>): Component.Render =>
  Exit.isSuccess(exit)
    ? exit.value
    : Cause.hasInterruptsOnly(exit.cause)
      ? () => undefined
      : failedRender(setupRenderFailure(exit.cause));

/** Host token Solid awaits while an instance's setup is still running. */
const setupRenderToken = (fiber: Fiber.Fiber<Component.Render, unknown>) =>
  Effect.runPromise(Effect.map(Effect.exit(Fiber.join(fiber)), renderFromExit));

/**
 * Renders one instance of `component` in `environment`: runs its setup with
 * the instance's props, owner, and Scope, then renders. A synchronous setup
 * renders right away (so hydrated reads stay synchronous); an asynchronous one
 * suspends the nearest `<Loading>`. Setup failures throw from the render, to
 * the nearest `<Errored>`. Solid disposing the instance interrupts a running
 * setup and closes the instance Scope.
 */
const renderInstance = <P>(
  component: Component<P, any, any>,
  environment: Environment,
  props: P,
): JSX.Element => {
  const { runtime } = environment;
  const owner = getOwner();
  const scope = Scope.makeUnsafe();
  const state: InstanceState = { name: component.name, runtime, owner, scope };
  const setup = impl(component)
    .setup(props)
    .pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(CurrentInstance, state),
      Effect.provideContext(environment.context),
    ) as Effect.Effect<Component.Render, unknown>;
  const fiber = runtime.runFork(setup);
  onCleanup(() => {
    void runtime.runFork(
      Effect.andThen(
        fiber.pollUnsafe() === undefined ? Fiber.interrupt(fiber) : Effect.void,
        Scope.close(scope, Exit.void),
      ),
    );
  });
  const exit = fiber.pollUnsafe();
  const ready: Accessor<Component.Render> =
    exit === undefined
      ? createMemo<Component.Render>(() => setupRenderToken(fiber))
      : () => renderFromExit(exit);
  // Render in a computation of the instance's own: a pending read there
  // suspends the nearest `<Loading>` and retries only this render once it
  // settles. Rendering in the caller's computation would make a pending read
  // re-run that computation, recreating the instance and re-running setup.
  return createMemo(() => {
    const render = ready();
    return untrack(() => runWithRuntime(runtime, render));
  }) as unknown as JSX.Element;
};

/** The Solid component `yield* component` returns: instances run in the yielding setup's context. */
const childOf = <P, E, R>(component: Component<P, E, R>): Effect.Effect<Component.Solid<P>> =>
  Effect.gen(function* () {
    const instance = yield* currentInstance("yield* Component");
    const context = yield* Effect.context<never>();
    const environment: Environment = { runtime: instance.runtime, context };
    return (props: P) => renderInstance(component, environment, props);
  });

const currentInstance = (binding: string): Effect.Effect<InstanceState> =>
  Effect.gen(function* () {
    const instance = yield* CurrentInstance;
    return instance === undefined
      ? yield* Effect.die(new Error(`${binding} must be yielded inside a Component setup.`))
      : instance;
  });

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
    dispose: runtime.dispose,
    provide: (effect, options) => runtime.provide(withContext(effect), options),
    runFork: (effect, options) => runtime.runFork(withContext(effect), options),
    runSync: (effect) => runtime.runSync(withContext(effect)),
  };
};

/**
 * Wraps a generator so every step of the setup body runs under the instance's
 * Solid owner and runtime, even after an asynchronous step: Solid context reads
 * (`useRouter()`) and primitives created in setup attach to the instance.
 */
const ownedGenerator = <Y, Return>(
  generator: Generator<Y, Return, never>,
  instance: InstanceState,
): Generator<Y, Return, never> => {
  const step = <A>(f: () => A): A =>
    runWithOwner(instance.owner, () => runWithRuntime(instance.runtime, f));
  const owned: Generator<Y, Return, never> = {
    next: (...args) => step(() => generator.next(...args)),
    return: (value) => step(() => generator.return(value)),
    throw: (error) => step(() => generator.throw(error)),
    [Symbol.iterator]: () => owned,
    [Symbol.dispose]: () => step(() => generator[Symbol.dispose]?.()),
  } as Generator<Y, Return, never>;
  return owned;
};

const ComponentProto = {
  [ComponentTypeId]: {
    _P: (_: unknown) => undefined,
    _E: () => undefined,
    _R: () => undefined,
  },
  [RouteViewKey]: {
    _P: (_: unknown) => undefined,
  },
  pipe() {
    return pipeArguments(this, arguments);
  },
  [Symbol.iterator](this: AnyComponent) {
    return childOf(this)[Symbol.iterator]();
  },
};

const makeComponent = <P, E, R>(
  name: string,
  setup: (props: P) => Effect.Effect<Component.Render, E, R | Scope.Scope>,
): Component<P, E, R> =>
  Object.assign(Object.create(ComponentProto) as ComponentImpl<P, E, R>, { name, setup });

/** A component whose render wraps an instance of `self`, sharing its environment. */
const wrapRender = <P, E, R>(
  self: Component<P, E, R>,
  wrap: (Inner: Component.Solid<P>, props: P) => JSX.Element,
): Component<P, E, R> =>
  makeComponent(self.name, (props: P) =>
    Effect.map(childOf(self), (Inner) => () => wrap(Inner, props)),
  );

// ---------------------------------------------------------------------------
// Runtime host: Layers provided by `Component.provide`, built once per runtime
// ---------------------------------------------------------------------------

interface Host extends ResourceStoreModule {
  readonly scope: Scope.Closeable;
  readonly layers: Map<object, Fiber.Fiber<Context.Context<never>, unknown>>;
}

const HostKey: unique symbol = Symbol.for("@sunfall/arc-solid/Component/Host");

/** One host per runtime (Resource Store); store disposal interrupts builds and closes their Scope. */
const hostFor = (runtime: AnySunfallArcRuntime<unknown>): Host => {
  const registry = runtime.resourceStore.moduleRegistry;
  const existing = registry.get(HostKey) as Host | undefined;
  if (existing !== undefined) {
    return existing;
  }
  const scope = Scope.makeUnsafe();
  const layers = new Map<object, Fiber.Fiber<Context.Context<never>, unknown>>();
  const host: Host = {
    scope,
    layers,
    dispose: Effect.suspend(() => {
      const fibers = Array.from(layers.values());
      layers.clear();
      return Effect.andThen(Fiber.interruptAll(fibers), Scope.close(scope, Exit.void));
    }),
  };
  registry.register(HostKey, host);
  return host;
};

/**
 * Builds `layer` once per runtime (keyed by `key`) in a child of the runtime's
 * host Scope, so scoped services live until runtime disposal. A failed build
 * closes its Scope and stays failed; an interrupted one is forgotten.
 */
const buildOncePerRuntime = <ROut, E, RIn>(
  key: object,
  layer: Layer.Layer<ROut, E, RIn>,
): Effect.Effect<Context.Context<ROut>, E, RIn> =>
  Effect.gen(function* () {
    const instance = yield* currentInstance("Component.provide(...)");
    const host = hostFor(instance.runtime);
    let fiber = host.layers.get(key);
    if (fiber === undefined) {
      const scope = Scope.forkUnsafe(host.scope);
      const context = yield* Effect.context<RIn>();
      const build = Layer.buildWithScope(layer, scope).pipe(
        Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (host.layers.get(key) === fiber) {
              host.layers.delete(key);
            }
          }),
        ),
        Effect.provideContext(context),
      ) as Effect.Effect<Context.Context<never>, unknown>;
      fiber = instance.runtime.runFork(build);
      host.layers.set(key, fiber);
    }
    const built = fiber.pollUnsafe();
    return yield* (built ?? Fiber.join(fiber)) as Effect.Effect<Context.Context<ROut>, E>;
  });

// ---------------------------------------------------------------------------
// Resource reads
// ---------------------------------------------------------------------------

interface ResourceReaderEntry<A, E> {
  readonly binding: ResourceSuspense<A, E>;
  readonly dispose: () => void;
  /** Index buckets of stored rows, as the binding's view rows. */
  readonly buckets: WeakMap<ReadonlyArray<unknown>, ReadonlyArray<unknown>>;
  users: number;
}

/**
 * The instance's reader. Each ref key gets one fiber-backed async memo in its
 * own Solid root, reference-counted by the owners that read it.
 *
 * Releasing the last claim defers disposal to a microtask: Solid cleans up a
 * recomputing owner (or a suspended read's aborted run) and re-runs it in the
 * same flush, so the re-run re-acquires the same binding, while a binding
 * still unclaimed after the flush is disposed.
 */
/** Id-less, never-disposed parent of every reader binding root; created at module load. */
const readerHost = createRoot(() => getOwner());

const makeResourceReader = <I, A, E, R>(
  runtime: AnySunfallArcRuntime<unknown>,
  family: ((input: I) => Resource.Ref<I, A, E, R>) & { readonly family: Resource.AnyFamily },
) => {
  const entries = new Map<string, ResourceReaderEntry<A, E>>();
  const release = (key: string, entry: ResourceReaderEntry<A, E>) => (): void => {
    if (entry.users === 0 && entries.get(key) === entry) {
      entries.delete(key);
      entry.dispose();
    }
  };
  // Each binding is a root under the id-less reader host: it takes no
  // hydration id (so reads never shift the ids of the server-rendered tree),
  // it may be created while Solid runs effects (route renders do, and a
  // detached root is not allowed there), and it is disposed explicitly on
  // release or with the instance.
  const bind = (ref: Resource.Ref<I, A, E, R>): ResourceReaderEntry<A, E> =>
    runWithOwner(readerHost, () =>
      createRoot(
        (dispose): ResourceReaderEntry<A, E> => ({
          binding: createResourceSuspense(runtime, ref),
          dispose,
          buckets: new WeakMap(),
          users: 0,
        }),
      ),
    );
  const claim = (input: I): ResourceReaderEntry<A, E> => {
    const ref = family(input);
    let entry = entries.get(ref.key);
    if (entry === undefined) {
      entry = bind(ref);
      entries.set(ref.key, entry);
    }
    if (getOwner() !== null) {
      const current = entry;
      current.users++;
      onCleanup(() => {
        current.users--;
        if (current.users === 0) {
          queueMicrotask(release(ref.key, current));
        }
      });
    }
    return entry;
  };
  const result = (input: I) => claim(input).binding.result();
  const { name, rows } = family.family.options;
  // Row lookups run on the stored rows (their lookup structures are cached
  // by array identity) and return the view's row at the same position, so a
  // looked-up row is the row `reader(input)` renders.
  type Rows = ReadonlyArray<unknown>;
  const rowsOf = (input: I) => {
    const entry = claim(input);
    const stored = entry.binding.raw() as Rows;
    return { entry, stored, positions: resourceRowPositions(name, rows!, stored) };
  };
  const reader = Object.assign((input: I): A => claim(input).binding.read(), {
    waiting: (input: I): boolean => result(input).waiting,
    failure: (input: I): Cause.Cause<unknown> | undefined => {
      const current = result(input);
      return current._tag === "Failure" && !current.waiting
        ? resourceRenderCause(family(input).family, current.cause)
        : undefined;
    },
    // Present on every reader; the types offer them only when the family
    // declares `rows`. Each reads the rows of the current value.
    get: (input: I, key: Resource.RowKey): unknown => {
      const { entry, positions } = rowsOf(input);
      const position = positions.get(key);
      return position === undefined ? undefined : (entry.binding.read() as Rows)[position];
    },
    index: (input: I, index: string, value: unknown): ReadonlyArray<unknown> => {
      const { entry, stored, positions } = rowsOf(input);
      const bucket = resourceRowsIndex(name, rows!, stored, index, value);
      let viewed = entry.buckets.get(bucket);
      if (viewed === undefined) {
        const view = entry.binding.read() as Rows;
        viewed = bucket.map((row) => view[positions.get(resourceRowKey(name, rows!, row))!]);
        entry.buckets.set(bucket, viewed);
      }
      return viewed;
    },
  }) satisfies Component.ResourceReader<I, A, unknown>;
  const dispose = (): void => {
    const current = Array.from(entries.values());
    entries.clear();
    for (const entry of current) {
      entry.dispose();
    }
  };
  return { reader, dispose };
};

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

type StateModelLeaf =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  | Date
  | RegExp
  | ((...args: never) => unknown);

/**
 * Projects a State model signal into a fine-grained Solid view owned by the
 * current owner (see `projectView`).
 *
 * A State whose initial model is a primitive (a toggle, a search string)
 * reads the signal directly: there is nothing to reconcile, so it skips the
 * store projection. Either path renders every value correctly; only the
 * granularity differs.
 */
const projectModel = <Model>(
  model: Signal.Readable<Model>,
  initial: unknown,
  key: Component.StateOptions["key"],
): Accessor<Component.StateView<Model>> =>
  typeof initial !== "object" || initial === null
    ? () => model.get() as Component.StateView<Model>
    : projectView(
        () => ({ value: model.get() as Component.StateView<Model> }),
        key === undefined ? "id" : key,
      );

/**
 * True for a message's fields. A DOM event is not: a sender bound straight to
 * an event handler (`onClick={menu.send.Toggle}`) receives the event and
 * sends a message without fields.
 */
const isPayload = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" &&
  value !== null &&
  !(typeof Event === "function" && value instanceof Event);

// ---------------------------------------------------------------------------
// Boundaries and mounting
// ---------------------------------------------------------------------------

type Tags<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;

const tagOf = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly _tag?: unknown })._tag === "string"
    ? (value as { readonly _tag: string })._tag
    : undefined;

/** Solid's `render`/`hydrate` target type. */
type MountTarget = Parameters<typeof renderSolid>[1];

/**
 * Runs `effect` in a child of the caller's Scope that is closed right away if
 * `effect` fails or is interrupted, so a failed acquisition releases what it
 * already acquired instead of holding it until the caller's Scope closes.
 */
const releaseOnFailure = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const inner = yield* Scope.fork(yield* Scope.Scope);
    return yield* effect.pipe(
      Scope.provide(inner),
      Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(inner, exit) : Effect.void)),
    );
  });

type MountArgs<P, RuntimeServices, ER> = {} extends P
  ? [options?: Component.MountOptions<P, RuntimeServices, ER>]
  : [options: Component.MountOptions<P, RuntimeServices, ER> & { readonly props: P }];

/** Root environment: the runtime alone. */
const rootEnvironment = (runtime: AnySunfallArcRuntime<unknown>): Environment => ({
  runtime,
  context: Context.empty() as Context.Context<never>,
});

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

type ServicesOfComponent<C> =
  C extends Component<any, any, infer R>
    ? R
    : C extends Route.LazyComponent<infer Loaded, any>
      ? ServicesOfComponent<Loaded>
      : never;

type ErrorOfComponent<C> =
  C extends Component<any, infer E, any>
    ? E
    : C extends Route.LazyComponent<infer Loaded, any>
      ? ErrorOfComponent<Loaded>
      : never;

/** Typed Solid component definitions; see {@link Component}. */
export namespace Component {
  /** Plain Solid component a `Component<P, E, R>` renders as. */
  export type Solid<P> = (props: P) => JSX.Element;

  /** Render function a setup returns; runs once per instance under its owner. */
  export type Render = () => JSX.Element;

  /** Typed failures accumulated by a setup generator. */
  export type ErrorOf<Eff> = [Eff] extends [never]
    ? never
    : Eff extends Effect.Effect<infer _A, infer E, infer _R>
      ? E
      : never;

  /** Services accumulated by a setup generator; the instance `Scope` is always provided. */
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

  /** Options for `Component.mount` and `Component.launch`. */
  export interface MountOptions<P, RuntimeServices = never, ER = never> {
    /**
     * Host-owned runtime to mount into. Omit it to let the mount own a fresh
     * runtime, disposed when the mount's Scope closes. The runtime's services
     * (`RuntimeServices`) satisfy the component's remaining requirements, so a
     * component may leave them to the host instead of `Component.provide`. An
     * erased runtime (`AnySunfallArcRuntime`) satisfies none. Its startup
     * failures (`ER`) fail the mount.
     */
    readonly runtime?: SunfallArcRuntime<RuntimeServices, ER> | AnySunfallArcRuntime<ER>;
    /** Root props; required when the root component has required props. */
    readonly props?: P;
    /**
     * Hydrate server-rendered markup in the container (Solid's `hydrate`)
     * instead of rendering fresh. The server renders the same tree with
     * `Component.embed(component, runtime)`; restore the server's Resource
     * snapshot into `runtime` first so reads stay synchronous. Start apps get
     * both halves from `createRequestHandler` and `App.launch`.
     */
    readonly hydrate?: boolean;
  }

  /** Instance-bound live query handle from `Component.liveQuery`. */
  export type LiveQueryHandle<T, E = never> = LiveQueryBindingHandle<T, E>;
  /** A query factory, or a prebuilt `Query.Live`, for `Component.liveQuery`. */
  export type LiveQueryInput<T, E, R> = LiveQueryBindingInput<T, E, R>;
  /** Options for `Component.liveQuery`. */
  export type LiveQueryOptions = LiveQueryBindingOptions;

  /**
   * The instance a setup runs for, for writing setup-time bindings: its
   * runtime (whose effects see the setup's context, including
   * `Component.provide` services), Solid owner, and Scope.
   */
  export interface Instance {
    /** The component's name, which prefixes its named transitions (`<name>.<callback>`). */
    readonly name: string;
    /**
     * Runtime whose effects see the setup's context. It has already started
     * (mounts start it before rendering), so it adds no startup failures.
     */
    readonly runtime: AnySunfallArcRuntime<never>;
    /** The instance's Solid owner. */
    readonly owner: Owner | null;
    /** The instance's Scope, closed when Solid disposes the instance. */
    readonly scope: Scope.Scope;
    /** Runs `f` under the instance's owner with its runtime ambient (for Solid primitives). */
    run<A>(f: () => A): A;
    /** Forks `effect` in the instance's Scope, with the setup's context. */
    fork<A, E>(effect: Effect.Effect<A, E, any>): Fiber.Fiber<A, E>;
    /**
     * Throws a render-time read failure to the nearest `<Errored>`, the way a
     * Resource reader does: the typed failure in `cause` reaches `catchTags`
     * and `catchAll`; a defect rethrows past them. Bindings whose failures
     * join `E` (like `Component.liveQuery`) throw through it.
     */
    fail(cause: Cause.Cause<unknown>): never;
  }

  /**
   * Render-time reader for a Resource family, from `Component.resource`.
   *
   * `reader(input)` is the only way to render the value: it suspends the
   * nearest `<Loading>` until the first value and keeps returning the current
   * (or, after a failed refresh, the stale) value afterwards, so content stays
   * mounted across refreshes. The value is a read-only fine-grained view: a
   * binding re-runs only when the field it reads changes, so a refresh never
   * disturbs what it did not change. Status chrome reads `waiting(input)` and
   * `failure(input)`, which carry no value.
   */
  export interface ResourceReader<I, A, E> {
    (input: I): A;
    /** True while a load or refresh of `input` is in flight. */
    readonly waiting: (input: I) => boolean;
    /**
     * The settled failure of the latest load of `input`, if it failed, with
     * typed failures as the family renders them (`Resource.RenderError`).
     */
    readonly failure: (input: I) => Cause.Cause<E> | undefined;
  }

  /**
   * Row lookups a reader adds when its family declares `rows`. Both read the
   * current value of `input` exactly like `reader(input)`: they suspend the
   * nearest `<Loading>` until the first value, then follow reloads, change
   * feeds, and optimistic patches.
   */
  export interface ResourceRowsReader<I, Row, Key, Indexes> {
    /** The row with `key`, or `undefined` when the value has none. */
    readonly get: (input: I, key: Key) => Row | undefined;
    /** The rows in one bucket of a declared index, in value order. */
    readonly index: <const Name extends keyof Indexes & string>(
      input: I,
      index: Name,
      value: Resource.RowIndexLookup<Indexes[Name]>,
    ) => ReadonlyArray<Row>;
  }

  /** The reader `Component.resource` returns: row lookups join when the family has `rows`. */
  export type Reader<I, A, E, Rows> = [Rows] extends [never]
    ? ResourceReader<I, A, E>
    : Rows extends Resource.RowsSpec<infer Row, infer Key, infer Indexes>
      ? ResourceReader<I, A, E> & ResourceRowsReader<I, Row, Key, Indexes>
      : ResourceReader<I, A, E>;

  /**
   * Failures an Action submission reports: its own and transport failures. A
   * callback that breaks its contract is a defect, not part of the type.
   */
  export type ActionError<E> = E | Action.ClientError;

  /**
   * Instance-bound Action handle from `Component.action`.
   *
   * Submission failures belong to the caller: `submit` returns them, and
   * `Component.callback` makes the handler deal with them. Status chrome reads
   * `waiting()` and `failure()`, the same names a Resource reader uses.
   */
  export interface ActionHandle<I, A, E> {
    /** True while a submission is in flight. */
    readonly waiting: Accessor<boolean>;
    /** The settled failure of the latest submission, if it failed. */
    readonly failure: Accessor<Cause.Cause<ActionError<E>> | undefined>;
    /**
     * Submission `AsyncResult`: `Initial` while idle, `waiting` while a
     * submission is in flight, then `Success` or `Failure` (full `Cause`,
     * latest success kept as `previousSuccess`).
     */
    readonly result: Accessor<AsyncResult.AsyncResult<A, ActionError<E>>>;
    /** Input of the latest submission (`Option.none()` while idle). */
    readonly input: Accessor<Option.Option<I>>;
    /**
     * Submits `input` with the instance's context; the outcome also lands in
     * `result()`. Bridge it to an event handler with `Component.callback`,
     * handling (or ignoring) its failures there.
     */
    readonly submit: (input: I) => Effect.Effect<A, ActionError<E> | ActionInterrupted>;
    /** Interrupts in-flight submissions and returns to `Initial`. */
    readonly reset: () => Effect.Effect<void>;
  }

  /**
   * Deeply read-only view of a State model as Solid renders it.
   *
   * Plain objects and arrays become read-only at every level. `Map` and `Set`
   * values become `ReadonlyMap` / `ReadonlySet`; primitives, functions, `Date`,
   * and `RegExp` pass through unchanged.
   */
  export type StateView<Model> = unknown extends Model
    ? Model
    : Model extends StateModelLeaf
      ? Model
      : Model extends ReadonlyMap<infer K, infer V>
        ? ReadonlyMap<K, V>
        : Model extends ReadonlySet<infer V>
          ? ReadonlySet<V>
          : { readonly [Key in keyof Model]: StateView<Model[Key]> };

  /** Options for `Component.state`. */
  export interface StateOptions {
    /**
     * Identity used to reconcile object models into the fine-grained view: a
     * property name or a function of each plain object in the model.
     *
     * Array items whose key matches keep their view identity across inserts,
     * removals, and reorders, and an object whose key changes is treated as a
     * different entity. Defaults to `"id"` (Solid's projection default); items
     * without the key fall back to position. `null` reconciles positionally.
     * Primitive models are read directly and ignore it.
     */
    readonly key?: string | ((item: object) => unknown) | null;
  }

  /**
   * One DOM-ready sender per message tag. A message without fields takes no
   * argument and ignores one it is given, so it binds straight to an event
   * (`onClick={menu.send.Toggle}`); a message with fields takes them
   * (`send.Search({ query })`).
   */
  export type StateSend<Message extends State.TaggedMessage> = {
    readonly [Tag in Message["_tag"]]: [
      keyof Omit<Extract<Message, { readonly _tag: Tag }>, "_tag">,
    ] extends [never]
      ? (event?: unknown) => void
      : (fields: Omit<Extract<Message, { readonly _tag: Tag }>, "_tag">) => void;
  };

  /** Instance-bound State handle from `Component.state`. */
  export interface StateHandle<
    Model,
    Message extends State.TaggedMessage,
    E,
  > extends State.Ref<Model> {
    /**
     * Current model as a read-only Solid view. Object models are
     * fine-grained: a computation re-runs only when the parts of the model it
     * reads change, unchanged subtrees keep their identity, and array items
     * keep it across reorders by `StateOptions.key`.
     */
    readonly model: Accessor<StateView<Model>>;
    /** Committed model for Effect-side reads (`Signal.peek`, `Signal.changes`). */
    readonly committed: Signal.Readable<Model>;
    /**
     * Sends a message from a DOM event: it is queued right away and applied
     * by the State loop, and a failure lands in `failures()`.
     */
    readonly send: StateSend<Message>;
    /**
     * Queues `message` and completes once its update commits (failing if the
     * update fails or disposal drops it). For Effect code that must wait for
     * the update; event handlers use `send`.
     */
    readonly dispatch: (
      message: Message,
    ) => Effect.Effect<void, State.Failure<Message, State.DispatchError<E>>>;
    /** Typed update, command, and subscription failures reported by the State loop. */
    readonly failures: Accessor<ReadonlyArray<State.Failure<Message, State.RuntimeError<E>>>>;
    /** Clears accumulated failures. */
    readonly clearFailures: () => void;
  }

  /**
   * Defines a component from a per-instance setup generator that returns its
   * render function.
   *
   * Setup receives the instance's props (Solid props: read them in tracked
   * code to react to changes) and runs once per instance under its owner.
   * `yield*` services, bindings, and child components in setup; their failures
   * and services accumulate into the component's `E` and `R`. An asynchronous
   * setup suspends the nearest `<Loading>`.
   *
   * @example
   * ```tsx
   * const Dashboard = Component.define("Dashboard", function* () {
   *   const Card = yield* ProjectCard.pipe(
   *     Component.catchTags({ ProjectNotFound: () => <p>Gone</p> }),
   *     Component.loading(() => <Spinner />),
   *   );
   *   return () => <Card id={selected()} />;
   * });
   * ```
   */
  export const define = <Eff extends Effect.Effect<any, any, any>, P = {}>(
    name: string,
    body: (props: P) => Generator<Eff, Render, never>,
  ): Component<P, ErrorOf<Eff>, ServicesOf<Eff>> =>
    makeComponent(name, (props: P) =>
      Effect.flatMap(currentInstance("Component.define"), (instance) =>
        Effect.gen(() => ownedGenerator(body(props), instance)),
      ),
    ) as Component<P, ErrorOf<Eff>, ServicesOf<Eff>>;

  /** The current instance, for writing setup-time bindings; dies outside a setup. */
  export const instance: Effect.Effect<Instance> = Effect.gen(function* () {
    const state = yield* currentInstance("Component.instance");
    const context = yield* Effect.context<never>();
    const runtime = withSetupContext(state.runtime, context) as AnySunfallArcRuntime<never>;
    return {
      name: state.name,
      runtime,
      owner: state.owner,
      scope: state.scope,
      run: (f) => runWithOwner(state.owner, () => runWithRuntime(runtime, f)),
      fork: (effect) => runtime.runSync(Effect.forkIn(effect, state.scope)),
      fail: (cause) => {
        throw setupRenderFailure(cause);
      },
    } satisfies Instance;
  });

  /**
   * Binds a Resource family and returns its render-time reader.
   *
   * The family's render failure (`Resource.RenderError`: its `error` schema's
   * type, or `ResourceUntypedFailure` for a family without one) joins the
   * component's `E`, and its services join `R` (satisfied by the setup's
   * context, including `Component.provide`). `reader(input)` suspends the
   * nearest `<Loading>` until the first value; a failed first load throws to
   * the nearest `<Errored>`, which `catchTags` matches by the render
   * failure's `_tag`. During a server render the failure crosses to the page
   * only as the family's `error` schema encodes it (its `_tag` alone without
   * one), and the hydrating client decodes the same value. Refreshes keep
   * content mounted: the reader keeps the current (or stale) value while
   * `waiting` and `failure` drive status chrome. A load callback that breaks
   * its contract (throws synchronously) is a defect, never matched by
   * `catchTags`. Preloaded or hydrated values read synchronously.
   */
  export const resource = <I, A, E, R, RenderError, Rows = never>(
    family: Resource.RefFactory<I, A, E, R, RenderError, Rows>,
  ): Effect.Effect<Reader<I, A, RenderError, Rows>, RenderError, R> =>
    Effect.gen(function* () {
      const { runtime } = yield* instance;
      const { reader, dispose } = makeResourceReader(runtime, family);
      yield* Effect.addFinalizer(() => Effect.sync(dispose));
      return reader;
    }) as unknown as Effect.Effect<Reader<I, A, RenderError, Rows>, never, R>;

  /**
   * Binds a live query over the rows of Resources (`Query` from
   * `@sunfall/arc-db`) and returns its handle. Pass a query factory or a
   * prebuilt `Query.Live`; the sources' declared load errors join the
   * component's `E` and their services join `R`. The factory runs tracked: a
   * signal or prop it reads rebuilds the query. Sources preload on mount
   * unless `preload` is false.
   *
   * @example
   * ```tsx
   * const open = yield* Component.liveQuery((query) =>
   *   query
   *     .from({ project: ProjectsRef })
   *     .where(({ project }) => project.status === "active")
   *     .select(({ project }) => project),
   * );
   * ```
   */
  export const liveQuery = <T, E = never, R = never>(
    input: LiveQueryBindingInput<T, E, R>,
    options: LiveQueryBindingOptions = {},
  ): Effect.Effect<LiveQueryBindingHandle<T, E>, LiveQueryRenderError<E>, R> =>
    Effect.map(instance, (current) => bindLiveQuery(current, input, options)) as Effect.Effect<
      LiveQueryBindingHandle<T, E>,
      LiveQueryRenderError<E>,
      R
    >;

  /**
   * Binds an Action to this instance and returns its handle.
   *
   * The definition's services (and its result invalidations' services) join
   * the component's `R`. Submissions run with the setup's context; when the
   * runtime provides an `ActionTransport` that serves the Action (Start's
   * `makeActionTransportLayer`), they run on the server instead, with the same
   * handle. Unmounting interrupts in-flight submissions.
   */
  export const action = <I, A, E, R>(
    definition: Action.Definition<I, A, E, R>,
  ): Effect.Effect<ActionHandle<I, A, E>, never, R | ActionResult.InvalidationRequirements<A>> =>
    Effect.gen(function* () {
      const current = yield* instance;
      const instanceAction = makeActionInstance(definition, current.runtime);
      yield* Effect.addFinalizer(() => instanceAction.reset());
      const result = () => instanceAction.state.get().result;
      const handle: ActionHandle<I, A, E> = {
        waiting: () => result().waiting,
        failure: () => {
          const current = result();
          return current._tag === "Failure" && !current.waiting ? current.cause : undefined;
        },
        result,
        input: () => instanceAction.state.get().input,
        submit: instanceAction.submit,
        reset: instanceAction.reset,
      };
      return handle;
    }) as Effect.Effect<ActionHandle<I, A, E>, never, R | ActionResult.InvalidationRequirements<A>>;

  /**
   * Starts a State for this instance and returns its handle: the model as a
   * read-only Solid view, and one DOM-ready sender per message. The
   * definition's services join the component's `R`; the State stops when the
   * instance is disposed. Each instance owns its own State, so keying a
   * component on an entity (`<Editor id={id} />`) gives each entity a fresh one.
   *
   * @example
   * ```tsx
   * const MenuOpen = State.define({ name: "Menu.open", initial: false, on: { Toggle: (open) => !open } });
   *
   * const Menu = Component.define("Menu", function* () {
   *   const menu = yield* Component.state(MenuOpen);
   *   return () => <button aria-expanded={menu.model()} onClick={menu.send.Toggle}>Menu</button>;
   * });
   * ```
   */
  export const state = <Model, Message extends State.TaggedMessage, E, R>(
    definition: State.Definition<Model, Message, E, R>,
    options?: StateOptions,
  ): Effect.Effect<StateHandle<Model, Message, E>, never, R> =>
    Effect.gen(function* () {
      const current = yield* instance;
      const started = current.run(() =>
        startStateOnRuntime<Model, Message, E, R, never>(definition, current.runtime),
      );
      yield* Effect.addFinalizer(() => started.dispose);
      const model = current.run(() =>
        projectModel(started.model, definition.initial, options?.key),
      );
      const dispatch = started.dispatch as StateHandle<Model, Message, E>["dispatch"];
      const send: Record<string, (fields?: unknown) => void> = {};
      for (const tag of Object.keys(definition.on)) {
        send[tag] = (fields) => {
          const message = (isPayload(fields) ? { ...fields, _tag: tag } : { _tag: tag }) as Message;
          // Started immediately, so the message is queued within the DOM event.
          current.runtime.runSync(
            Effect.forkIn(Effect.ignore(dispatch(message)), current.scope, {
              startImmediately: true,
            }),
          );
        };
      }
      const handle: StateHandle<Model, Message, E> = {
        [StateRefTypeId]: started[StateRefTypeId],
        model,
        committed: started.model,
        send: send as StateSend<Message>,
        dispatch,
        failures: () => started.failures.get(),
        clearFailures: started.clearFailures,
      };
      return handle;
    }) as Effect.Effect<StateHandle<Model, Message, E>, never, R>;

  /**
   * Runs a Stream for this instance and returns its latest value as a
   * read-only accessor (`initial` until the first element): a read of an
   * external source, like a Resource, not client state, so nothing can write
   * it. Each element commits under the transition `<Component>.<name>`. The
   * stream's services join the component's `R`; it is interrupted when the
   * instance is disposed.
   */
  export const stream = <A, R>(
    name: string,
    source: Stream.Stream<A, never, R>,
    initial: A,
  ): Effect.Effect<Accessor<A>, never, R> =>
    Effect.gen(function* () {
      const current = yield* instance;
      const transition = `${current.name}.${name}`;
      const latest = SignalWrites.make(initial, { name: transition });
      current.fork(
        withSignalTransition(
          source.pipe(Stream.runForEach((value) => Effect.sync(() => latest.set(value)))),
          { _tag: "Transition", name: transition },
        ),
      );
      return () => latest.get();
    });

  /**
   * Turns an Effect-returning function into a named callback for DOM event
   * handlers that run Effect work other than a State change: submitting an
   * Action, invalidating a Resource, travelling a Timeline. State changes go
   * through `Component.state(...).send`.
   *
   * Each call forks the Effect in the instance's Scope with the setup's
   * context (interrupted on unmount), starting it right away so synchronous
   * work lands within the DOM event, as the named transition
   * `<Component>.<name>`; Actions, Resources, and States it touches commit
   * under their own causes. Its services join the component's `R`; it must
   * handle its own failures (`E = never`).
   *
   * @example
   * ```tsx
   * const refresh = yield* Component.callback("refresh", () => Resource.invalidate(ProjectsRef));
   * return () => <button onClick={refresh}>Refresh</button>;
   * ```
   */
  export const callback = <Args extends ReadonlyArray<unknown>, A, R>(
    name: string,
    f: (...args: Args) => Effect.Effect<A, never, R>,
  ): Effect.Effect<(...args: Args) => void, never, R> =>
    Effect.map(instance, (current) => {
      const cause = { _tag: "Transition", name: `${current.name}.${name}` } as const;
      return (...args: Args) => {
        // Started immediately, so synchronous writes land within the DOM event.
        current.runtime.runSync(
          Effect.forkIn(
            withSignalTransition(
              Effect.suspend(() => f(...args)),
              cause,
            ),
            current.scope,
            {
              startImmediately: true,
            },
          ),
        );
      };
    });

  /** Services a router needs: its routes' preloads and route Components' services. */
  export type RouterServices<Routes extends readonly AnyRoute[]> =
    | Route.PreloadRequirements<Routes[number]>
    | ServicesOfComponent<Route.ComponentOf<Routes[number]>>;

  /** Render failures of a router's route Components. */
  export type RouterError<Routes extends readonly AnyRoute[]> = ErrorOfComponent<
    Route.ComponentOf<Routes[number]>
  >;

  /**
   * Creates this instance's browser router for `routes`; render it with
   * `<RouterProvider router={router}>`.
   *
   * Route preloads and route Components run with the setup's context, so the
   * routes' preload services and route Components' services and failures join
   * the component's `R` and `E`, and `launch` checks them. The router stops
   * listening to history when the instance is disposed.
   */
  export const router = <const Routes extends readonly AnyRoute[]>(
    routes: Routes,
    options: RouterOptions = {},
  ): Effect.Effect<BrowserRouter<Routes>, RouterError<Routes>, RouterServices<Routes>> =>
    Effect.gen(function* () {
      const current = yield* instance;
      const context = yield* Effect.context<never>();
      const environment: Environment = { runtime: current.runtime, context };
      return current.run(() =>
        createBrowserRouter<Routes, never>(routes, {
          ...options,
          runtime: current.runtime as AnySunfallArcRuntime<never>,
          renderView: (component, props) => {
            if (!isComponent(component)) {
              throw new TypeError("Route components must be functions or Components.");
            }
            return renderInstance(component, environment, props);
          },
        }),
      );
    }) as Effect.Effect<BrowserRouter<Routes>, never, RouterServices<Routes>>;

  /**
   * Handles typed render failures by `_tag`, removing them from `E`.
   *
   * Only tags in `E` are accepted, and each handler receives exactly that
   * member of `E` plus Solid's boundary `reset`. At runtime the instance is
   * wrapped in a Solid `<Errored>`; a `ResourceFailure` is matched by the
   * `_tag` of `AsyncResult.error(failure.result)`. Unmatched failures
   * (including defects) rethrow to the next outer boundary.
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
      wrapRender(self, (Inner, props) =>
        createComponent(Errored, {
          fallback: (error, reset) => {
            const thrown = error();
            // Only typed failures match; defects and interruptions rethrow.
            const target = Option.getOrUndefined(typedRenderFailure(thrown));
            const tag = tagOf(target);
            const handler =
              tag !== undefined && Object.hasOwn(handlers, tag)
                ? (handlers as Record<string, (error: unknown, reset: () => void) => JSX.Element>)[
                    tag
                  ]
                : undefined;
            if (handler === undefined) {
              throw thrown;
            }
            return handler(target, reset);
          },
          get children() {
            return createComponent(
              Inner as Solid<Record<string, any>>,
              props as Record<string, any>,
            );
          },
        }),
      ) as Component<P, any, R>;

  /**
   * Handles every typed render failure with one handler, removing `E`
   * entirely. Like `catchTags`, it wraps the instance in a Solid `<Errored>`;
   * a `ResourceFailure` is handled with its typed load error. Defects (and a
   * throwing load callback) carry no typed failure and rethrow outward.
   */
  export const catchAll =
    <E>(handler: (error: E, reset: () => void) => JSX.Element) =>
    <P, R>(self: Component<P, E, R>): Component<P, never, R> =>
      wrapRender(self, (Inner, props) =>
        createComponent(Errored, {
          fallback: (error, reset) => {
            const thrown = error();
            const typed = typedRenderFailure(thrown);
            if (Option.isNone(typed)) {
              throw thrown;
            }
            return handler(typed.value as E, reset);
          },
          get children() {
            return createComponent(
              Inner as Solid<Record<string, any>>,
              props as Record<string, any>,
            );
          },
        }),
      ) as Component<P, never, R>;

  /** Shows `fallback` while the instance is pending (a Solid `<Loading>`). Type-neutral. */
  export const loading =
    (fallback: () => JSX.Element) =>
    <P, E, R>(self: Component<P, E, R>): Component<P, E, R> =>
      wrapRender(self, (Inner, props) =>
        createComponent(Loading, {
          get fallback() {
            return fallback();
          },
          get children() {
            return createComponent(
              Inner as Solid<Record<string, any>>,
              props as Record<string, any>,
            );
          },
        }),
      );

  /**
   * Provides services to the component's setup (and everything it binds or
   * yields), removing `ROut` from `R`.
   *
   * The Layer is built once per runtime in the runtime's host Scope, so scoped
   * services live until the runtime is disposed, and every instance shares
   * them. Layer failures join `E` and render like any other setup failure.
   */
  export const provide =
    <ROut, LE, RIn>(layer: Layer.Layer<ROut, LE, RIn>) =>
    <P, E, R>(self: Component<P, E, R>): Component<P, E | LE, Exclude<R, ROut> | RIn> => {
      const key = {};
      return makeComponent(self.name, (props: P) =>
        Effect.flatMap(buildOncePerRuntime(key, layer), (context) =>
          Effect.provideContext(impl(self).setup(props), context),
        ),
      ) as Component<P, E | LE, Exclude<R, ROut> | RIn>;
    };

  /**
   * Mounts a fully provided, fully handled component into a DOM container: the
   * composable, scoped primitive under `Component.launch`.
   *
   * Only `Component<P, never, never>` is accepted: every service provided and
   * every typed failure handled. The result is a scoped acquisition: the Solid
   * tree (and an owned runtime) stay mounted while the caller's `Scope` is open
   * and are disposed, tree first, when it closes. The runtime starts before
   * the first render; an asynchronous root setup suspends like any other. If
   * the mount fails (runtime startup or a render that throws), everything it
   * acquired is released immediately rather than when the caller's Scope
   * closes.
   *
   * Use it to compose a mount into a larger scoped program (or a test); use
   * `Component.launch` as the app entry point.
   */
  export const mount = <P, RuntimeServices = never, ER = never>(
    component: Component<P, never, NoInfer<RuntimeServices>>,
    container: MountTarget,
    ...[options]: MountArgs<P, RuntimeServices, ER>
  ): Effect.Effect<void, ER, Scope.Scope> =>
    Effect.gen(function* () {
      const runtime: AnySunfallArcRuntime<unknown> =
        (options?.runtime === undefined ? undefined : eraseRuntime(options.runtime)) ??
        (yield* Effect.acquireRelease(
          Effect.sync(() => eraseRuntime(makeRuntime())),
          (owned) => owned.dispose.pipe(Effect.ignore({ log: true })),
        ));
      // Start the runtime first, so its startup failure (`ER`) fails the mount.
      yield* runtime.provide(Effect.void) as Effect.Effect<void, ER>;
      const props = (options?.props ?? {}) as P;
      const attach = options?.hydrate === true ? hydrateSolid : renderSolid;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          attach(() => renderInstance(component, rootEnvironment(runtime), props), container),
        ),
        (dispose) => Effect.sync(dispose),
      );
    }).pipe(releaseOnFailure);

  /**
   * The app entry point: mounts a fully provided, fully handled component and
   * keeps it mounted until the returned Effect is interrupted, like
   * `Layer.launch`. Interrupting it disposes the Solid tree, then any runtime
   * it owns. It fails only with a host runtime's startup error (`ER`).
   *
   * @example
   * ```ts
   * Effect.runFork(Component.launch(App.pipe(Component.provide(AppLive)), root));
   * ```
   */
  export const launch = <P, RuntimeServices = never, ER = never>(
    component: Component<P, never, NoInfer<RuntimeServices>>,
    container: MountTarget,
    ...options: MountArgs<P, RuntimeServices, ER>
  ): Effect.Effect<never, ER> =>
    Effect.scoped(
      Effect.andThen(mount<P, RuntimeServices, ER>(component, container, ...options), Effect.never),
    );

  /**
   * Renders a fully provided, fully handled component in `runtime` as a plain
   * Solid component: the server render path. Under a request runtime,
   * `renderToString(() => <Root {...props} />)` runs each instance's setup in
   * that runtime, and `launch(component, root, { runtime, hydrate: true })`
   * hydrates the markup on the client (it renders the same tree). Start's
   * `createRequestHandler` renders an app's root this way.
   */
  export const embed = <P, RuntimeServices = never, ER = never>(
    component: Component<P, never, NoInfer<RuntimeServices>>,
    runtime: SunfallArcRuntime<RuntimeServices, ER> | AnySunfallArcRuntime<ER>,
  ): Solid<P> => {
    const environment = rootEnvironment(eraseRuntime(runtime));
    return (props) => renderInstance(component, environment, props);
  };
}
