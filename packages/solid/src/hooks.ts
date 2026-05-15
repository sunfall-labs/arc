import {
  Action,
  Program,
  read as coreRead,
  Resource,
  ResourceFailure,
  ResourcePending,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  runWithRuntime,
  resourceUiMatchState,
  resourceUiPreloadFailureFor,
  resourceUiRefAccessor,
  resourceUiSameRef,
  resourceUiStateHasValue,
  Signal,
  type ActionInstance,
  type ActionResultInvalidationRequirements,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type ForkScopedOptions,
  type ProgramEvent,
  type ProgramFailure,
  type ReadableSignal,
  type ResourceUiBindingController,
  type ResourceUiInput,
  type ResourceUiMatch,
  type ResourceUiPreloadFailure,
  type ResourceUiSuccessMeta,
  type ResourceRef,
  type ResourceStore,
  type ResourceState
} from "@effect-ui/core";
import { Effect, Fiber, Stream } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor
} from "solid-js";
import { createComponentScope, useRuntime } from "./runtime.js";

type ResourceInput<I, A, E, R = unknown> = ResourceUiInput<I, A, E, R>;

/** Metadata passed to resource success render branches. */
export type ResourceSuccessMeta<A, E> = ResourceUiSuccessMeta<A, E>;

/** Exhaustive render cases for `ResourceHandle.match`. */
export type ResourceMatch<A, E, B> = ResourceUiMatch<A, E, B>;

/** Options for binding a Resource to Solid reactivity. */
export interface UseResourceOptions<E = never, ER = never> {
  /** Start loading on mount. Defaults to true. */
  readonly preload?: boolean;
  /**
   * Observe failures from the automatic mount-time preload.
   *
   * The error is `Resource.LoadError<E> | ER`, so callback throws and runtime
   * startup/provision failures are reported beside the resource's own error
   * channel. If this observer throws, the hook ignores that throw after
   * updating `preloadFailure`.
   */
  readonly onPreloadFailure?: (error: Resource.LoadError<E> | ER) => void;
}

/**
 * Solid-facing handle for an Effect UI resource.
 *
 * Accessors track resource state reactively. `refreshEffect` and
 * `prefetchEffect` keep resource work in Effect and are bound to the nearest
 * Solid runtime.
 */
export interface ResourceHandle<I, A, E, R = unknown, ER = never> {
  /** Current resource ref, tracking ref accessors when the input ref is reactive. */
  readonly ref: Accessor<ResourceRef<I, A, E, R>>;
  /** Current resource state bound to the nearest Solid runtime. */
  readonly state: Accessor<ResourceState<A, Resource.LoadError<E>>>;
  /** Latest successful value or stale previous value while pending/failing. */
  readonly value: Accessor<A | undefined>;
  /** Latest load error, including server/client transport errors. */
  readonly error: Accessor<Resource.LoadError<E> | undefined>;
  /** True for initial pending loads without a value. */
  readonly waiting: Accessor<boolean>;
  /** True while reloading with a previous value available. */
  readonly refreshing: Accessor<boolean>;
  /** True when `value()` can return a value. */
  readonly hasValue: Accessor<boolean>;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Accessor<Resource.LoadError<E> | ER | undefined>;
  /** Runs a forced refresh in the bound runtime. */
  refreshEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
  /** Ensures the resource has loaded in the bound runtime. */
  prefetchEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
  /** Exhaustively maps the current state to render output. */
  match<B>(cases: ResourceMatch<A, Resource.LoadError<E>, B>): B;
}

/** Runs an Effect through the nearest Solid runtime and ties the fiber to component cleanup. */
export interface RuntimeEffectRunner<ER = never> {
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: ForkScopedOptions
  ): Fiber.Fiber<A, E | ER>;
}

