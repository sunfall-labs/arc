import { Cache, Clock, Context, Duration, Effect, Exit, Fiber, Option, PubSub, Scope, type Schedule } from "effect";
import {
  planResourceInvalidationTargets,
  removeResourceRefFromTagIndex,
  recordResourceProvidedTags,
  resourceProvidedTagsEffect,
  resourceRefsForTag
} from "./resource-dependency-graph.js";
import { describeResourceStoreInvalidationCause, publishResourceStoreEvent } from "./resource-events.js";
import { ResourceCollector, type ResourceCollected } from "./resource-collector.js";
import { MissingResourceInput, ResourceFailure, ResourcePending } from "./resource-errors.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";
import { parseDuration } from "./resource-duration.js";
import { lookupResourceHydrationFamily } from "./resource-registry.js";
import {
  decodeResourceHydrationInputEffect,
  decodeResourceHydrationStateEffect,
  ResourceHydrationApplyError,
  resourceHydrationSnapshotFromRef,
  resourceHydrationSnapshotFromRefEffect,
  type ResourceSnapshotCodecError,
  validateResourceHydrationInputEffect
} from "./resource-snapshot-codec.js";
import {
  clearResourceInFlight,
  inspectResourceStatus,
  interruptResourceGc,
  interruptResourceInFlight,
  isResourceStateCollected,
  isResourceStateStale,
  makeResourceEntry,
  previousResourceValue,
  resetResourceEntry,
  scheduleResourceGc,
  setResourceFailure,
  setResourcePending,
  setResourceSuccess,
  shouldShowResourcePending,
  type ResourceLifetimeEntry as ResourceEntry
} from "./resource-lifetime.js";
import {
  ResourceStore,
  resourceStoreFiber,
  unsafeMutableResourceStore,
  type MutableResourceStore as ResourceStoreState,
  type ResourceStoreEvent
} from "./resource-store.js";
import { currentOrDefaultRuntime, runFork, type AnyEffectUiRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";
import type {
  AnyResourceFamily,
  AnyResourceRef,
  ResourceHydrationInput,
  ResourceHydrationOptions,
  ResourceHydrationPayload,
  ResourceHydrationSnapshot,
  ResourceInvalidationPlan,
  ResourceInvalidationTarget,
  ResourceFamily,
  ResourceLoadError,
  ResourceTag,
  ResourceRef,
  ResourceState,
  ResourceStatus
} from "./resource.js";

export const currentResourceStore = (): ResourceStoreState =>
  unsafeMutableResourceStore(currentOrDefaultRuntime().resourceStore);

export const resourceStoreEffect: Effect.Effect<ResourceStoreState> =
  Effect.gen(function* () {
    const store = yield* Effect.serviceOption(ResourceStore);
    return Option.isSome(store) ? unsafeMutableResourceStore(store.value) : currentResourceStore();
  });

export const lookupResourceFamilyEffect = (
  name: string
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
  store: ResourceStoreState
): void => {
  store.families.set(family.options.name, family);
};

const resourceInputs = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  store: ResourceStoreState
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
  store: ResourceStoreState
): Map<string, ResourceEntry<A, ResourceLoadError<E>>> => {
  registerResourceFamilyInStore(family as AnyResourceFamily, store);
  const existing = store.entries.get(family);
  if (existing) {
    return existing as Map<string, ResourceEntry<A, ResourceLoadError<E>>>;
  }

  const entries = new Map<string, ResourceEntry<A, ResourceLoadError<E>>>();
  store.entries.set(family, entries as Map<string, unknown>);
  return entries;
};

const resourceCache = <I, A, E, R>(
  family: ResourceFamily<I, A, E, R>,
  store: ResourceStoreState
): Cache.Cache<string, A, ResourceLoadError<E>, R> => {
  registerResourceFamilyInStore(family as AnyResourceFamily, store);
  const existing = store.caches.get(family);
  if (existing) {
    return existing as Cache.Cache<string, A, ResourceLoadError<E>, R>;
  }

  const inputs = resourceInputs(family, store);
  const cache = Effect.runSync(
    Cache.makeWith<string, A, ResourceLoadError<E>, R, "lookup">(
      (key) => {
        if (!inputs.has(key)) {
          return Effect.die(new MissingResourceInput({ key }));
        }

        const input = inputs.get(key) as I;
        const load = invokeEffectInput(
          `Resource.load(${family.options.name})`,
          family.options.load,
          input
        );
        const retry = family.options.policy?.retry;
        return retry ? Effect.retry(load, retry as Schedule.Schedule<unknown, ResourceLoadError<E>>) : load;
      },
      {
        capacity: Number.POSITIVE_INFINITY,
        requireServicesAt: "lookup",
        timeToLive: (exit: Exit.Exit<A, ResourceLoadError<E>>) =>
          Exit.isFailure(exit)
            ? 0
            : family.options.policy?.gcFor === undefined
              ? Duration.infinity
              : parseDuration(family.options.policy.gcFor)
      }
    )
  );
  store.caches.set(family, cache);
  return cache;
};

