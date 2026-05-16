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
  runWithScope,
  resourceUiMatchState,
  resourceUiPreloadFailureFor,
  resourceUiRefValue,
  resourceUiStateHasValue,
  Signal,
  type ActionInstance,
  type ActionResultInvalidationRequirements,
  type EffectUiRuntime,
  type ForkScopedOptions,
  type ProgramEvent,
  type ProgramFailure,
  type ReadableSignal,
  type ResourceUiInput,
  type ResourceUiBindingController,
  type ResourceUiMatch,
  type ResourceUiPreloadFailure,
  type ResourceUiSuccessMeta,
  type ResourceRef,
  type ResourceState,
  type ResourceStore,
  type UiScope,
  type WritableSignal
} from "@effect-ui/core";
import { Effect, Fiber, Stream } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { useComponentScope, useRuntime } from "./runtime.js";

type ResourceInput<I, A, E, R = unknown> = ResourceUiInput<I, A, E, R>;

/** Metadata passed to resource success render branches. */
export type ResourceSuccessMeta<A, E> = ResourceUiSuccessMeta<A, E>;

/** Exhaustive render cases for `ResourceHandle.match`. */
export type ResourceMatch<A, E, B> = ResourceUiMatch<A, E, B>;

/** Options for binding a Resource to React reactivity. */
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
 * React-facing handle for an Effect UI resource.
 *
 * Values update through React's external-store subscription API.
 * `refreshEffect` and `prefetchEffect` keep resource work in Effect and are
 * bound to the nearest React runtime.
 */
export interface ResourceHandle<I, A, E, R = unknown, ER = never> {
  /** Current resource ref, tracking ref functions during React render. */
  readonly ref: ResourceRef<I, A, E, R>;
  /** Current resource state bound to the nearest React runtime. */
  readonly state: ResourceState<A, Resource.LoadError<E>>;
  /** Latest successful value or stale previous value while pending/failing. */
  readonly value: A | undefined;
  /** Latest load error, including server/client transport errors. */
  readonly error: Resource.LoadError<E> | undefined;
  /** True for initial pending loads without a value. */
  readonly waiting: boolean;
  /** True while reloading with a previous value available. */
  readonly refreshing: boolean;
  /** True when `value` can return a value. */
  readonly hasValue: boolean;
  /** Failure captured from the automatic mount-time preload, if enabled. */
  readonly preloadFailure: Resource.LoadError<E> | ER | undefined;
  /** Runs a forced refresh in the bound runtime. */
  refreshEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
  /** Ensures the resource has loaded in the bound runtime. */
  prefetchEffect(): Effect.Effect<A, Resource.LoadError<E> | ER>;
  /** Exhaustively maps the current state to render output. */
  match<B>(cases: ResourceMatch<A, Resource.LoadError<E>, B>): B;
}

/** Runs an Effect through the nearest React runtime and ties the fiber to component cleanup. */
export interface RuntimeEffectRunner<ER = never> {
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: ForkScopedOptions
  ): Fiber.Fiber<A, E | ER>;
}

/** React-facing handle for an Effect UI Program. */
export interface ProgramHandle<Model, Message, E = never> {
  readonly instance: Program.Instance<Model, Message, E>;
  /** Current centralized Program model. */
  readonly model: Model;
  /** Alias for `model`, useful in state-oriented UI code. */
  readonly state: Model;
  /** Typed update, command, and subscription failures reported by the Program loop. */
  readonly failures: ReadonlyArray<ProgramFailure<Message, E>>;
  /** Bounded runtime timeline for messages, commands, subscriptions, and failures. */
  readonly timeline: ReadonlyArray<ProgramEvent<Model, Message, E>>;
  /** Fire-and-forget dispatch for event handlers. */
  dispatch(message: Message): void;
  /** Effect dispatch that completes after the update for this message has run. */
  dispatchEffect(message: Message): Effect.Effect<void, ProgramFailure<Message, E>>;
  /** Clears accumulated failures. */
  clearFailures(): void;
}

type ReactProgramRuntimeError<E, ER> = Program.RuntimeError<E, ER>;

interface ProgramBinding<Model, Message, RuntimeError> {
  current: Program.Instance<Model, Message, RuntimeError> | undefined;
  readonly model: WritableSignal<Model>;
  readonly failures: WritableSignal<ReadonlyArray<ProgramFailure<Message, RuntimeError>>>;
  readonly timeline: WritableSignal<ReadonlyArray<ProgramEvent<Model, Message, RuntimeError>>>;
  instance: Program.Instance<Model, Message, RuntimeError>;
}

interface ResourceBinding<I, A, E, R, ER> {
  readonly state: ResourceState<A, Resource.LoadError<E>>;
  readonly preloadFailure: Resource.LoadError<E> | ER | undefined;
  readonly controller: ResourceUiBindingController<I, A, E, R, ER>;
}

