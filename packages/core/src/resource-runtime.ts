import { Cache, Clock, Duration, Effect, Exit, Fiber, Option, PubSub, Scope, Stream } from "effect";
import {
  planResourceInvalidationTargets,
  removeResourceRefFromTagIndex,
  recordResourceProvidedTags,
  resourceRefStoreKey,
  resourceProvidedTagsEffect,
  resourceRefsForTag,
} from "./resource-dependency-graph.js";
import {
  describeResourceStoreInvalidationCause,
  publishResourceStoreEvent,
} from "./resource-events.js";
import { ResourceCollector, type ResourceCollected } from "./resource-collector.js";
import { MissingResourceInput, ResourceFailure, ResourcePending } from "./resource-errors.js";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  toEffect,
  type EffectInput,
} from "./effect-like.js";
import { AsyncResult } from "effect/reactivity";
import { settleResult } from "./async-result-settle.js";
import { parseDuration } from "./resource-duration.js";
import { lookupResourceHydrationFamily } from "./resource-registry.js";
import {
  decodeResourceHydrationInputEffect,
  decodeResourceHydrationStateEffect,
  ResourceHydrationApplyError,
  resourceHydrationSnapshotFromRefEffect,
  type ResourceSnapshotCodecError,
  validateResourceHydrationPayloadEffect,
} from "./resource-snapshot-codec.js";
import {
  clearResourceInFlight,
  inspectResourceStatus,
  interruptResourceGc,
  interruptResourceInFlight,
  isResourceStateCollected,
  isResourceStateStale,
  makeResourceEntry,
  commitResourceState,
  resetResourceEntry,
  scheduleResourceGc,
  setResourcePending,
  shouldShowResourcePending,
  type ResourceLifetimeEntry as ResourceEntry,
} from "./resource-lifetime.js";
import {
  ResourceStore,
  unsafeMutableResourceStore,
  type MutableResourceStore as ResourceStoreState,
  type ResourceStoreEvent,
} from "./resource-store.js";
import { currentOrDefaultRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";
import type {
  AnyResourceFamily,
  AnyResourceRef,
  ResourceHydrationOptions,
  ResourceHydrationPayload,
  ResourceHydrationSnapshot,
  ResourceInvalidationPlan,
  ResourceInvalidationTarget,
  ResourceFamily,
  ResourceTag,
  ResourceRef,
  ResourceStatus,
} from "./resource.js";

export const currentResourceStore = (): ResourceStoreState =>
  unsafeMutableResourceStore(currentOrDefaultRuntime().resourceStore);

export const resourceStoreEffect: Effect.Effect<ResourceStoreState> = Effect.gen(function* () {
  const store = yield* Effect.serviceOption(ResourceStore);
  return Option.isSome(store) ? unsafeMutableResourceStore(store.value) : currentResourceStore();
});

export const lookupResourceFamilyEffect = (
  name: string,
): Effect.Effect<AnyResourceFamily | undefined> =>
  Effect.map(resourceStoreEffect, (store) => lookupResourceHydrationFamily(name, store));

const recordTouched = (ref: AnyResourceRef): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(ResourceCollector);
    if (Option.isSome(collector)) {
      collector.value.refs.set(ref.key, ref);
    }
  });

const registerResourceFamilyInStore = (
  family: AnyResourceFamily,
  store: ResourceStoreState,
): void => {
  store.families.set(family.options.name, family);
};

const resourceInputs = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  store: ResourceStoreState,
): Map<string, I> => {
  registerResourceFamilyInStore(family as AnyResourceFamily, store);
  const existing = store.inputs.get(family);
  if (existing) {
    return existing as Map<string, I>;
  }

  const inputs = new Map<string, I>();
  store.inputs.set(family, inputs as Map<string, unknown>);
  return inputs;
};

