import { Effect, Fiber } from "effect";
import { AsyncResult } from "effect/reactivity";
import { parseDuration } from "./resource-duration.js";
import { publishResourceStoreEvent } from "./resource-events.js";
import type { ResourceRef, ResourceStatus } from "./resource.js";
import {
  resourceStoreFiber,
  type MutableResourceStore as ResourceStoreState,
} from "./resource-store.js";
import { Signal, type WritableSignal } from "./signal.js";
import type { TimelineResourceCause } from "./timeline.js";

export interface ResourceInFlight<A, E> {
  readonly token: object;
  readonly force: boolean;
  fiber: Fiber.Fiber<A, E>;
}

export interface ResourceLifetimeEntry<A, E> {
  readonly resource: string;
  readonly key: string;
  readonly state: WritableSignal<AsyncResult.AsyncResult<A, E>>;
  inFlight: ResourceInFlight<A, E> | undefined;
  gcFiber: Fiber.Fiber<void, never> | undefined;
}

export const makeResourceEntry = <A, E>(
  resource: string,
  key: string,
): ResourceLifetimeEntry<A, E> => ({
  resource,
  key,
  state: Signal.make<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial(), {
    name: `${resource}(${key})`,
  }),
  inFlight: undefined,
  gcFiber: undefined,
});

export const isResourceStateStale = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: AsyncResult.AsyncResult<A, E>,
  now: number,
): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  return staleFor > 0 && now - state.timestamp > staleFor;
};

export const isResourceStateCollected = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: AsyncResult.AsyncResult<A, E>,
  now: number,
): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  return gcFor > 0 && now - state.timestamp > gcFor;
};

const deadline = (timestamp: number | undefined, duration: number): number | undefined =>
  timestamp === undefined || duration <= 0 ? undefined : timestamp + duration;

const maxTimerMillis = 2 ** 31 - 1;

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  if (typeof timer !== "object" || timer === null) {
    return;
  }
  const unref = (timer as { readonly unref?: () => void }).unref;
  if (typeof unref === "function") {
    unref.call(timer);
  }
};

const sleepResourceGcEffect = (milliseconds: number): Effect.Effect<void> =>
  milliseconds <= 0
    ? Effect.void
    : Effect.callback<void, never>((resume) => {
        const delay = Math.min(milliseconds, maxTimerMillis);
        const timer = setTimeout(() => resume(Effect.void), delay);
        unrefTimer(timer);
        return Effect.sync(() => clearTimeout(timer));
      }).pipe(
        Effect.andThen(() =>
          milliseconds > maxTimerMillis
            ? sleepResourceGcEffect(milliseconds - maxTimerMillis)
            : Effect.void,
        ),
      );

const remaining = (deadlineAt: number | undefined, now: number): number | undefined =>
  deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - now);

export const inspectResourceStatus = <I, A, E, R, RefError = E>(
  ref: ResourceRef<I, A, RefError, R>,
  result: AsyncResult.AsyncResult<A, E>,
  now: number,
): ResourceStatus<I, A, E, R, RefError> => {
  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  const timestamp = result._tag === "Success" ? result.timestamp : undefined;
  const staleAt = deadline(timestamp, staleFor);
  const gcAt = deadline(timestamp, gcFor);
  return {
    ref,
    name: ref.family.options.name,
    key: ref.key,
    input: ref.input,
    result,
    isStale: staleAt !== undefined && now > staleAt,
    isGcExpired: gcAt !== undefined && now > gcAt,
    staleAt,
    gcAt,
    ageMillis: timestamp === undefined ? undefined : Math.max(0, now - timestamp),
    staleInMillis: remaining(staleAt, now),
    gcInMillis: remaining(gcAt, now),
  };
};

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
        yield* sleepResourceGcEffect(gcFor);
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

/** The one write path for an entry's state, labelled for `Timeline` entries. */
export const commitResourceState = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  state: AsyncResult.AsyncResult<A, E>,
  event: TimelineResourceCause["event"],
): void => {
  Signal.batch(() => entry.state.set(state), {
    cause: { _tag: "Resource", resource: entry.resource, key: entry.key, event },
  });
};

/** Marks the current result `waiting`, keeping its tag (stale-while-refreshing). */
export const setResourcePending = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  commitResourceState(entry, AsyncResult.waiting(entry.state.get()), "load");
};

export const resetResourceEntry = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  commitResourceState(entry, AsyncResult.initial(), "reset");
};

export const shouldShowResourcePending = <A, E, RefError>(
  ref: ResourceRef<unknown, A, RefError, unknown>,
  state: AsyncResult.AsyncResult<A, E>,
  force: boolean,
  now: number,
  retained = false,
): boolean =>
  force ||
  state._tag === "Initial" ||
  state._tag === "Failure" ||
  (!retained && isResourceStateCollected(ref, state, now));