const rememberResourceRef = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): void => {
  resourceInputs(ref.family, store).set(ref.key, ref.input);
};

export const resourceEntry = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState = currentResourceStore()
): ResourceEntry<A, ResourceLoadError<E>> => {
  rememberResourceRef(ref, store);
  const entries = resourceEntries(ref.family, store);
  const existing = entries.get(ref.key);
  if (existing) {
    return existing;
  }

  const entry = makeResourceEntry<A, ResourceLoadError<E>>() as ResourceEntry<A, ResourceLoadError<E>>;
  entries.set(ref.key, entry);
  return entry;
};

const peekResourceEntry = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): ResourceEntry<A, ResourceLoadError<E>> | undefined =>
  store.entries.get(ref.family)?.get(ref.key) as ResourceEntry<A, ResourceLoadError<E>> | undefined;

const runtimeCurrentTimeMillis = (runtime: AnyEffectUiRuntime<any>): number => {
  const context = runtime.managed.cachedContext;
  if (context !== undefined) {
    return Context.getReferenceUnsafe(context, Clock.Clock).currentTimeMillisUnsafe();
  }

  return runtime.runSync(Clock.currentTimeMillis);
};

export const getCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): Effect.Effect<A, ResourceLoadError<E>, R> => {
  rememberResourceRef(ref, store);
  return Cache.get(resourceCache(ref.family, store), ref.key);
};

export const refreshCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): Effect.Effect<A, ResourceLoadError<E>, R> => {
  rememberResourceRef(ref, store);
  return Cache.refresh(resourceCache(ref.family, store), ref.key);
};

export const invalidateCachedResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): Effect.Effect<void> => {
  rememberResourceRef(ref, store);
  return Cache.invalidate(resourceCache(ref.family, store), ref.key);
};

const invalidateResourceCacheEntryEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): Effect.Effect<void> =>
  Cache.invalidate(resourceCache(ref.family, store), ref.key);

export const subscribeResourceEventsEffect = (): Effect.Effect<PubSub.Subscription<ResourceStoreEvent>, never, Scope.Scope> =>
  Effect.flatMap(resourceStoreEffect, (store) => store.eventBus.subscribeEffect);

export const resourceResult = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): ReadableSignal<ResourceState<A, ResourceLoadError<E>>> =>
  resourceEntry(ref, currentResourceStore()).state;

export const resourceStatus = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): ResourceStatus<I, A, ResourceLoadError<E>, R, E> => {
  const runtime = currentOrDefaultRuntime();
  const store = unsafeMutableResourceStore(runtime.resourceStore);
  return inspectResourceStatus(
    ref,
    peekResourceEntry(ref, store)?.state.get() ?? { _tag: "Initial", waiting: false },
    runtimeCurrentTimeMillis(runtime)
  );
};

export const resourceStatusEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<ResourceStatus<I, A, ResourceLoadError<E>, R, E>> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const now = yield* Clock.currentTimeMillis;
    return inspectResourceStatus(
      ref,
      peekResourceEntry(ref, store)?.state.get() ?? { _tag: "Initial", waiting: false },
      now
    );
  });