const resourceEntries = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  store: ResourceStoreState,
): Map<string, ResourceEntry<A, E>> => {
  registerResourceFamilyInStore(family as AnyResourceFamily, store);
  const existing = store.entries.get(family);
  if (existing) {
    return existing as Map<string, ResourceEntry<A, E>>;
  }

  const entries = new Map<string, ResourceEntry<A, E>>();
  store.entries.set(family, entries as Map<string, unknown>);
  return entries;
};

const loadCallbackDefect = (operation: string, cause: unknown, guidance: string) =>
  Effect.die(new EffectInputCallbackError({ operation, cause, guidance }));

/**
 * Runs a Resource's `load` callback. Breaking the callback contract (a
 * synchronous throw or a Promise-shaped return) is a defect, so the load fails
 * only with the Resource's declared error `E`.
 */
const resourceLoadEffect = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  input: I,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const operation = `Resource.load(${family.options.name})`;
    let output: ReturnType<typeof family.options.load>;
    try {
      output = family.options.load(input);
    } catch (cause) {
      return loadCallbackDefect(
        operation,
        cause,
        "Resource load callbacks must return values or Effects. A synchronous throw is a defect; fail the returned Effect for a typed failure.",
      );
    }
    // `Resource.define` checked the callback as an EffectInput; `toEffect`
    // still rejects a Promise-shaped value at run time.
    const effect = toEffect<A, E, R>(output as EffectInput<A, E, R>);
    const retry = family.options.policy?.retry;
    return Effect.catchDefect(
      retry === undefined ? effect : Effect.retry(effect, retry),
      (defect) =>
        defect instanceof EffectInputPromiseRejected
          ? loadCallbackDefect(
              operation,
              defect,
              "Resource load callbacks must return values or Effects. Wrap host Promise work in Effect.tryPromise(...) at the host adapter seam.",
            )
          : Effect.die(defect),
    );
  });

const resourceCache = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  store: ResourceStoreState,
): Cache.Cache<string, A, E, R> => {
  registerResourceFamilyInStore(family as AnyResourceFamily, store);
  const existing = store.caches.get(family);
  if (existing) {
    return existing as Cache.Cache<string, A, E, R>;
  }

  const inputs = resourceInputs(family, store);
  const cache = Effect.runSync(
    Cache.makeWith<string, A, E, R, "lookup">(
      (key) => {
        if (!inputs.has(key)) {
          return Effect.die(new MissingResourceInput({ key }));
        }

        const input = inputs.get(key) as I;
        return resourceLoadEffect(family, input);
      },
      {
        capacity: Number.POSITIVE_INFINITY,
        requireServicesAt: "lookup",
        timeToLive: (exit: Exit.Exit<A, E>) =>
          Exit.isFailure(exit)
            ? 0
            : family.options.policy?.gcFor === undefined
              ? Duration.infinity
              : parseDuration(family.options.policy.gcFor),
      },
    ),
  );
  store.caches.set(family, cache);
  return cache;
};

const rememberResourceRef = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): void => {
  resourceInputs(ref.family, store).set(ref.key, ref.input);
};

const resourceRetentionKey = (ref: AnyResourceRef): string => resourceRefStoreKey(ref);

const isResourceRefRetained = (ref: AnyResourceRef, store: ResourceStoreState): boolean =>
  (store.retainedRefs.get(resourceRetentionKey(ref)) ?? 0) > 0;

export const retainResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    rememberResourceRef(ref, store);
    const key = resourceRetentionKey(ref as AnyResourceRef);
    store.retainedRefs.set(key, (store.retainedRefs.get(key) ?? 0) + 1);
    const entry = peekResourceEntry(ref, store);
    if (entry !== undefined) {
      yield* interruptResourceGc(entry).pipe(Effect.asVoid);
    }
  });

