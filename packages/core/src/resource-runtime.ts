import { Clock, Effect, Fiber, Option, PubSub, Schema, Scope } from "effect";
import {
  planResourceInvalidationTargets,
  recordResourceProvidedTags,
  resourceRefsForTag
} from "./resource-dependency-graph.js";
import { describeResourceStoreInvalidationCause, publishResourceStoreEvent } from "./resource-events.js";
import { ResourceCollector, type ResourceCollected } from "./resource-collector.js";
import { ResourceFailure, ResourcePending } from "./resource-errors.js";
import { lookupResourceHydrationFamily } from "./resource-registry.js";
import {
  decodeResourceHydrationInputEffect,
  decodeResourceHydrationStateEffect,
  ResourceHydrationApplyError,
  resourceHydrationSnapshotFromRef,
  type ResourceSnapshotCodecError,
  validateResourceHydrationInputEffect
} from "./resource-snapshot-codec.js";
import {
  clearResourceInFlight,
  inspectResourceStatus,
  interruptResourceGc,
  isResourceStateCollected,
  isResourceStateStale,
  previousResourceValue,
  resetResourceEntry,
  scheduleResourceGc,
  setResourceFailure,
  setResourcePending,
  setResourceSuccess,
  shouldShowResourcePending
} from "./resource-lifetime.js";
import { ResourceStore, type ResourceStore as ResourceStoreState, type ResourceStoreEvent } from "./resource-store.js";
import { currentOrDefaultRuntime, runFork } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";
import type {
  AnyResourceRef,
  ResourceHydrationInput,
  ResourceHydrationOptions,
  ResourceHydrationPayload,
  ResourceHydrationSnapshot,
  ResourceInvalidationPlan,
  ResourceInvalidationTarget,
  ResourceTag,
  ResourceRef,
  ResourceState,
  ResourceStatus
} from "./resource.js";

export const currentResourceStore = (): ResourceStoreState =>
  currentOrDefaultRuntime().resourceStore;

export const resourceStoreEffect: Effect.Effect<ResourceStoreState> =
  Effect.gen(function* () {
    const store = yield* Effect.serviceOption(ResourceStore);
    return Option.isSome(store) ? store.value : currentResourceStore();
  });

const recordTouched = (ref: AnyResourceRef): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(ResourceCollector);
    if (Option.isSome(collector)) {
      collector.value.refs.set(ref.key, ref);
    }
  });

export const subscribeResourceEventsEffect = (): Effect.Effect<PubSub.Subscription<ResourceStoreEvent>, never, Scope.Scope> =>
  Effect.flatMap(resourceStoreEffect, (store) => PubSub.subscribe(store.events));

export const resourceResult = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): ReadableSignal<ResourceState<A, E>> =>
  ref.family.entry(ref, currentResourceStore()).state;

export const resourceStatus = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): ResourceStatus<I, A, E, R> =>
  inspectResourceStatus(ref, currentResourceStore(), Date.now());

export const resourceStatusEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<ResourceStatus<I, A, E, R>> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const now = yield* Clock.currentTimeMillis;
    return inspectResourceStatus(ref, store, now);
  });

export const runResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  options: { readonly force: boolean }
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* recordTouched(ref as AnyResourceRef);
    const entry = ref.family.entry(ref, store);
    const currentInFlight = entry.inFlight;
    if (currentInFlight) {
      return yield* Fiber.join(currentInFlight.fiber);
    }

    const token = {};

    return yield* Effect.withFiber((fiber) => {
      entry.inFlight = {
        token,
        fiber: fiber as Fiber.Fiber<A, E>
      };
      store.fibers.add(fiber as Fiber.Fiber<A, E>);

      return Effect.gen(function* () {
        const current = entry.state.get();
        const shouldShowPending = shouldShowResourcePending(
          ref as ResourceRef<unknown, A, E, unknown>,
          current,
          options.force
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

        const value = yield* (options.force ? ref.family.refresh(ref, store) : ref.family.get(ref, store));
        const updatedAt = yield* Clock.currentTimeMillis;
        setResourceSuccess(entry, value, updatedAt);

        recordResourceProvidedTags(ref, value, store);
        yield* scheduleResourceGc(ref, entry, store);
        yield* publishResourceStoreEvent(store, {
          _tag: "ResourceSuccess",
          name: ref.family.options.name,
          key: ref.key,
          updatedAt
        });

        return value;
      }).pipe(Effect.ensuring(clearResourceInFlight(entry, store, token)));
    });
  }).pipe(
    Effect.catch((error: E) =>
      Effect.gen(function* () {
        const store = yield* resourceStoreEffect;
        const entry = ref.family.entry(ref, store);
        yield* interruptResourceGc(entry, store);
        const previous = previousResourceValue(entry.state.get());
        setResourceFailure(entry, error);
        yield* ref.family.invalidate(ref, store);
        yield* publishResourceStoreEvent(store, {
          _tag: "ResourceFailure",
          name: ref.family.options.name,
          key: ref.key,
          error,
          previous: previous !== undefined
        });
        return yield* Effect.fail(error);
      })
    )
  );

