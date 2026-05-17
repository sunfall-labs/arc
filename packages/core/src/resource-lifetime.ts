import { Effect, Fiber } from "effect";
import { parseDuration } from "./resource-duration.js";
import { publishResourceStoreEvent } from "./resource-events.js";
import type { ResourceRef, ResourceState, ResourceStatus } from "./resource.js";
import {
  resourceStoreFiber,
  type MutableResourceStore as ResourceStoreState,
} from "./resource-store.js";
import { Signal, type WritableSignal } from "./signal.js";

export interface ResourceInFlight<A, E> {
  readonly token: object;
  readonly force: boolean;
  fiber: Fiber.Fiber<A, E>;
}

export interface ResourceLifetimeEntry<A, E> {
  readonly state: WritableSignal<ResourceState<A, E>>;
  inFlight: ResourceInFlight<A, E> | undefined;
  gcFiber: Fiber.Fiber<void, never> | undefined;
}

export type PreviousResourceValue<A> =
  | {
      readonly present: true;
      readonly value: A;
    }
  | {
      readonly present: false;
    };

export const makeResourceEntry = <A, E>(): ResourceLifetimeEntry<A, E> => ({
  state: Signal.make<ResourceState<A, E>>({ _tag: "Initial", waiting: false }),
  inFlight: undefined,
  gcFiber: undefined,
});

export const previousResourceValue = <A, E>(
  state: ResourceState<A, E>,
): PreviousResourceValue<A> => {
  switch (state._tag) {
    case "Success":
      return { present: true, value: state.value };
    case "Pending":
    case "Failure":
      return "previous" in state
        ? { present: true, value: state.previous as A }
        : { present: false };
    case "Initial":
      return { present: false };
  }
};

export const isResourceStateStale = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: ResourceState<A, E>,
  now: number,
): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  return staleFor > 0 && now - state.updatedAt > staleFor;
};

export const isResourceStateCollected = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: ResourceState<A, E>,
  now: number,
): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  return gcFor > 0 && now - state.updatedAt > gcFor;
};

const deadline = (updatedAt: number | undefined, duration: number): number | undefined =>
  updatedAt === undefined || duration <= 0 ? undefined : updatedAt + duration;

const remaining = (deadlineAt: number | undefined, now: number): number | undefined =>
  deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - now);

export const resourceStatusFromState = <I, A, E, R, RefError = E>(
  ref: ResourceRef<I, A, RefError, R>,
  state: ResourceState<A, E>,
  now: number,
): ResourceStatus<I, A, E, R, RefError> => {
  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  const updatedAt = state._tag === "Success" ? state.updatedAt : undefined;
  const staleAt = deadline(updatedAt, staleFor);
  const gcAt = deadline(updatedAt, gcFor);
  const hasPrevious = (state._tag === "Pending" || state._tag === "Failure") && "previous" in state;
  const value = state._tag === "Success" ? state.value : hasPrevious ? state.previous : undefined;
  const base = {
    ref,
    name: ref.family.options.name,
    key: ref.key,
    input: ref.input,
    waiting: state.waiting,
    hasValue: state._tag === "Success" || hasPrevious,
    hasPrevious,
    isInitial: state._tag === "Initial",
    isPending: state._tag === "Pending",
    isSuccess: state._tag === "Success",
    isFailure: state._tag === "Failure",
    isFetching: state._tag === "Pending",
    isLoading: state._tag === "Pending" && !hasPrevious,
    isRefreshing: state._tag === "Pending" && hasPrevious,
    isStale: staleAt !== undefined && now > staleAt,
    isGcExpired: gcAt !== undefined && now > gcAt,
    updatedAt,
    staleAt,
    gcAt,
    ageMillis: updatedAt === undefined ? undefined : Math.max(0, now - updatedAt),
    staleInMillis: remaining(staleAt, now),
    gcInMillis: remaining(gcAt, now),
  };

  switch (state._tag) {
    case "Initial":
      return {
        ...base,
        _tag: "Initial",
        state,
        value: undefined,
        previous: undefined,
        error: undefined,
      };
    case "Pending":
      return {
        ...base,
        _tag: "Pending",
        state,
        value,
        previous: hasPrevious ? state.previous : undefined,
        error: undefined,
      };
    case "Success":
      return {
        ...base,
        _tag: "Success",
        state,
        value: state.value,
        previous: undefined,
        error: undefined,
      };
    case "Failure":
      return {
        ...base,
        _tag: "Failure",
        state,
        value,
        previous: hasPrevious ? state.previous : undefined,
        error: state.error,
      };
  }
};