export const releaseResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const key = resourceRetentionKey(ref as AnyResourceRef);
    const current = store.retainedRefs.get(key) ?? 0;
    if (current <= 1) {
      store.retainedRefs.delete(key);
    } else {
      store.retainedRefs.set(key, current - 1);
      return;
    }

    const entry = peekResourceEntry(ref, store);
    if (entry?.state.get()._tag === "Success") {
      yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect, () =>
        isResourceRefRetained(ref as AnyResourceRef, store),
      );
    }
  });

export const resourceEntry = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState = currentResourceStore(),
): ResourceEntry<A, E> => {
  rememberResourceRef(ref, store);
  const entries = resourceEntries(ref.family, store);
  const existing = entries.get(ref.key);
  if (existing) {
    return existing;
  }

  const entry = makeResourceEntry<A, E>(ref.family.options.name, ref.key) as ResourceEntry<A, E>;
  entries.set(ref.key, entry);
  return entry;
};

const peekResourceEntry = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): ResourceEntry<A, E> | undefined =>
  store.entries.get(ref.family)?.get(ref.key) as ResourceEntry<A, E> | undefined;

export const getCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): Effect.Effect<A, E, R> => {
  rememberResourceRef(ref, store);
  return Cache.get(resourceCache(ref.family, store), ref.key);
};

export const refreshCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): Effect.Effect<A, E, R> => {
  rememberResourceRef(ref, store);
  return Cache.refresh(resourceCache(ref.family, store), ref.key);
};

export const invalidateCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): Effect.Effect<void> => {
  rememberResourceRef(ref, store);
  return Cache.invalidate(resourceCache(ref.family, store), ref.key);
};

const resourceEntryOwnsState = <A, E>(entry: ResourceEntry<A, E> | undefined): boolean =>
  entry !== undefined &&
  (entry.inFlight !== undefined ||
    entry.gcFiber !== undefined ||
    entry.state.get()._tag !== "Initial");

export const subscribeResourceEventsEffect = (): Effect.Effect<
  PubSub.Subscription<ResourceStoreEvent>,
  never,
  Scope.Scope
> => Effect.flatMap(resourceStoreEffect, (store) => store.eventBus.subscribe);

const isSettledResourceEvent = (ref: AnyResourceRef, event: ResourceStoreEvent): boolean =>
  (event._tag === "ResourceSuccess" || event._tag === "ResourceHydrated") &&
  event.name === ref.family.options.name &&
  event.key === ref.key;

/**
 * Streams a ref's settled success values: the current value (when one is
 * cached), then every later success from a load, refresh, invalidation, or
 * hydration. The stream never starts a load, and it retains the ref against
 * garbage collection while it runs so tag invalidation keeps reaching it.
 */
export const resourceChangesStream = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Stream.Stream<A> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const store = yield* resourceStoreEffect;
      yield* Effect.acquireRelease(retainResourceRefEffect(ref), () =>
        releaseResourceRefEffect(ref),
      );
      const subscription = yield* store.eventBus.subscribe;
      const settled = Stream.fromSubscription(subscription).pipe(
        Stream.filter((event) => isSettledResourceEvent(ref as AnyResourceRef, event)),
      );
      return Stream.concat(Stream.succeed(undefined), settled).pipe(
        Stream.map(() => peekResourceEntry(ref, store)?.state.get()),
        Stream.filter((result): result is AsyncResult.Success<A, E> => result?._tag === "Success"),
        Stream.map((result) => result.value),
        Stream.changesWith((left, right) => left === right),
      );
    }),
  );

export const resourceResult = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): ReadableSignal<AsyncResult.AsyncResult<A, E>> =>
  resourceEntry(ref, currentResourceStore()).state;

export const resourceStatusEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<ResourceStatus<I, A, E, R, E>> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const now = yield* Clock.currentTimeMillis;
    return inspectResourceStatus(
      ref,
      peekResourceEntry(ref, store)?.state.get() ?? AsyncResult.initial(),
      now,
    );
  });

