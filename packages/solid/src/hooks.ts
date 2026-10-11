import {
  Action,
  Program,
  Resource,
  runWithRuntime,
  resourceUiRefAccessor,
  Signal,
  type ActionInstance,
  type ActionResultInvalidationRequirements,
  type EffectInput,
  type EffectInputCallbackError,
  type SunfallArcRuntime,
  type ForkScopedOptions,
  type ProgramEvent,
  type ProgramFailure,
  type ReadableSignal,
  type ResourceUiInput,
  type ResourceInvalidationPlan,
  type ResourceRef,
  type ResourceStore,
} from "@sunfall/arc-core";
import { Effect, Fiber, Stream, type Option } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { onCleanup, type Accessor } from "solid-js";
import { createResourceBinding, createResourceSuspense } from "./resource-binding.js";
import { createComponentScope, useRuntime } from "./runtime.js";

type ResourceInput<I, A, E, R = unknown> = ResourceUiInput<I, A, E, R>;

/** Options for binding a Resource to Solid reactivity. */
export interface UseResourceOptions<E = never, ER = never> {
  /** Start loading on mount. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time preload.
   *
   * The error is `Resource.LoadError<E> | ER`, so callback throws and runtime
   * startup/provision failures are reported beside the resource's own error
   * channel. Observers may return a plain value or Effect; Promise-shaped
   * observers are rejected at the EffectInput boundary, so host Promise work
   * must be wrapped with `Effect.tryPromise(...)`. If this observer throws or
   * returns a failing Effect, the hook ignores that observer failure after
   * updating `preloadFailure`.
   */
  readonly onPreloadFailure?: (error: Resource.LoadError<E> | ER) => EffectInput<void, unknown>;
}

/**
 * Solid-facing handle for an Sunfall Arc resource.
 *
 * `result` tracks the resource's `AsyncResult` reactively: render it with
 * `AsyncResult.builder(...)`, `AsyncResult.match(...)`, or the `AsyncResult`
 * accessors (`value`, `error`, `waiting`). `refreshEffect` and `prefetchEffect`
 * keep resource work in Effect and are bound to the nearest Solid runtime.
 */
export interface ResourceHandle<I, A, E, R = unknown, ER = never> {
  /** Current resource ref, tracking ref accessors when the input ref is reactive. */
  readonly ref: Accessor<ResourceRef<I, A, E, R>>;
  /**
   * Current resource `AsyncResult` bound to the nearest Solid runtime.
   *
   * Loads mark the result `waiting` on its current tag (stale-while-refreshing);
   * `Failure` carries the full `Cause` (typed errors and defects) and keeps the
   * latest success as `previousSuccess`.
   */
  readonly result: Accessor<AsyncResult.AsyncResult<A, Resource.LoadError<E>>>;
  /**
   * Failure captured from the automatic mount-time preload, if enabled.
   *
   * Load failures also settle into `result`; this accessor additionally reports
   * runtime (`ER`) failures that never reach the Resource Store.
   */
  readonly preloadFailure: Accessor<Resource.LoadError<E> | ER | undefined>;
  /** Runs a forced refresh in the bound runtime. */
  refreshEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
  /** Ensures the resource has loaded in the bound runtime. */
  prefetchEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
}

/** Runs an Effect through the nearest Solid runtime and ties the fiber to component cleanup. */
export interface RuntimeEffectRunner<ER = never> {
  <A, E, R>(effect: Effect.Effect<A, E, R>, options?: ForkScopedOptions): Fiber.Fiber<A, E | ER>;
}

/** Solid-facing handle for an Sunfall Arc Program. */
export interface ProgramHandle<Model, Message, E = never, DispatchE = E> {
  readonly instance: Program.Instance<Model, Message, E, DispatchE>;
  /** Current centralized Program model. */
  readonly model: Accessor<Model>;
  /** Alias for `model`, useful in state-oriented UI code. */
  readonly state: Accessor<Model>;
  /** Typed update, command, and subscription failures reported by the Program loop. */
  readonly failures: Accessor<ReadonlyArray<ProgramFailure<Message, E>>>;
  /** Bounded runtime timeline for messages, commands, subscriptions, and failures. */
  readonly timeline: Accessor<ReadonlyArray<ProgramEvent<Model, Message, E>>>;
  /** Fire-and-forget dispatch for event handlers. */
  readonly dispatch: Program.Instance<Model, Message, E, DispatchE>["dispatch"];
  /** Effect dispatch that completes after the update commits, or fails if disposal drops it. */
  readonly dispatchEffect: Program.Instance<Model, Message, E, DispatchE>["dispatchEffect"];
  /** Clears accumulated failures. */
  clearFailures(): void;
  /** Clears retained timeline events without changing model or failures. */
  clearTimeline(): void;
}