export const runResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  options: { readonly force: boolean }
): Effect.Effect<A, ResourceLoadError<E>, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* recordTouched(ref as AnyResourceRef);
    const entry = resourceEntry(ref, store);
    const currentInFlight = entry.inFlight;
    if (currentInFlight) {
      if (!options.force || currentInFlight.force) {
        return yield* Fiber.join(currentInFlight.fiber);
      }
      yield* interruptResourceInFlight(entry, store);
    }

    const token = {};
    const loadEffect = Effect.gen(function* () {
      const current = entry.state.get();
      const pendingNow = yield* Clock.currentTimeMillis;
      const shouldShowPending = shouldShowResourcePending(
        ref as ResourceRef<unknown, A, E, unknown>,
        current,
        options.force,
        pendingNow
      );

      if (shouldShowPending) {
        yield* interruptResourceGc(entry, store);
        setResourcePending(entry);
        yield* publishResourceStoreEvent(store, {
          _tag: "ResourcePending",
          name: ref.family.options.name,
          key: ref.key,
          force: options.force,
          previous: previousResourceValue(current) !== undefined
        });
      }

      const value = yield* (
        options.force
          ? refreshCachedResourceEffect(ref, store)
          : getCachedResourceEffect(ref, store)
      );
      const tags = yield* resourceProvidedTagsEffect(ref, value);
      const updatedAt = yield* Clock.currentTimeMillis;
      recordResourceProvidedTags(ref, tags, store);
      setResourceSuccess(entry, value, updatedAt);

      yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect);
      yield* publishResourceStoreEvent(store, {
        _tag: "ResourceSuccess",
        name: ref.family.options.name,
        key: ref.key,
        updatedAt
      });

      return value;
    }).pipe(
      Effect.catch((error: ResourceLoadError<E>) =>
        Effect.gen(function* () {
          yield* interruptResourceGc(entry, store);
          const previous = previousResourceValue(entry.state.get());
          setResourceFailure(entry, error);
          yield* invalidateCachedResourceEffect(ref, store);
          yield* publishResourceStoreEvent(store, {
            _tag: "ResourceFailure",
            name: ref.family.options.name,
            key: ref.key,
            error,
            previous: previous !== undefined
          });
          return yield* Effect.fail(error);
        })
      ),
      Effect.ensuring(clearResourceInFlight(entry, store, token))
    );
    const fiber = yield* Effect.forkDetach(loadEffect, { startImmediately: true });
    entry.inFlight = {
      token,
      force: options.force,
      fiber
    };
    store.fiberRegistry.track(resourceStoreFiber(fiber));
    if (fiber.pollUnsafe() !== undefined) {
      yield* clearResourceInFlight(entry, store, token);
    }

    return yield* Fiber.join(fiber);
  });

export const refreshResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<A, ResourceLoadError<E>, R> =>
  runResourceEffect(ref, { force: true });

export const prefetchResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<A, ResourceLoadError<E>, R> =>
  runResourceEffect(ref, { force: false });

export const collectResourceEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<ResourceCollected<A>, E, R> =>
  Effect.gen(function* () {
    const collector: ResourceCollector = { refs: new Map() };
    const value = yield* Effect.provideService(effect, ResourceCollector, collector);
    return {
      value,
      refs: Array.from(collector.refs.values())
    };
  });

const resourcePending = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: "Initial" | "Pending" | "Collected",
  previous: A | undefined
): ResourcePending<I, A, E, R> =>
  new ResourcePending({
    ref,
    state,
    previous,
    guidance: "Resource.read(...) is a synchronous render/host-adapter seam. Run Resource.prefetchEffect(...) before reading, use Resource.readEffect(...) inside Effect code, or use a UI adapter such as Solid useResourceSuspense(...) for Suspense."
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
      readonly resetEntry?: ResourceEntry<A, ResourceLoadError<E>>;
    }
  | {
      readonly _tag: "Failure";
      readonly failure: ResourceFailure<unknown, A, ResourceLoadError<E>, unknown, E>;
    };

const resourceReadDecision = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  entry: ResourceEntry<A, ResourceLoadError<E>> | undefined,
  now: number
): ResourceReadDecision<I, A, E, R> => {
  if (entry === undefined) {
    return { _tag: "Pending", pending: resourcePending(ref, "Initial", undefined) };
  }

  const state = entry.state.get();
  if (state._tag === "Initial") {
    return { _tag: "Pending", pending: resourcePending(ref, "Initial", undefined) };
  }

  if (state._tag === "Pending") {
    return "previous" in state
      ? { _tag: "Value", value: state.previous as A, refresh: false }
      : { _tag: "Pending", pending: resourcePending(ref, "Pending", undefined) };
  }

  if (state._tag === "Failure") {
    return {
      _tag: "Failure",
      failure: new ResourceFailure({
        ref: ref as ResourceRef<unknown, A, E, unknown>,
        error: state.error,
        previous: state.previous
      })
    };
  }

  if (isResourceStateCollected(ref as ResourceRef<unknown, A, E, unknown>, state, now)) {
    return {
      _tag: "Pending",
      pending: resourcePending(ref, "Collected", state.value),
      resetEntry: entry
    };
  }

  return {
    _tag: "Value",
    value: state.value,
    refresh: isResourceStateStale(ref as ResourceRef<unknown, A, E, unknown>, state, now)
  };
};