export const runResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  options: { readonly force: boolean },
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* recordTouched(ref as AnyResourceRef);
    const entry = resourceEntry(ref, store);
    const currentInFlight = entry.inFlight;
    if (currentInFlight) {
      if (!options.force || currentInFlight.force) {
        return yield* Fiber.join(currentInFlight.fiber);
      }
      yield* interruptResourceInFlight(entry);
    }

    const current = entry.state.get();
    const now = yield* Clock.currentTimeMillis;
    const retained = isResourceRefRetained(ref as AnyResourceRef, store);
    if (
      !options.force &&
      current._tag === "Success" &&
      !isResourceStateStale(ref as ResourceRef<unknown, A, E, unknown>, current, now) &&
      (retained ||
        !isResourceStateCollected(ref as ResourceRef<unknown, A, E, unknown>, current, now))
    ) {
      return current.value;
    }

    const token = {};
    // Every load settles from its Exit (success, typed failure, defect, or
    // interruption) inside an uninterruptible region, so no outcome can leave
    // the entry `waiting`. Only the load itself is interruptible.
    const loadEffect = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const current = entry.state.get();
        const pendingNow = yield* Clock.currentTimeMillis;
        const shouldShowPending = shouldShowResourcePending(
          ref as ResourceRef<unknown, A, E, unknown>,
          current,
          options.force,
          pendingNow,
          isResourceRefRetained(ref as AnyResourceRef, store),
        );

        if (shouldShowPending) {
          yield* interruptResourceGc(entry);
          setResourcePending(entry);
          yield* publishResourceStoreEvent(store, {
            _tag: "ResourcePending",
            name: ref.family.options.name,
            key: ref.key,
            force: options.force,
            previous: Option.isSome(AsyncResult.value(current)),
          });
        }

        const exit = yield* Effect.exit(
          restore(
            Effect.flatMap(
              options.force
                ? refreshCachedResourceEffect(ref, store)
                : getCachedResourceEffect(ref, store),
              (value) =>
                Effect.map(resourceProvidedTagsEffect(ref, value), (tags) => ({ value, tags })),
            ),
          ),
        );
        const now = yield* Clock.currentTimeMillis;
        const previous = entry.state.get();
        const settled = settleResult(
          Exit.map(exit, (loaded) => loaded.value),
          previous,
          now,
        );

        if (Exit.isSuccess(exit)) {
          recordResourceProvidedTags(ref, exit.value.tags, store);
          commitResourceState(entry, settled, "success");
          yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect, () =>
            isResourceRefRetained(ref as AnyResourceRef, store),
          );
          yield* publishResourceStoreEvent(store, {
            _tag: "ResourceSuccess",
            name: ref.family.options.name,
            key: ref.key,
            timestamp: now,
          });
          return exit.value.value;
        }

        yield* invalidateCachedResourceEffect(ref, store);
        commitResourceState(entry, settled, settled._tag === "Failure" ? "failure" : "interrupt");
        if (settled._tag === "Failure") {
          yield* interruptResourceGc(entry);
          yield* publishResourceStoreEvent(store, {
            _tag: "ResourceFailure",
            name: ref.family.options.name,
            key: ref.key,
            cause: exit.cause,
            previous: Option.isSome(settled.previousSuccess),
          });
        } else {
          // Cancelled: the prior settled result is back, so a restored success
          // regains the GC lifetime that showing pending interrupted.
          if (settled._tag === "Success") {
            yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect, () =>
              isResourceRefRetained(ref as AnyResourceRef, store),
            );
          }
          yield* publishResourceStoreEvent(store, {
            _tag: "ResourceInterrupted",
            name: ref.family.options.name,
            key: ref.key,
          });
        }
        return yield* Effect.failCause(exit.cause);
      }),
    ).pipe(Effect.ensuring(clearResourceInFlight(entry, token)));
    const fiber = yield* store.fiberRegistry.run(loadEffect);
    entry.inFlight = {
      token,
      force: options.force,
      fiber,
    };
    if (fiber.pollUnsafe() !== undefined) {
      yield* clearResourceInFlight(entry, token);
    }

    return yield* Fiber.join(fiber);
  });