export const refreshResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<A, E, R> =>
  runResourceEffect(ref, { force: true });

export const prefetchResourceEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>
): Effect.Effect<A, E, R> =>
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
    guidance: "Resource.read(...) is synchronous and Effect-first. Run Resource.prefetchEffect(...) before reading, or use a UI adapter such as Solid useResourceSuspense(...) for Suspense."
  });

export const readResource = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): A => {
  const entry = ref.family.entry(ref, currentResourceStore());
  const state = entry.state.get();

  if (state._tag === "Initial") {
    throw resourcePending(ref, "Initial", undefined);
  }

  if (state._tag === "Pending") {
    if ("previous" in state) {
      return state.previous as A;
    }
    throw resourcePending(ref, "Pending", undefined);
  }

  if (state._tag === "Failure") {
    throw new ResourceFailure({
      ref: ref as ResourceRef<unknown, A, E, unknown>,
      error: state.error,
      previous: state.previous
    });
  }

  if (isResourceStateCollected(ref as ResourceRef<unknown, A, E, unknown>, state)) {
    resetResourceEntry(entry);
    throw resourcePending(ref, "Collected", state.value);
  }

  if (isResourceStateStale(ref as ResourceRef<unknown, A, E, unknown>, state)) {
    void runFork(
      refreshResourceEffect(ref).pipe(
        Effect.catch(() => Effect.void)
      )
    );
  }

  return state.value;
};

export const refsForResourceTag = (tag: ResourceTag): ReadonlyArray<AnyResourceRef> =>
  resourceRefsForTag(tag, currentResourceStore());

export const planResourceInvalidation = (
  target: ResourceInvalidationTarget
): ResourceInvalidationPlan =>
  planResourceInvalidationTargets(target, currentResourceStore());

export const planResourceInvalidationEffect = (
  target: ResourceInvalidationTarget
): Effect.Effect<ResourceInvalidationPlan> =>
  Effect.map(resourceStoreEffect, (store) => planResourceInvalidationTargets(target, store));

export const invalidateResourceEffect = <R = any>(
  target: ResourceInvalidationTarget
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    yield* runResourceInvalidationPlanEffect(planResourceInvalidationTargets(target, store));
  });

export const runResourceInvalidationPlanEffect = <R = any>(
  plan: ResourceInvalidationPlan
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
  refs: Iterable<AnyResourceRef>,
  store: ResourceStoreState = currentResourceStore()
): ReadonlyArray<ResourceHydrationSnapshot> => {
  const snapshot: Array<ResourceHydrationSnapshot> = [];

  for (const ref of refs) {
    const state = ref.family.entry(ref, store).state.get() as ResourceState<unknown, unknown>;
    if (state._tag === "Success") {
      snapshot.push(resourceHydrationSnapshotFromRef(ref, state));
    }
  }

  return snapshot;
};

export const dehydrateResourcesEffect = (
  refs: Iterable<AnyResourceRef>
): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>> =>
  Effect.map(resourceStoreEffect, (store) => dehydrateResources(refs, store));

export const resourceHydrationPayload = (refs: Iterable<AnyResourceRef>): ResourceHydrationPayload => ({
  resources: dehydrateResources(refs)
});

export const resourceHydrationPayloadEffect = (
  refs: Iterable<AnyResourceRef>
): Effect.Effect<ResourceHydrationPayload> =>
  Effect.map(dehydrateResourcesEffect(refs), (resources) => ({ resources }));

export const hydrateResourcesEffect = (
  input: ResourceHydrationInput,
  options: ResourceHydrationOptions = {}
): Effect.Effect<void, ResourceSnapshotCodecError | ResourceHydrationApplyError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const store = yield* resourceStoreEffect;
    const snapshots = yield* validateResourceHydrationInputEffect(input, "hydrate");
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

      const input = yield* decodeResourceHydrationInputEffect(family, snapshot);
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

      const state = yield* decodeResourceHydrationStateEffect(family, snapshot);
      yield* family.hydrate(ref, state as Extract<ResourceState<any, any>, { readonly _tag: "Success" }>, store);
    }
  });

export const hydrateResources = (
  input: ResourceHydrationInput,
  options?: ResourceHydrationOptions
): void => {
  currentOrDefaultRuntime().runSync(hydrateResourcesEffect(input, options));
};