/** Bridges an Effect UI readable signal into a React value. */
export const useSignal = <A>(signal: ReadableSignal<A>): A => {
  const subscribe = useCallback((notify: () => void) => signal.subscribe(notify), [signal]);
  const getSnapshot = useCallback(() => coreRead(signal), [signal]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

/** Subscribes to an Effect stream through a React value. */
export const useStream = <A, R = never, ER = never>(
  stream: Stream.Stream<A, never, R>,
  initial: A
): A => {
  const runtime = useRuntime<ER>();
  const scope = useComponentScope();
  const signal = useMemo(() => Signal.make(initial), [initial]);

  useEffect(() => {
    const fiber = scope.fork(
      runtime.provide(
        stream.pipe(
          Stream.runForEach((value) => Effect.sync(() => signal.set(value)))
        )
      )
    );

    return () => {
      void runtime.runFork(Fiber.interrupt(fiber).pipe(Effect.catch(() => Effect.void)));
    };
  }, [runtime, scope, signal, stream]);

  return useSignal(signal);
};

/**
 * Returns a fire-and-forget runner bound to the nearest React runtime.
 *
 * Fibers started with the runner are interrupted when the component is
 * disposed, while the Effect value still controls the returned Fiber's success
 * and error types.
 */
export const useRuntimeEffect = <ER = never>(): RuntimeEffectRunner<ER> => {
  const runtime = useRuntime<ER>();
  const scope = useComponentScope();

  return useCallback(
    (<A, E, R>(
      effect: Effect.Effect<A, E, R>,
      options?: ForkScopedOptions
    ): Fiber.Fiber<A, E | ER> =>
      scope.fork(runtime.provide(effect), options)) as RuntimeEffectRunner<ER>,
    [runtime, scope]
  );
};

const makeProgramBinding = <Model, Message, RuntimeError>(
  initial: Model
): ProgramBinding<Model, Message, RuntimeError> => {
  const binding = {
    current: undefined,
    model: Signal.make(initial),
    failures: Signal.make<ReadonlyArray<ProgramFailure<Message, RuntimeError>>>([]),
    timeline: Signal.make<ReadonlyArray<ProgramEvent<Model, Message, RuntimeError>>>([])
  } as ProgramBinding<Model, Message, RuntimeError>;

  const disposeCurrentEffect: Effect.Effect<void> = Effect.suspend(() => {
    const current = binding.current;
    binding.current = undefined;
    return current?.disposeEffect ?? Effect.void;
  });

  binding.instance = {
    model: binding.model,
    state: binding.model,
    failures: binding.failures,
    timeline: binding.timeline,
    dispatch: (message) => {
      binding.current?.dispatch(message);
    },
    dispatchEffect: (message) =>
      Effect.suspend(() => binding.current?.dispatchEffect(message) ?? Effect.void),
    clearFailures: () => {
      binding.failures.set([]);
      binding.current?.clearFailures();
    },
    clearTimeline: () => {
      binding.timeline.set([]);
      binding.current?.clearTimeline();
    },
    disposeEffect: disposeCurrentEffect
  };

  return binding;
};

/** Starts an Effect UI Program and exposes its model as React values. */
export const useProgram = <Model, Message, E = never, R = never, ER = never>(
  definition: Program.Definition<Model, Message, E, R>
): ProgramHandle<Model, Message, Program.RuntimeError<E, ER>> => {
  const runtime = useRuntime<ER>();
  const scope = useComponentScope();
  type RuntimeError = ReactProgramRuntimeError<E, ER>;
  const binding = useMemo(
    () => makeProgramBinding<Model, Message, RuntimeError>(definition.initial),
    [definition, runtime, scope]
  );

  useLayoutEffect(() => {
    const started = runWithRuntime(runtime, () =>
      runWithScope(scope, () =>
        Program.start<Model, Message, E, R, ER>(definition, {
          runtime: runtime as unknown as EffectUiRuntime<R, ER>
        })
      )
    );
    binding.current = started;

    const syncModel = () => binding.model.set(coreRead(started.model));
    const syncFailures = () => binding.failures.set(coreRead(started.failures));
    const syncTimeline = () => binding.timeline.set(coreRead(started.timeline));
    syncModel();
    syncFailures();
    syncTimeline();

    const unsubscribeModel = started.model.subscribe(syncModel);
    const unsubscribeFailures = started.failures.subscribe(syncFailures);
    const unsubscribeTimeline = started.timeline.subscribe(syncTimeline);

    return () => {
      unsubscribeModel();
      unsubscribeFailures();
      unsubscribeTimeline();
      if (binding.current === started) {
        binding.current = undefined;
      }
      void runtime.runFork(started.disposeEffect.pipe(Effect.catch(() => Effect.void)));
    };
  }, [binding, definition, runtime, scope]);

  const instance = binding.instance;
  const model = useSignal(binding.model);
  const failures = useSignal(binding.failures);
  const timeline = useSignal(binding.timeline);

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

const useResourceBinding = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options: UseResourceOptions<E, ER> = {}
): ResourceBinding<I, A, E, R, ER> => {
  const runtime = useRuntime<ER>();
  const currentRef = resourceUiRefValue(ref);
  const [preloadFailure, setPreloadFailure] = useState<ResourceUiPreloadFailure<I, A, E, R, ER> | undefined>(undefined);
  const preloadFailureObserver = useRef(options.onPreloadFailure);
  preloadFailureObserver.current = options.onPreloadFailure;
  const controller = useMemo(
    () =>
      makeResourceUiBindingController<I, A, E, R, ER>({
        runtime,
        onPreloadFailureChange: setPreloadFailure
      }),
    [runtime]
  );
  const result = useMemo(
    () => controller.result(currentRef),
    [controller, currentRef.family, currentRef.key]
  );
  const state = useSignal(result);

  useEffect(() => {
    return () => {
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.startInitialPreload(currentRef, {
      ...(options.preload === undefined ? {} : { preload: options.preload }),
      ...(preloadFailureObserver.current === undefined
        ? {}
        : { onPreloadFailure: preloadFailureObserver.current })
    });
    return () => {
      controller.interruptPreload();
    };
  }, [controller, result, currentRef.family, currentRef.key, options.preload]);

  return {
    state,
    preloadFailure: resourceUiPreloadFailureFor(preloadFailure, currentRef),
    controller
  };
};

/** Returns the reactive `ResourceState` for a resource ref or ref function. */
export const useResourceResult = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): ResourceState<A, Resource.LoadError<E>> => {
  return useResourceBinding(ref, options).state;
};

/** Returns the latest successful value for a resource, if one exists. */
export const useResourceValue = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): A | undefined => {
  const state = useResourceResult(ref, options);
  return Resource.value(state);
};

/** Returns the latest resource error, if the resource is failed. */
export const useResourceError = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): Resource.LoadError<E> | undefined => {
  const state = useResourceResult(ref, options);
  return Resource.error(state);
};