/** Solid-facing handle for an Effect UI Program. */
export interface ProgramHandle<Model, Message, E = never> {
  readonly instance: Program.Instance<Model, Message, E>;
  /** Current centralized Program model. */
  readonly model: Accessor<Model>;
  /** Alias for `model`, useful in state-oriented UI code. */
  readonly state: Accessor<Model>;
  /** Typed update, command, and subscription failures reported by the Program loop. */
  readonly failures: Accessor<ReadonlyArray<ProgramFailure<Message, E>>>;
  /** Bounded runtime timeline for messages, commands, subscriptions, and failures. */
  readonly timeline: Accessor<ReadonlyArray<ProgramEvent<Model, Message, E>>>;
  /** Fire-and-forget dispatch for event handlers. */
  dispatch(message: Message): void;
  /** Effect dispatch that completes after the update for this message has run. */
  dispatchEffect(message: Message): Effect.Effect<void, ProgramFailure<Message, E>>;
  /** Clears accumulated failures. */
  clearFailures(): void;
}

interface ResourceBinding<I, A, E, R, ER> {
  readonly state: Accessor<ResourceState<A, Resource.LoadError<E>>>;
  readonly preloadFailure: Accessor<Resource.LoadError<E> | ER | undefined>;
  readonly controller: ResourceUiBindingController<I, A, E, R, ER>;
}

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
export const useStream = <A, R = never, ER = never>(
  stream: Stream.Stream<A, never, R>,
  initial: A
): Accessor<A> => {
  const runtime = useRuntime<ER>();
  return createComponentScope((scope) => {
    const signal = Signal.make(initial);
    scope.fork(
      runtime.provide(
        stream.pipe(
          Stream.runForEach((value) => Effect.sync(() => signal.set(value)))
        )
      )
    );
    return useSignal(signal);
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
  return createComponentScope((scope) =>
    (<A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: ForkScopedOptions
    ): Fiber.Fiber<A, E | ER> =>
      scope.fork(runtime.provide(effect), options)) as RuntimeEffectRunner<ER>
  );
};

/** Starts an Effect UI Program and exposes its model as Solid accessors. */
export const useProgram = <Model, Message, E = never, R = never, ER = never>(
  definition: Program.Definition<Model, Message, E, R>
): ProgramHandle<Model, Message, Program.RuntimeError<E, ER>> => {
  const runtime = useRuntime<ER>();
  const instance = createComponentScope(() =>
    runWithRuntime(runtime, () => Program.start<Model, Message, E, R, ER>(definition))
  );
  const model = useSignal(instance.model);
  const failures = useSignal(instance.failures);
  const timeline = useSignal(instance.timeline);

  return {
    instance,
    model,
    state: model,
    failures,
    timeline,
    dispatch: instance.dispatch,
    dispatchEffect: instance.dispatchEffect,
    clearFailures: instance.clearFailures
  };
};

const createResourceBinding = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options: UseResourceOptions<E, ER> = {}
): ResourceBinding<I, A, E, R, ER> => {
  const runtime = useRuntime<ER>();
  const getRef = resourceUiRefAccessor(ref);
  const controller = makeResourceUiBindingController<I, A, E, R, ER>({
    runtime,
    onPreloadFailureChange: (failure) => {
      setPreloadFailure(() => failure);
    }
  });
  const [stateSignal, setState] = createSignal<ResourceState<A, Resource.LoadError<E>>>(resourceResult(getRef()).get());
  const [preloadFailure, setPreloadFailure] = createSignal<ResourceUiPreloadFailure<I, A, E, R, ER> | undefined>(undefined);
  let currentRef: ResourceRef<I, A, E, R> | undefined;
  let unsubscribe: (() => void) | undefined;

  function resourceResult(currentRef: ResourceRef<I, A, E, R>) {
    return controller.result(currentRef);
  }

  const bindRef = (nextRef: ResourceRef<I, A, E, R>): void => {
    if (currentRef !== undefined && resourceUiSameRef(currentRef, nextRef)) {
      return;
    }

    currentRef = nextRef;
    controller.bindRef(nextRef);
    unsubscribe?.();

    const result = resourceResult(nextRef);
    setState(() => result.get());
    unsubscribe = result.subscribe(() => setState(() => result.get()));
    controller.startInitialPreload(nextRef, options);
  };

  bindRef(getRef());

  createEffect(() => {
    bindRef(getRef());
  });

  onCleanup(() => {
    controller.dispose();
    unsubscribe?.();
  });

  return {
    state: () => {
      bindRef(getRef());
      return stateSignal();
    },
    preloadFailure: () => {
      const failure = preloadFailure();
      return currentRef === undefined
        ? undefined
        : resourceUiPreloadFailureFor(failure, currentRef);
    },
    controller
  };
};