export const readResource = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): A => {
  const runtime = currentOrDefaultRuntime();
  const entry = peekResourceEntry(ref, unsafeMutableResourceStore(runtime.resourceStore));
  const now = runtimeCurrentTimeMillis(runtime);
  const decision = resourceReadDecision(ref, entry, now);
  switch (decision._tag) {
    case "Pending":
      if (decision.resetEntry !== undefined) {
        resetResourceEntry(decision.resetEntry);
      }
      throw decision.pending;
    case "Failure":
      throw decision.failure;
    case "Value":
      if (decision.refresh) {
        void runFork(
          refreshResourceEffect(ref).pipe(
            Effect.catch(() => Effect.void)
          )
        );
      }
      return decision.value;
  }
};

export const readResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<
  A,
  ResourcePending<I, A, E, R> | ResourceFailure<unknown, A, ResourceLoadError<E>, unknown, E>,
  R
> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* recordTouched(ref as AnyResourceRef);
    const entry = peekResourceEntry(ref, store);
    const now = yield* Clock.currentTimeMillis;
    const decision = resourceReadDecision(ref, entry, now);
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
          const fiber = yield* Effect.forkDetach(
            refreshResourceEffect(ref).pipe(Effect.catch(() => Effect.void)),
            { startImmediately: true }
          );
          store.fiberRegistry.track(resourceStoreFiber(fiber));
        }
        return decision.value;
    }
  });

export const refsForResourceTag = (tag: ResourceTag): ReadonlyArray<AnyResourceRef<any>> =>
  resourceRefsForTag(tag, currentResourceStore());

export const planResourceInvalidation = <R = never>(
  target: ResourceInvalidationTarget<R>
): ResourceInvalidationPlan<R> =>
  planResourceInvalidationTargets(target, currentResourceStore()) as ResourceInvalidationPlan<R>;

export const planResourceInvalidationEffect = <R = never>(
  target: ResourceInvalidationTarget<R>
): Effect.Effect<ResourceInvalidationPlan<R>> =>
  Effect.map(resourceStoreEffect, (store) =>
    planResourceInvalidationTargets(target, store) as ResourceInvalidationPlan<R>
  );

export const invalidateResourceEffect = <R = never>(
  target: ResourceInvalidationTarget<R>
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* runResourceInvalidationPlanEffect(planResourceInvalidationTargets(target, store));
  });

export const runResourceInvalidationPlanEffect = <R = never>(
  plan: ResourceInvalidationPlan<R>
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    for (const entry of plan.entries) {
      yield* publishResourceStoreEvent(store, {
        _tag: "ResourceInvalidated",
        name: entry.ref.family.options.name,
        key: entry.ref.key,
        causes: entry.causes.map(describeResourceStoreInvalidationCause)
      });
      yield* refreshResourceEffect(entry.ref).pipe(Effect.catch(() => Effect.void));
    }
  });

export const invalidateResource = (
  target: ResourceInvalidationTarget
): void => {
  runResourceInvalidationPlan(planResourceInvalidationTargets(target, currentResourceStore()));
};

export const runResourceInvalidationPlan = (
  plan: ResourceInvalidationPlan
): void => {
  const store = currentResourceStore();
  void runFork(
    Effect.provideService(runResourceInvalidationPlanEffect(plan), ResourceStore, store).pipe(
      Effect.catch(() => Effect.void)
    )
  );
};

export const dehydrateResources = (
  refs: Iterable<AnyResourceRef<any>>,
  store: ResourceStoreState = currentResourceStore()
): ReadonlyArray<ResourceHydrationSnapshot> => {
  const snapshot: Array<ResourceHydrationSnapshot> = [];

  let index = 0;
  for (const ref of refs) {
    const pathIndex = index++;
    const entry = peekResourceEntry(ref, store);
    if (entry === undefined) {
      continue;
    }
    const state = entry.state.get() as ResourceState<unknown, unknown>;
    if (state._tag === "Success") {
      snapshot.push(resourceHydrationSnapshotFromRef(ref, state, `$[${pathIndex}]`));
    }
  }

  return snapshot;
};

export const dehydrateResourcesEffect = (
  refs: Iterable<AnyResourceRef<any>>
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
      const state = entry.state.get() as ResourceState<unknown, unknown>;
      if (state._tag === "Success") {
        snapshot.push(yield* resourceHydrationSnapshotFromRefEffect(ref, state, `$[${pathIndex}]`));
      }
    }

    return snapshot;
  });

export const resourceHydrationPayload = (refs: Iterable<AnyResourceRef<any>>): ResourceHydrationPayload => ({
  resources: dehydrateResources(refs)
});

