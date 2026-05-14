import {
  Action,
  read as coreRead,
  Resource,
  ResourceFailure,
  runWithRuntime,
  Signal,
  type ActionInstance,
  type EffectUiRuntime,
  type ReadableSignal,
  type ResourceRef,
  type ResourceState
} from "@effect-ui/core";
import { Effect, type Stream } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor
} from "solid-js";
import { isServer } from "solid-js/web";
import { createComponentScope, useRuntime } from "./runtime.js";

type ResourceInput<I, A, E, R = unknown> = ResourceRef<I, A, E, R> | (() => ResourceRef<I, A, E, R>);

/** Metadata passed to resource success render branches. */
export interface ResourceSuccessMeta<A, E> {
  readonly refreshing: boolean;
  readonly state: ResourceState<A, E>;
}

/** Exhaustive render cases for `ResourceHandle.match`. */
export interface ResourceMatch<A, E, B> {
  readonly initial: () => B;
  readonly pending: (previous: A | undefined) => B;
  readonly success: (value: A, meta: ResourceSuccessMeta<A, E>) => B;
  readonly failure: (error: E, previous: A | undefined) => B;
}

/**
 * Solid-facing handle for an Effect UI resource.
 *
 * Accessors track resource state reactively. `refreshEffect` and
 * `prefetchEffect` keep resource work in Effect so callers can compose it with
 * the active runtime instead of starting Promise work implicitly.
 */
export interface ResourceHandle<I, A, E, R = unknown> {
  readonly ref: Accessor<ResourceRef<I, A, E, R>>;
  readonly state: Accessor<ResourceState<A, E>>;
  readonly value: Accessor<A | undefined>;
  readonly error: Accessor<E | undefined>;
  readonly waiting: Accessor<boolean>;
  readonly refreshing: Accessor<boolean>;
  readonly hasValue: Accessor<boolean>;
  refreshEffect(): Effect.Effect<A, E, R>;
  prefetchEffect(): Effect.Effect<A, E, R>;
  match<B>(cases: ResourceMatch<A, E, B>): B;
}

const resourceAccessor = <I, A, E, R>(
  ref: ResourceInput<I, A, E, R>
): (() => ResourceRef<I, A, E, R>) =>
  typeof ref === "function" ? (ref as () => ResourceRef<I, A, E, R>) : () => ref;

const stateHasValue = <A, E>(state: ResourceState<A, E>): boolean => {
  switch (state._tag) {
    case "Success":
      return true;
    case "Pending":
    case "Failure":
      return "previous" in state;
    case "Initial":
      return false;
  }
};

/** Bridges an Effect UI readable signal into a Solid accessor. */
export const useSignal = <A>(signal: ReadableSignal<A>): Accessor<A> => {
  const [value, setValue] = createSignal(coreRead(signal));
  const unsubscribe = signal.subscribe(() => {
    setValue(() => coreRead(signal));
  });
  onCleanup(unsubscribe);
  return value;
};

/** Subscribes to an Effect stream through a Solid accessor. */
export const useStream = <A>(
  stream: Stream.Stream<A, never, never>,
  initial: A
): Accessor<A> =>
  createComponentScope(() => {
    if (isServer) {
      return () => initial;
    }

    const signal = Signal.fromStream(stream, initial);
    return useSignal(signal);
  });

/** Returns the reactive `ResourceState` for a resource ref or ref accessor. */
export const useResourceResult = <I, A, E, R = unknown>(
  ref: ResourceInput<I, A, E, R>
): Accessor<ResourceState<A, E>> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const resourceResult = (currentRef: ResourceRef<I, A, E, R>) =>
    runWithRuntime(runtime, () => Resource.result(currentRef));
  const [state, setState] = createSignal<ResourceState<A, E>>(resourceResult(getRef()).get());
  let unsubscribe: (() => void) | undefined;

  createEffect(() => {
    unsubscribe?.();

    const currentRef = getRef();
    const result = resourceResult(currentRef);
    setState(() => result.get());
    unsubscribe = result.subscribe(() => setState(() => result.get()));

    if (result.get()._tag === "Initial") {
      void runtime.runFork(
        Resource.prefetchEffect(currentRef).pipe(
          Effect.catch(() => Effect.void)
        )
      );
    }
  });

  onCleanup(() => {
    unsubscribe?.();
  });

  return state;
};

/** Returns the latest successful value for a resource, if one exists. */
export const useResourceValue = <I, A, E, R = unknown>(
  ref: ResourceInput<I, A, E, R>
): Accessor<A | undefined> => {
  const state = useResourceResult(ref);
  return createMemo(() => Resource.value(state()));
};

/** Returns the latest resource error, if the resource is failed. */
export const useResourceError = <I, A, E, R = unknown>(
  ref: ResourceInput<I, A, E, R>
): Accessor<E | undefined> => {
  const state = useResourceResult(ref);
  return createMemo(() => Resource.error(state()));
};

/**
 * Creates a Solid handle for an Effect UI resource.
 *
 * The hook subscribes to resource state, prefetches initial resources, and
 * exposes Effect-returning refresh/prefetch methods for event handlers or
 * composed workflows.
 *
 * @example
 * ```tsx
 * const project = useResource(() => ProjectResource(params.id));
 * return project.match({
 *   initial: () => null,
 *   pending: () => "Loading",
 *   success: (value) => value.name,
 *   failure: () => "Could not load"
 * });
 * ```
 */
export const useResource = <I, A, E, R = unknown>(ref: ResourceInput<I, A, E, R>): ResourceHandle<I, A, E, R> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const state = useResourceResult(getRef);
  const value = createMemo(() => Resource.value(state()));
  const error = createMemo(() => Resource.error(state()));
  const waiting = createMemo(() => state().waiting);
  const hasValue = createMemo(() => stateHasValue(state()));
  const refreshing = createMemo(() => {
    const current = state();
    return current._tag === "Pending" && "previous" in current;
  });

  return {
    ref: getRef,
    state,
    value,
    error,
    waiting,
    refreshing,
    hasValue,
    refreshEffect: () => Resource.refreshEffect(getRef()),
    prefetchEffect: () => Resource.prefetchEffect(getRef()),
    match: (cases) => {
      const current = state();
      switch (current._tag) {
        case "Initial":
          return cases.initial();
        case "Pending":
          return cases.pending(current.previous);
        case "Success":
          return cases.success(current.value, { refreshing: false, state: current });
        case "Failure":
          return cases.failure(current.error, current.previous);
      }
    }
  };
};

/** Suspense-style resource accessor that throws pending work or failures. */
export const useResourceSuspense = <I, A, E, R = unknown>(ref: ResourceInput<I, A, E, R>): Accessor<A> => {
  const runtime = useRuntime();
  const getRef = resourceAccessor(ref);
  const state = useResourceResult(getRef);
  return createMemo(() => {
    const current = state();
    const value = Resource.value(current);
    if (value !== undefined) {
      return value;
    }

    if (current._tag === "Failure") {
      throw new ResourceFailure({
        ref: getRef() as ResourceRef<unknown, A, E, unknown>,
        error: current.error,
        previous: current.previous
      });
    }

    return runWithRuntime(runtime, () => Resource.read(getRef()));
  });
};

/** Creates an Action instance bound to the nearest Solid runtime. */
export const useAction = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>
): ActionInstance<I, A, E, R> => Action.use(definition, { runtime: useRuntime() as EffectUiRuntime<R, unknown> });