export const refreshResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<A, E, R> => runResourceEffect(ref, { force: true });

export const prefetchResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<A, E, R> => runResourceEffect(ref, { force: false });

export const collectResourceEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<ResourceCollected<A>, E, R> =>
  Effect.gen(function* () {
    const collector: ResourceCollector = { refs: new Map() };
    const value = yield* Effect.provideService(effect, ResourceCollector, collector);
    return {
      value,
      refs: Array.from(collector.refs.values()),
    };
  });

const resourcePending = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  reason: "Initial" | "Pending" | "Collected",
  result: AsyncResult.AsyncResult<A, E>,
): ResourcePending<I, A, E, R> =>
  new ResourcePending({
    ref,
    reason,
    result,
    guidance:
      "The Resource value is not loaded yet. Run Resource.preload(...) before Resource.read(...), or read it with a UI adapter such as Solid's Component.resource(...) reader for Suspense.",
  });

type ResourceReadDecision<I, A, E, R> =
  | {
      readonly _tag: "Value";
      readonly value: A;
      readonly refresh: boolean;
    }
  | {
      readonly _tag: "Pending";
      readonly pending: ResourcePending<I, A, E, R>;
      readonly resetEntry?: ResourceEntry<A, E>;
    }
  | {
      readonly _tag: "Failure";
      readonly failure: ResourceFailure<I, A, E, R, E>;
    };

/**
 * Resource Read Decision derived from the entry's `AsyncResult`.
 *
 * - `Initial` reads are pending (`Initial`, or `Pending` while a first load is in flight).
 * - `Success` reads return the value; a settled stale value also requests a
 *   background refresh, and a value past `gcFor` resets to pending (`Collected`).
 * - `Failure` reads fail with `ResourceFailure`, except while a retry is in
 *   flight: stale data is returned when present, otherwise the read is pending.
 */
const resourceReadDecision = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  entry: ResourceEntry<A, E> | undefined,
  now: number,
  retained = false,
): ResourceReadDecision<I, A, E, R> => {
  const result = entry?.state.get() ?? AsyncResult.initial();
  switch (result._tag) {
    case "Initial":
      return {
        _tag: "Pending",
        pending: resourcePending(ref, result.waiting ? "Pending" : "Initial", result),
      };
    case "Failure":
      if (!result.waiting) {
        return { _tag: "Failure", failure: new ResourceFailure({ ref, result }) };
      }
      return Option.isSome(result.previousSuccess)
        ? { _tag: "Value", value: result.previousSuccess.value.value, refresh: false }
        : { _tag: "Pending", pending: resourcePending(ref, "Pending", result) };
    case "Success":
      if (result.waiting) {
        return { _tag: "Value", value: result.value, refresh: false };
      }
      if (
        entry !== undefined &&
        !retained &&
        isResourceStateCollected(ref as ResourceRef<unknown, A, E, unknown>, result, now)
      ) {
        return {
          _tag: "Pending",
          pending: resourcePending(ref, "Collected", result),
          resetEntry: entry,
        };
      }
      return {
        _tag: "Value",
        value: result.value,
        refresh: isResourceStateStale(ref as ResourceRef<unknown, A, E, unknown>, result, now),
      };
  }
};

export const readResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<A, ResourcePending<I, A, E, R> | ResourceFailure<I, A, E, R, E>, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* recordTouched(ref as AnyResourceRef);
    const entry = peekResourceEntry(ref, store);
    const now = yield* Clock.currentTimeMillis;
    const decision = resourceReadDecision(
      ref,
      entry,
      now,
      isResourceRefRetained(ref as AnyResourceRef, store),
    );
    switch (decision._tag) {
      case "Pending":
        if (decision.resetEntry !== undefined) {
          resetResourceEntry(decision.resetEntry);
        }
        return yield* Effect.fail(decision.pending);
      case "Failure":
        return yield* Effect.fail(decision.failure);
      case "Value":
        if (decision.refresh) {
          yield* store.fiberRegistry.run(
            refreshResourceEffect(ref).pipe(Effect.catchCause(() => Effect.void)),
          );
        }
        return decision.value;
    }
  });