export const resourceHydrationPayloadEffect = (
  refs: Iterable<AnyResourceRef<any>>
): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
  Effect.map(dehydrateResourcesEffect(refs), (resources) => ({ resources }));

interface ResourceHydrationPlanEntry {
  readonly ref: ResourceRef<any, any, any, any>;
  readonly state: Extract<ResourceState<any, any>, { readonly _tag: "Success" }>;
  readonly tags: readonly ResourceTag[];
}

const applyHydratedResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  tags: readonly ResourceTag[],
  store: ResourceStoreState
): Effect.Effect<void> =>
  Effect.gen(function* () {
    rememberResourceRef(ref, store);
    const entry = resourceEntry(ref, store);
    yield* interruptResourceGc(entry, store);
    yield* interruptResourceInFlight(entry, store);
    recordResourceProvidedTags(ref, tags, store);
    setResourceSuccess(entry, state.value, state.updatedAt);
    yield* Cache.set(resourceCache(ref.family, store), ref.key, state.value);
    yield* scheduleResourceGc(ref, entry, store, deleteResourceFromStoreEffect);
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceHydrated",
      name: ref.family.options.name,
      key: ref.key,
      updatedAt: state.updatedAt
    });
  });

export const hydrateResourceRefEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
  store: ResourceStoreState
): Effect.Effect<void, EffectInputCallbackError> =>
  Effect.gen(function* () {
    const tags = yield* resourceProvidedTagsEffect(ref, state.value);
    yield* applyHydratedResourceRefEffect(ref, state, tags, store);
  });

export const deleteResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* deleteResourceFromStoreEffect(ref, store);
  });

export const deleteResourceFromStoreEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const entries = resourceEntries(ref.family, store);
    const entry = entries.get(ref.key);
    if (entry) {
      yield* interruptResourceGc(entry, store);
      yield* interruptResourceInFlight(entry, store);
      resetResourceEntry(entry);
    }

    entries.delete(ref.key);
    removeResourceRefFromTagIndex(ref, store);
    yield* invalidateResourceCacheEntryEffect(ref, store);
    store.inputs.get(ref.family)?.delete(ref.key);
    yield* publishResourceStoreEvent(store, {
      _tag: "ResourceDeleted",
      name: ref.family.options.name,
      key: ref.key
    });
  });

export const deleteResource = (
  ref: AnyResourceRef
): void => {
  const store = currentResourceStore();
  void runFork(Effect.provideService(deleteResourceFromStoreEffect(ref, store), ResourceStore, store));
};

export const hydrateResourcesEffect = (
  input: ResourceHydrationInput,
  options: ResourceHydrationOptions = {}
): Effect.Effect<void, ResourceSnapshotCodecError | ResourceHydrationApplyError | EffectInputCallbackError> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const snapshots = yield* validateResourceHydrationInputEffect(input, "hydrate");
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
        return yield* Effect.fail(new ResourceHydrationApplyError({
          reason: "MissingFamily",
          path,
          name: snapshot.name,
          key: snapshot.key,
          guidance: "Register the Resource family before hydration, or pass { missingFamily: \"skip\" } to opt into dropping that snapshot."
        }));
      }

      const input = yield* decodeResourceHydrationInputEffect(family, snapshot, "hydrate", `${path}.input`);
      const ref = family.ref(input);
      if (ref.key !== snapshot.key) {
        if (options.keyMismatch === "skip") {
          continue;
        }
        return yield* Effect.fail(new ResourceHydrationApplyError({
          reason: "KeyMismatch",
          path,
          name: snapshot.name,
          key: snapshot.key,
          expectedKey: ref.key,
          guidance: "Hydration snapshot keys must match the registered Resource family's key function for the decoded input, or pass { keyMismatch: \"skip\" } to opt into dropping that snapshot."
        }));
      }

      const state = yield* decodeResourceHydrationStateEffect(family, snapshot, "hydrate", `${path}.state.value`);
      const successState = state as Extract<ResourceState<any, any>, { readonly _tag: "Success" }>;
      const tags = yield* resourceProvidedTagsEffect(ref, successState.value);
      plan.push({ ref, state: successState, tags });
    }

    yield* Effect.forEach(
      plan,
      (entry) => applyHydratedResourceRefEffect(entry.ref, entry.state, entry.tags, store),
      { discard: true }
    );
  });

export const hydrateResources = (
  input: ResourceHydrationInput,
  options?: ResourceHydrationOptions
): void => {
  currentOrDefaultRuntime().runSync(hydrateResourcesEffect(input, options));
};