type SolidActionInvalidationRequirements<A, R> = R | ActionResultInvalidationRequirements<A>;

type SolidActionRemainingRequirements<A, R> = Exclude<
  SolidActionInvalidationRequirements<A, R>,
  R | ResourceStore
>;

type SolidActionInstance<I, A, E, R, ER> = ActionInstance<
  I,
  A,
  E | ER,
  SolidActionRemainingRequirements<A, R>,
  E,
  R,
  SolidActionInvalidationRequirements<A, R>
>;

/**
 * Solid-facing handle for an Sunfall Arc Action.
 *
 * `result`, `input`, and `invalidationPlan` are Solid accessors bridged from
 * Core signals; `instance` keeps the lower-level Core controller available for
 * integrations.
 */
export interface ActionHandle<I, A, E = never, R = never, ER = never> {
  /** Underlying Core action instance for advanced integrations. */
  readonly instance: SolidActionInstance<I, A, E, R, ER>;
  /** Action definition used to create this instance. */
  readonly definition: Action.Definition<I, A, E, R>;
  /**
   * Submission `AsyncResult`: `Initial` while idle, `waiting` while a
   * submission is in flight, then `Success` or `Failure` (full `Cause`, latest
   * success kept as `previousSuccess`).
   */
  readonly result: Accessor<AsyncResult.AsyncResult<A, E | ER | EffectInputCallbackError>>;
  /** Input of the latest submission (`Option.none()` while idle). */
  readonly input: Accessor<Option.Option<I>>;
  /** Latest successful invalidation plan as a Solid accessor. */
  readonly invalidationPlan: Accessor<
    ResourceInvalidationPlan<SolidActionInvalidationRequirements<A, R>> | undefined
  >;
  /** Runs the action workflow as an Effect bound to the nearest Solid runtime. */
  readonly submitEffect: SolidActionInstance<I, A, E, R, ER>["submitEffect"];
  /** Resets the action state as an Effect. */
  readonly resetEffect: SolidActionInstance<I, A, E, R, ER>["resetEffect"];
  /** Synchronously resets the action state. */
  readonly reset: SolidActionInstance<I, A, E, R, ER>["reset"];
}

// Arc signals track natively in Solid computations: an accessor is just a read.
const accessor =
  <A>(signal: ReadableSignal<A>): Accessor<A> =>
  () =>
    signal.get();

/** Subscribes to an Effect stream through a Solid accessor. */
export const useStream = <A, R = never, ER = never>(
  stream: Stream.Stream<A, never, R>,
  initial: A,
): Accessor<A> => {
  const runtime = useRuntime<ER>();
  return createComponentScope((scope) => {
    const signal = Signal.make(initial);
    scope.fork(
      runtime.provide(
        stream.pipe(Stream.runForEach((value) => Effect.sync(() => signal.set(value)))),
      ),
    );
    return accessor(signal);
  });
};

/**
 * Returns a fire-and-forget runner bound to the nearest Solid runtime.
 *
 * Fibers started with the runner are interrupted when the component owner is
 * disposed, while the Effect value still controls the returned Fiber's success
 * and error types.
 */
export const useRuntimeEffect = <ER = never>(): RuntimeEffectRunner<ER> => {
  const runtime = useRuntime<ER>();
  return createComponentScope(
    (scope) =>
      (<A, E, R>(
        effect: Effect.Effect<A, E, R>,
        options?: ForkScopedOptions,
      ): Fiber.Fiber<A, E | ER> =>
        scope.fork(runtime.provide(effect), options)) as RuntimeEffectRunner<ER>,
  );
};

/**
 * Starts an Sunfall Arc Program and exposes its model, failures, and timeline as
 * Solid accessors.
 */