export const refsForResourceTag = (tag: ResourceTag): ReadonlyArray<AnyResourceRef<any>> =>
  resourceRefsForTag(tag, currentResourceStore());

export const planResourceInvalidationEffect = <R = never>(
  target: ResourceInvalidationTarget<R>,
): Effect.Effect<ResourceInvalidationPlan<R>> =>
  Effect.map(
    resourceStoreEffect,
    (store) => planResourceInvalidationTargets(target, store) as ResourceInvalidationPlan<R>,
  );

export const invalidateResourceEffect = <R = never>(
  target: ResourceInvalidationTarget<R>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* runResourceInvalidationPlanEffect(planResourceInvalidationTargets(target, store));
  });

export const runResourceInvalidationPlanEffect = <R = never>(
  plan: ResourceInvalidationPlan<R>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    for (const entry of plan.entries) {
      yield* publishResourceStoreEvent(store, {
        _tag: "ResourceInvalidated",
        name: entry.ref.family.options.name,
        key: entry.ref.key,
        causes: entry.causes.map(describeResourceStoreInvalidationCause),
      });
      yield* refreshResourceEffect(entry.ref).pipe(Effect.catchCause(() => Effect.void));
    }
  });

export const dehydrateResourcesEffect = (
  refs: Iterable<AnyResourceRef<any>>,
): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>, ResourceSnapshotCodecError> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const snapshot: Array<ResourceHydrationSnapshot> = [];

    let index = 0;
    for (const ref of refs) {
      const pathIndex = index++;
      const entry = peekResourceEntry(ref, store);
      if (entry === undefined) {
        continue;
      }
      const state = entry.state.get();
      if (state._tag === "Success") {
        snapshot.push(yield* resourceHydrationSnapshotFromRefEffect(ref, state, `$[${pathIndex}]`));
      }
    }

    return snapshot;
  });

export const resourceHydrationPayloadEffect = (
  refs: Iterable<AnyResourceRef<any>>,
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.flatMap(dehydrateResourcesEffect(refs), (resources) =>
    validateResourceHydrationPayloadEffect({ resources }, "snapshot"),
  );

interface ResourceHydrationPlanEntry {
  readonly ref: ResourceRef<any, any, any, any>;
  readonly state: AsyncResult.Success<any, any>;
  readonly tags: readonly ResourceTag[];
}

const applyHydratedResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: AsyncResult.Success<A, E>,
  tags: readonly ResourceTag[],
  store: ResourceStoreState,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    rememberResourceRef(ref, store);
    const entry = resourceEntry(ref, store);
    yield* interruptResourceInFlight(entry);
    yield* interruptResourceGc(entry);
    recordResourceProvidedTags(ref, tags, store);
    commitResourceState(entry, state, "hydrate");
    yield* Cache.set(resourceCache(ref.family, store), ref.key, state.value);
    yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect, () =>
      isResourceRefRetained(ref as AnyResourceRef, store),
    );
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceHydrated",
      name: ref.family.options.name,
      key: ref.key,
      timestamp: state.timestamp,
    });
  });

export const hydrateResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: AsyncResult.Success<A, E>,
  store: ResourceStoreState,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const tags = yield* resourceProvidedTagsEffect(ref, state.value);
    yield* applyHydratedResourceRefEffect(ref, state, tags, store);
  });

export const deleteResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* deleteResourceFromStoreEffect(ref, store);
  });

