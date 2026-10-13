import { Effect, Fiber } from "effect";
import { AsyncResult } from "effect/reactivity";
import { parseDuration } from "./resource-duration.js";
import { publishResourceStoreEvent } from "./resource-events.js";
import type { ResourceRef, ResourceStatus } from "./resource.js";
import type { ResourceFeedStatus } from "./resource-rows.js";
import type { MutableResourceStore as ResourceStoreState } from "./resource-store.js";
import { SignalWrites, type WritableSignal } from "./signal.js";
import type { TimelineResourceCause } from "./timeline.js";
import { batchSignalWrites } from "./signal-transaction.js";
import {
  shareResourceResult,
  shareResourceValue,
  type ResourceValueSharing,
} from "./resource-value-sharing.js";

export interface ResourceInFlight<A, E> {
  readonly token: object;
  readonly force: boolean;
  fiber: Fiber.Fiber<A, E>;
}

/** One Action submission's optimistic patch to a Resource entry's value. */
export interface ResourceOptimisticPatch {
  readonly transaction: symbol;
  readonly apply: (value: any) => any;
}

/**
 * Optimistic layers over an entry: `synced` is the result the store loaded or
 * hydrated, and the entry's `state` shows it with `patches` applied in order.
 */
export interface ResourceOptimisticLayers<A, E> {
  readonly synced: AsyncResult.AsyncResult<A, E>;
  readonly patches: ReadonlyArray<ResourceOptimisticPatch>;
}

export interface ResourceLifetimeEntry<A, E> {
  readonly resource: string;
  readonly key: string;
  /** The visible result: the synced result with any optimistic patches applied. */
  readonly state: WritableSignal<AsyncResult.AsyncResult<A, E>>;
  /** Present while in-flight Action submissions patch this entry. */
  optimistic: ResourceOptimisticLayers<A, E> | undefined;
  inFlight: ResourceInFlight<A, E> | undefined;
  gcFiber: Fiber.Fiber<void, never> | undefined;
  /** The running `rows.changes` feed, started by the entry's first success. */
  changesFiber: Fiber.Fiber<void, never> | undefined;
  /** Where the `rows.changes` feed is; written only by the feed and the entry's reset. */
  readonly feed: WritableSignal<ResourceFeedStatus>;
  /** True once a persisted value was looked up for this entry (`policy.persist`). */
  persistRestored: boolean;
  /** The family's structural sharing: how a new value reuses the one it replaces. */
  readonly share: ResourceValueSharing;
}

const idleResourceFeed: ResourceFeedStatus = { _tag: "Idle" };

export const makeResourceEntry = <A, E>(
  resource: string,
  key: string,
  share: ResourceValueSharing = shareResourceValue,
): ResourceLifetimeEntry<A, E> => ({
  resource,
  key,
  state: SignalWrites.make<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial(), {
    name: `${resource}(${key})`,
  }),
  optimistic: undefined,
  inFlight: undefined,
  gcFiber: undefined,
  changesFiber: undefined,
  feed: SignalWrites.make<ResourceFeedStatus>(idleResourceFeed, {
    name: `${resource}(${key}).feed`,
  }),
  persistRestored: false,
  share,
});

/**
 * The entry's synced result: what loads, hydration, and snapshots see, without
 * any optimistic patch.
 */
export const syncedResourceState = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
): AsyncResult.AsyncResult<A, E> => entry.optimistic?.synced ?? entry.state.get();

/**
 * Applies optimistic patches, in order, to a synced result's value (and to a
 * failure's previous success); an `Initial` result has no value to patch.
 * Throws when a patch throws.
 */
export const applyResourceOptimisticPatches = <A, E>(
  synced: AsyncResult.AsyncResult<A, E>,
  patches: ReadonlyArray<ResourceOptimisticPatch>,
): AsyncResult.AsyncResult<A, E> =>
  patches.length === 0
    ? synced
    : AsyncResult.map(synced, (value) =>
        patches.reduce((current, patch) => patch.apply(current) as A, value),
      );

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
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const fiber = entry.gcFiber;
    if (!fiber) {
      return Effect.succeed(false);
    }

    entry.gcFiber = undefined;
    return Fiber.interrupt(fiber).pipe(Effect.as(true));
  });

export const clearResourceInFlight = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  token: object,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (entry.inFlight?.token === token) {
      entry.inFlight = undefined;
    }
  });

export const interruptResourceInFlight = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const inFlight = entry.inFlight;
    entry.inFlight = undefined;
    if (!inFlight) {
      return Effect.succeed(false);
    }

    return Fiber.interrupt(inFlight.fiber).pipe(Effect.as(true));
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
    const interrupted = yield* interruptResourceGc(entry);
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

    entry.gcFiber = yield* store.fiberRegistry.run(
      Effect.gen(function* () {
        yield* sleepResourceGcEffect(gcFor);
        entry.gcFiber = undefined;
        if (isRetained()) {
          return;
        }
        yield* deleteEntryEffect(ref, store);
      }),
    );
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceGcScheduled",
      name: ref.family.options.name,
      key: ref.key,
      gcFor,
    });
  });

/**
 * The one write to an entry's visible state and optimistic layers. The new
 * visible result shares structure with the one readers hold: a value equal to
 * the shown one is the shown object, and only changed subtrees are new.
 */
export const showResourceState = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  layers: ResourceOptimisticLayers<A, E> | undefined,
  visible: AsyncResult.AsyncResult<A, E>,
): void => {
  entry.optimistic = layers;
  entry.state.set(shareResourceResult(entry.share, entry.state.get(), visible));
};

/**
 * The one write path for an entry's synced state, labelled for `Timeline`
 * entries. The new result shares structure with the synced result it
 * replaces, and optimistic patches stay on top: the entry shows the new
 * synced result with them applied. Returns the synced result as committed.
 */
export const commitResourceState = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  state: AsyncResult.AsyncResult<A, E>,
  event: TimelineResourceCause["event"],
): AsyncResult.AsyncResult<A, E> => {
  const layers = entry.optimistic;
  const synced = shareResourceResult(entry.share, syncedResourceState(entry), state);
  batchSignalWrites(
    () =>
      layers === undefined
        ? // The synced result is the shown one, so it is already shared.
          entry.state.set(synced)
        : showResourceState(
            entry,
            { synced, patches: layers.patches },
            applyResourceOptimisticPatches(synced, layers.patches),
          ),
    { _tag: "Resource", resource: entry.resource, key: entry.key, event },
  );
  return synced;
};

/** Marks the current result `waiting`, keeping its tag (stale-while-refreshing). */
export const setResourcePending = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  commitResourceState(entry, AsyncResult.waiting(syncedResourceState(entry)), "load");
};

/** Resets the entry to `Initial`, and its feed status to `Idle`, as one `reset` commit. */
export const resetResourceEntry = <A, E>(entry: ResourceLifetimeEntry<A, E>): void => {
  batchSignalWrites(
    () => {
      commitResourceState(entry, AsyncResult.initial(), "reset");
      entry.feed.set(idleResourceFeed);
    },
    { _tag: "Resource", resource: entry.resource, key: entry.key, event: "reset" },
  );
};

/** A running feed's status write, as a `feedFollowing`/`feedRetrying`/`feedStopped` commit. */
export const setResourceFeedStatus = <A, E>(
  entry: ResourceLifetimeEntry<A, E>,
  status: Exclude<ResourceFeedStatus, { readonly _tag: "Idle" }>,
): void => {
  batchSignalWrites(() => entry.feed.set(status), {
    _tag: "Resource",
    resource: entry.resource,
    key: entry.key,
    event: `feed${status._tag}`,
  });
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