export const useProgram = <Model, Message, E = never, R = never, ER = never>(
  definition: Program.Definition<Model, Message, E, R>,
): ProgramHandle<Model, Message, Program.RuntimeError<E, ER>, Program.DispatchError<E, ER>> => {
  const runtime = useRuntime<ER>();
  const instance = createComponentScope(() =>
    runWithRuntime(runtime, () =>
      Program.start<Model, Message, E, R, ER>(definition, {
        runtime: runtime as unknown as SunfallArcRuntime<R, ER>,
      }),
    ),
  );
  const model = accessor(instance.model);
  const failures = accessor(instance.failures);
  const timeline = accessor(instance.timeline);

  return {
    instance,
    model,
    state: model,
    failures,
    timeline,
    dispatch: instance.dispatch,
    dispatchEffect: instance.dispatchEffect,
    clearFailures: instance.clearFailures,
    clearTimeline: instance.clearTimeline,
  };
};

/** Returns the reactive `AsyncResult` for a resource ref or ref accessor. */
export const useResourceResult = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>,
): Accessor<AsyncResult.AsyncResult<A, Resource.LoadError<E>>> => {
  return createResourceBinding(useRuntime<ER>(), ref, options).result;
};

/**
 * Creates a Solid handle for an Sunfall Arc resource.
 *
 * The hook subscribes to resource state, prefetches initial resources, and
 * exposes Effect-returning refresh/prefetch methods for event handlers or
 * composed workflows.
 *
 * @example
 * ```tsx
 * const project = useResource(() => ProjectResource(params.id));
 * return () =>
 *   AsyncResult.builder(project.result())
 *     .onInitial(() => "Loading")
 *     // Handle failure before success: `onSuccess` narrows the success type,
 *     // so `previousSuccess` is only typed when `onFailure` comes first.
 *     .onFailure((_cause, failed) =>
 *       Option.match(failed.previousSuccess, {
 *         onNone: () => "Could not load",
 *         onSome: (stale) => `${stale.value.name} (stale)`,
 *       }),
 *     )
 *     .onSuccess((value, success) => (success.waiting ? `${value.name}…` : value.name))
 *     .exhaustive();
 * ```
 */
export const useResource = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>,
): ResourceHandle<I, A, E, R, ER> => {
  const getRef = resourceUiRefAccessor(ref);
  const binding = createResourceBinding<I, A, E, R, ER>(useRuntime<ER>(), getRef, options);

  return {
    ref: getRef,
    result: binding.result,
    preloadFailure: binding.preloadFailure,
    refreshEffect: () => binding.controller.refreshEffect(getRef()),
    prefetchEffect: () => binding.controller.prefetchEffect(getRef()),
  };
};

/**
 * Async resource accessor for Solid render code.
 *
 * Cached values return synchronously, so hydrated data renders without a
 * loading state. Pending or expired reads start `Resource.prefetchEffect(...)`
 * in the active runtime and return its Promise, which suspends the nearest
 * Solid `<Loading>` boundary. Failed loads throw `ResourceFailure` (its
 * `result` is the settled `AsyncResult.Failure`, with stale data as
 * `previousSuccess`) to the nearest `<Errored>` boundary.
 */
export const useResourceSuspense = <I, A, E, R = unknown>(
  ref: ResourceInput<I, A, E, R>,
): Accessor<A> => createResourceSuspense(useRuntime(), ref);

/**
 * Creates an Action instance bound to the nearest Solid runtime.
 *
 * The Solid runtime context erases the concrete service set, so the returned
 * `submitEffect` is runtime-bound by default. Pass the `ER` generic when the
 * nearest runtime has a known startup/acquisition error channel you want
 * reflected in the hook type.
 */
export const useAction = <I, A, E, R, ER = never>(
  definition: Action.Definition<I, A, E, R>,
): ActionHandle<I, A, E, R, ER> => {
  const runtime = useRuntime() as SunfallArcRuntime<R, ER>;
  const instance = Action.use(definition, { runtime });
  const result = () => instance.state.get().result;
  const input = () => instance.state.get().input;
  const invalidationPlan = accessor(instance.invalidationPlan);

  onCleanup(() => {
    instance.reset();
  });

  return {
    instance,
    definition: instance.definition,
    result,
    input,
    invalidationPlan,
    submitEffect: instance.submitEffect,
    resetEffect: instance.resetEffect,
    reset: instance.reset,
  };
};