export const deleteResourceFromStoreEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const entries = store.entries.get(ref.family) as Map<string, ResourceEntry<A, E>> | undefined;
    const inputs = store.inputs.get(ref.family) as Map<string, I> | undefined;
    const cache = store.caches.get(ref.family) as Cache.Cache<string, A, E, R> | undefined;
    const hadInput = inputs?.has(ref.key) === true;
    const entry = entries?.get(ref.key);
    const hadEntry = resourceEntryOwnsState(entry);
    const hadTags = store.refTags.has(resourceRefStoreKey(ref as AnyResourceRef));
    if (!hadEntry && !hadInput && !hadTags) {
      return;
    }

    if (entry) {
      // In-flight first: an interrupted load settles (and may reschedule GC)
      // before the GC fiber is interrupted and the entry is reset.
      yield* interruptResourceInFlight(entry);
      yield* interruptResourceGc(entry);
      resetResourceEntry(entry);
    }

    removeResourceRefFromTagIndex(ref, store);
    if (cache !== undefined) {
      yield* Cache.invalidate(cache, ref.key);
    }
    inputs?.delete(ref.key);
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceDeleted",
      name: ref.family.options.name,
      key: ref.key,
    });
  });

export const hydrateResourcesEffect = (
  input: ResourceHydrationPayload,
  options: ResourceHydrationOptions = {},
): Effect.Effect<void, ResourceSnapshotCodecError | ResourceHydrationApplyError> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const { resources: snapshots } = yield* validateResourceHydrationPayloadEffect(
      input,
      "hydrate",
    );
    const now =
      options.timestamp === "now" || options.skipFresh === true
        ? yield* Clock.currentTimeMillis
        : undefined;
    const timestamp = options.timestamp === "now" ? now : undefined;
    const plan: ResourceHydrationPlanEntry[] = [];
    let index = 0;
    for (const snapshot of snapshots) {
      const path = `$.resources[${index}]`;
      index++;
      const family = lookupResourceHydrationFamily(snapshot.name, store);
      if (!family) {
        if (options.missingFamily === "skip") {
          continue;
        }
        return yield* Effect.fail(
          new ResourceHydrationApplyError({
            reason: "MissingFamily",
            path,
            name: snapshot.name,
            key: snapshot.key,
            guidance:
              'Register the Resource family before hydration, or pass { missingFamily: "skip" } to opt into dropping that snapshot.',
          }),
        );
      }

      const input = yield* decodeResourceHydrationInputEffect(
        family,
        snapshot,
        "hydrate",
        `${path}.input`,
      );
      const ref = family.ref(input);
      if (ref.key !== snapshot.key) {
        if (options.keyMismatch === "skip") {
          continue;
        }
        return yield* Effect.fail(
          new ResourceHydrationApplyError({
            reason: "KeyMismatch",
            path,
            name: snapshot.name,
            key: snapshot.key,
            expectedKey: ref.key,
            guidance:
              'Hydration snapshot keys must match the registered Resource family\'s key function for the decoded input, or pass { keyMismatch: "skip" } to opt into dropping that snapshot.',
          }),
        );
      }

      const state = yield* decodeResourceHydrationStateEffect(
        family,
        snapshot,
        "hydrate",
        `${path}.state.value`,
      );
      if (options.skipFresh === true && now !== undefined) {
        const current = peekResourceEntry(ref, store)?.state.get() ?? AsyncResult.initial();
        const status = inspectResourceStatus(ref, current, now);
        if (current._tag === "Success" && !status.isStale && !status.isGcExpired) {
          continue;
        }
      }
      const successState =
        timestamp === undefined ? state : AsyncResult.success(state.value, { timestamp });
      const tags = yield* resourceProvidedTagsEffect(ref, successState.value);
      plan.push({ ref, state: successState, tags });
    }

    yield* Effect.forEach(
      plan,
      (entry) => applyHydratedResourceRefEffect(entry.ref, entry.state, entry.tags, store),
      { discard: true },
    );
  });