/**
 * Creates a React handle for an Effect UI resource.
 *
 * The hook subscribes to resource state, prefetches initial resources, and
 * exposes Effect-returning refresh/prefetch methods for event handlers or
 * composed workflows.
 */
export const useResource = <I, A, E, R = unknown, ER = never>(
  ref: ResourceInput<I, A, E, R>,
  options?: UseResourceOptions<E, ER>
): ResourceHandle<I, A, E, R, ER> => {
  const currentRef = resourceUiRefValue(ref);
  const binding = useResourceBinding<I, A, E, R, ER>(currentRef, options);
  const state = binding.state;
  const value = Resource.value(state);
  const error = Resource.error(state);
  const waiting = state.waiting;
  const hasValue = resourceUiStateHasValue(state);
  const refreshing = state._tag === "Pending" && "previous" in state;

  return {
    ref: currentRef,
    state,
    value,
    error,
    waiting,
    refreshing,
    hasValue,
    preloadFailure: binding.preloadFailure,
    refreshEffect: () => binding.controller.refreshEffect(currentRef),
    prefetchEffect: () => binding.controller.prefetchEffect(currentRef),
    match: (cases) => resourceUiMatchState(state, cases)
  };
};

/**
 * Suspense-style resource value for React render code.
 *
 * Cached values are returned synchronously. Failed loads throw
 * `ResourceFailure` with the stale value when available. Pending or expired
 * reads start `Resource.prefetchEffect(...)` in the active runtime and throw
 * the Promise React Suspense expects at this UI Adapter seam.
 */
export const useResourceSuspense = <I, A, E, R = unknown>(
  ref: ResourceInput<I, A, E, R>
): A => {
  const runtime = useRuntime();
  const currentRef = resourceUiRefValue(ref);
  const state = useResourceResult(currentRef);
  const preloadController = useMemo(
    () => makeResourceUiSuspensePreloadController<I, A, E, R, unknown, unknown>(runtime),
    [runtime]
  );

  useEffect(() => {
    return () => {
      preloadController.dispose();
    };
  }, [preloadController]);

  const suspensePreload = (nextRef: ResourceRef<I, A, E, R>) => {
    return preloadController.hostToken(nextRef, {
      toHostToken: (fiber) => Effect.runPromise(Fiber.join(fiber))
    });
  };

  preloadController.interruptStale(currentRef);

  void state;

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

  throw suspensePreload(currentRef);
};

/**
 * Creates an Action instance bound to the nearest React runtime.
 *
 * The React runtime context erases the concrete service set, so the returned
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
  const runtime = useRuntime<ER>() as EffectUiRuntime<R, ER>;
  const instanceRef = useRef<{
    readonly definition: Action.Definition<I, A, E, R>;
    readonly runtime: EffectUiRuntime<R, ER>;
    readonly instance: ActionInstance<
      I,
      A,
      E | ER,
      Exclude<R | ActionResultInvalidationRequirements<A>, R | ResourceStore>,
      E,
      R,
      R | ActionResultInvalidationRequirements<A>
    >;
  } | undefined>(undefined);

  if (
    instanceRef.current === undefined ||
    instanceRef.current.definition !== definition ||
    instanceRef.current.runtime !== runtime
  ) {
    instanceRef.current = {
      definition,
      runtime,
      instance: Action.use(definition, { runtime })
    };
  }

  const instance = instanceRef.current.instance;

  useEffect(() => {
    return () => {
      void runtime.runFork(instance.resetEffect().pipe(Effect.catch(() => Effect.void)));
    };
  }, [runtime, instance]);

  return instance;
};