/** Returns the reactive `ResourceState` for a resource ref or ref accessor. */
export const useResourceResult = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): Accessor<ResourceState<A, Resource.LoadError<E>>> => {
  return createResourceBinding(ref, options).state;
};

/**
 * Returns the latest successful value for a resource, if one exists.
 *
 * This convenience hook owns one resource subscription. Use `useResource(...)`
 * when a component needs multiple selectors for the same ref.
 */
export const useResourceValue = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): Accessor<A | undefined> => {
  const state = useResourceResult(ref, options);
  return () => Resource.value(state());
};

/**
 * Returns the latest resource error, if the resource is failed.
 *
 * This convenience hook owns one resource subscription. Use `useResource(...)`
 * when a component needs multiple selectors for the same ref.
 */
export const useResourceError = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): Accessor<Resource.LoadError<E> | undefined> => {
  const state = useResourceResult(ref, options);
  return () => Resource.error(state());
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
export const useResource = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): ResourceHandle<I, A, E, R, ER> => {
  const getRef = resourceUiRefAccessor(ref);
  const binding = createResourceBinding<I, A, E, R, ER>(getRef, options);
  const state = binding.state;
  const value = () => Resource.value(state());
  const error = () => Resource.error(state());
  const waiting = () => state().waiting;
  const hasValue = () => resourceUiStateHasValue(state());
  const refreshing = () => {
    const current = state();
    return current._tag === "Pending" && "previous" in current;
  };

  return {
    ref: getRef,
    state,
    value,
    error,
    waiting,
    refreshing,
    hasValue,
    preloadFailure: binding.preloadFailure,
    refreshEffect: () => binding.controller.refreshEffect(getRef()),
    prefetchEffect: () => binding.controller.prefetchEffect(getRef()),
    match: (cases) => resourceUiMatchState(state(), cases)
  };
};

/**
 * Suspense-style resource accessor for Solid render code.
 *
 * Cached values are returned synchronously. Failed loads throw `ResourceFailure`
 * with the stale value when available. Pending or expired reads start
 * `Resource.prefetchEffect(...)` in the active runtime and throw the Promise
 * Solid Suspense expects at this UI Adapter seam.
 */
export const useResourceSuspense = <I, A, E, R = unknown>(ref: ResourceInput<I, A, E, R>): Accessor<A> => {
  const runtime = useRuntime();
  const getRef = resourceUiRefAccessor(ref);
  const state = useResourceResult(getRef);
  return createComponentScope((scope) => {
    const preloadController = makeResourceUiSuspensePreloadController<I, A, E, R, unknown, unknown>(runtime);
    scope.addFinalizer(() => Effect.sync(preloadController.dispose));

    return () => {
      const currentRef = getRef();
      preloadController.interruptStale(currentRef);
      state();

      try {
        return runWithRuntime(runtime, () => Resource.read(currentRef));
      } catch (error) {
        if (error instanceof ResourceFailure) {
          throw error;
        }
        if (!(error instanceof ResourcePending)) {
          throw error;
        }
      }

      throw preloadController.hostToken(currentRef, {
        fork: (effect) => scope.fork(runtime.provide(effect)),
        toHostToken: (fiber) => Effect.runPromise(Fiber.join(fiber))
      });
    };
  });
};

/**
 * Creates an Action instance bound to the nearest Solid runtime.
 *
 * The Solid runtime context erases the concrete service set, so the returned
 * `submitEffect` is runtime-bound by default. Pass the `ER` generic when the
 * nearest runtime has a known startup/acquisition error channel you want
 * reflected in the hook type.
 */
export const useAction = <I, A, E, R, ER = never>(
  definition: Action.Definition<I, A, E, R>
): ActionInstance<
  I,
  A,
  E | ER,
  Exclude<R | ActionResultInvalidationRequirements<A>, R | ResourceStore>,
  E,
  R,
  R | ActionResultInvalidationRequirements<A>
> => {
  const runtime = useRuntime() as EffectUiRuntime<R, ER>;
  const instance = Action.use(definition, { runtime });

  onCleanup(() => {
    void runtime.runFork(instance.resetEffect().pipe(Effect.catch(() => Effect.void)));
  });

  return instance;
};