export const inspectResourceStatus = <I, A, E, R, RefError = E>(
  ref: ResourceRef<I, A, RefError, R>,
  state: ResourceState<A, E>,
  now: number,
): ResourceStatus<I, A, E, R, RefError> => resourceStatusFromState(ref, state, now);

export const interruptResourceGc = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  store: ResourceStoreState,
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const fiber = entry.gcFiber;
    if (!fiber) {
      return Effect.succeed(false);
    }

    entry.gcFiber = undefined;
    store.fiberRegistry.untrack(resourceStoreFiber(fiber));
    return Fiber.interrupt(fiber).pipe(Effect.as(true));
  });

export const clearResourceInFlight = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  store: ResourceStoreState,
  token: object,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const inFlight = entry.inFlight;
    if (inFlight?.token !== token) {
      return;
    }

    entry.inFlight = undefined;
    store.fiberRegistry.untrack(resourceStoreFiber(inFlight.fiber));
  });

export const interruptResourceInFlight = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  store: ResourceStoreState,
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const inFlight = entry.inFlight;
    entry.inFlight = undefined;
    if (!inFlight) {
      return Effect.succeed(false);
    }

    store.fiberRegistry.untrack(resourceStoreFiber(inFlight.fiber));
    return Fiber.interrupt(inFlight.fiber).pipe(Effect.as(true));
  });

export const trackResourceFiber = <A, E>(
  store: ResourceStoreState,
  fiber: Fiber.Fiber<A, E>,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const trackedFiber = resourceStoreFiber(fiber);
    if (fiber.pollUnsafe() !== undefined) {
      return;
    }
    store.fiberRegistry.track(trackedFiber);
    const removeObserver = fiber.addObserver(() => {
      store.fiberRegistry.untrack(trackedFiber);
    });
    if (fiber.pollUnsafe() !== undefined) {
      removeObserver();
      store.fiberRegistry.untrack(trackedFiber);
    }
  });

export const forkTrackedDetachedResourceEffect = <A, E, R>(
  store: ResourceStoreState,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Fiber.Fiber<A, E>, never, R> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkDetach(effect, { startImmediately: true });
    yield* trackResourceFiber(store, fiber);
    return fiber;
  });

export const scheduleResourceGc = <I, A, E, R, RefError = E>(
  ref: ResourceRef<I, A, RefError, R>,
  entry: ResourceLifetimeEntry<A, E>,
  store: ResourceStoreState,
  deleteEntryEffect: (
    ref: ResourceRef<I, A, RefError, R>,
    store: ResourceStoreState,
  ) => Effect.Effect<void>,
  isRetained: () => boolean = () => false,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const interrupted = yield* interruptResourceGc(entry, store);
    if (interrupted) {
      yield* publishResourceStoreEvent(store, {
        _tag: "ResourceGcInterrupted",
        name: ref.family.options.name,
        key: ref.key,
      });
    }

    const gcFor = parseDuration(ref.family.options.policy?.gcFor);
    if (gcFor <= 0) {
      return;
    }
    if (isRetained()) {
      return;
    }

    const fiber = yield* Effect.forkDetach(
      Effect.gen(function* () {
        yield* Effect.sleep(gcFor);
        entry.gcFiber = undefined;
        store.fiberRegistry.untrack(resourceStoreFiber(fiber));
        if (isRetained()) {
          return;
        }
        yield* deleteEntryEffect(ref, store);
      }),
      { startImmediately: true },
    );
    entry.gcFiber = fiber;
    store.fiberRegistry.track(resourceStoreFiber(fiber));
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceGcScheduled",
      name: ref.family.options.name,
      key: ref.key,
      gcFor,
    });
  });

export const setResourcePending = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  const previous = previousResourceValue(entry.state.get());
  entry.state.set({
    _tag: "Pending",
    waiting: true,
    ...(previous.present ? { previous: previous.value } : {}),
  });
};

export const setResourceSuccess = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  value: A,
  updatedAt: number,
): void => {
  entry.state.set({
    _tag: "Success",
    waiting: false,
    value,
    updatedAt,
  });
};

export const setResourceFailure = <A, E>(entry: ResourceLifetimeEntry<A, E>, error: E): void => {
  const previous = previousResourceValue(entry.state.get());
  entry.state.set({
    _tag: "Failure",
    waiting: false,
    error,
    ...(previous.present ? { previous: previous.value } : {}),
  });
};

export const resetResourceEntry = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  entry.state.set({ _tag: "Initial", waiting: false });
};

export const shouldShowResourcePending = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: ResourceState<A, E>,
  force: boolean,
  now: number,
  retained = false,
): boolean =>
  force ||
  state._tag === "Initial" ||
  state._tag === "Failure" ||
  (!retained && isResourceStateCollected(ref, state, now));
