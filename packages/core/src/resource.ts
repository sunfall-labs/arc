import { Cache, Clock, Context, Data, Duration, Effect, Exit, Fiber, Option, PubSub, Scope, type Schedule } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { ResourceStore, type ResourceStore as ResourceStoreState, type ResourceStoreEvent, type ResourceStoreInvalidationCause } from "./resource-store.js";
import { currentOrDefaultRuntime, runFork } from "./runtime.js";
import { Signal, type ReadableSignal, type WritableSignal } from "./signal.js";
import { stableStringify } from "./stable-stringify.js";

export const ResourceTypeId = Symbol.for("@effect-ui/core/Resource");
export const ResourceTagTypeId: unique symbol = Symbol.for("@effect-ui/core/ResourceTag") as typeof ResourceTagTypeId;

export type DurationInput = number | `${number} ${"millisecond" | "milliseconds" | "second" | "seconds" | "minute" | "minutes"}`;

/** Cache lifecycle policy for a resource family. */
export interface ResourcePolicy<E = unknown> {
  /** How long a successful value is considered fresh before reads trigger refresh. */
  readonly staleFor?: DurationInput;
  /** How long a successful value remains cached before it can be collected. */
  readonly gcFor?: DurationInput;
  /** Retry schedule applied to the family load Effect. */
  readonly retry?: Schedule.Schedule<unknown, E>;
}

/** Load state for one resource ref. */
export type ResourceState<A, E = unknown> =
  | { readonly _tag: "Initial"; readonly waiting: false }
  | { readonly _tag: "Pending"; readonly waiting: true; readonly previous?: A }
  | { readonly _tag: "Success"; readonly waiting: false; readonly value: A; readonly updatedAt: number }
  | { readonly _tag: "Failure"; readonly waiting: false; readonly error: E; readonly previous?: A };

/**
 * Configuration for a typed resource family.
 *
 * A family maps an input to a cached Effect load. Use `provides` to attach tags
 * for broad invalidation after actions or server updates.
 */
export interface ResourceFamilyOptions<I, A, E = unknown, R = never> {
  /** Stable family name used for diagnostics, hydration, and invalidation events. */
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly policy?: ResourcePolicy<E>;
  /** Optional stable key override. Defaults to a stable stringify of the input. */
  readonly key?: (input: I) => string;
  /** Loads one value. May return a plain value or an Effect. */
  readonly load: (input: I) => EffectInput<A, E, R>;
  /** Tags provided by a successful value for later invalidation. */
  readonly provides?: (value: A, input: I) => ReadonlyArray<ResourceTag>;
}

export interface ResourceFamilyDiagnostics {
  readonly name: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly providesTags: boolean;
  readonly policy: {
    readonly staleFor?: DurationInput;
    readonly gcFor?: DurationInput;
    readonly retry: boolean;
  };
}

export interface ResourceTag {
  readonly [ResourceTagTypeId]: typeof ResourceTagTypeId;
  readonly name: string;
  readonly key: string;
}

export interface ResourceTagDefinition<Input> {
  readonly [ResourceTagTypeId]: typeof ResourceTagTypeId;
  readonly name: string;
  readonly ref: (input: Input) => ResourceTag;
  (input: Input): ResourceTag;
}

export interface ResourceTagDiagnostics {
  readonly name: string;
  readonly keyed: boolean;
}

/** Registered resource families and tags, intended for adapters and diagnostics UI. */
export interface ResourceDiagnostics {
  readonly families: readonly ResourceFamilyDiagnostics[];
  readonly tags: readonly ResourceTagDiagnostics[];
}

/** Stable reference to one input in a resource family. */
export interface ResourceRef<I = unknown, A = unknown, E = unknown, R = never> {
  readonly [ResourceTypeId]: typeof ResourceTypeId;
  readonly family: ResourceFamily<I, A, E, R>;
  readonly input: I;
  readonly key: string;
}

export type AnyResourceFamily = ResourceFamily<any, any, any, any>;
export type AnyResourceRef<R = any> = ResourceRef<any, any, any, R>;
export type ResourceInvalidation = AnyResourceRef<any> | ResourceTag;
export type ResourceInvalidationTarget = ResourceInvalidation | ReadonlyArray<ResourceInvalidation>;
export type ResourceInvalidationCause =
  | { readonly _tag: "Ref"; readonly ref: AnyResourceRef<any> }
  | { readonly _tag: "Tag"; readonly tag: ResourceTag };

/** One resource ref selected by an invalidation target, with the reasons it matched. */
export interface ResourceInvalidationPlanEntry {
  readonly ref: AnyResourceRef<any>;
  readonly causes: ReadonlyArray<ResourceInvalidationCause>;
}

export interface ResourceInvalidationPlan {
  readonly targets: ReadonlyArray<ResourceInvalidation>;
  readonly entries: ReadonlyArray<ResourceInvalidationPlanEntry>;
}

/** Serializable success snapshot used to transfer loaded resources across boundaries. */
export interface ResourceHydrationSnapshot<I = unknown, A = unknown, E = unknown> {
  readonly name: string;
  readonly key: string;
  readonly input: I;
  readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>;
}

export interface ResourceHydrationPayload {
  readonly resources: ReadonlyArray<ResourceHydrationSnapshot>;
}

interface ResourceStatusBase<I, A, E, R> {
  readonly ref: ResourceRef<I, A, E, R>;
  readonly name: string;
  readonly key: string;
  readonly input: I;
  readonly waiting: boolean;
  readonly hasValue: boolean;
  readonly hasPrevious: boolean;
  readonly isInitial: boolean;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly isFailure: boolean;
  readonly isFetching: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isStale: boolean;
  readonly isGcExpired: boolean;
  readonly updatedAt: number | undefined;
  readonly staleAt: number | undefined;
  readonly gcAt: number | undefined;
  readonly ageMillis: number | undefined;
  readonly staleInMillis: number | undefined;
  readonly gcInMillis: number | undefined;
}

export type ResourceStatus<I, A, E = unknown, R = never> =
  | (ResourceStatusBase<I, A, E, R> & {
      readonly _tag: "Initial";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Initial" }>;
      readonly value: undefined;
      readonly previous: undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R> & {
      readonly _tag: "Pending";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Pending" }>;
      readonly value: A | undefined;
      readonly previous: A | undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R> & {
      readonly _tag: "Success";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>;
      readonly value: A;
      readonly previous: undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R> & {
      readonly _tag: "Failure";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Failure" }>;
      readonly value: A | undefined;
      readonly previous: A | undefined;
      readonly error: E;
    });

/** Internal collector service used while planning route preloads. */
export interface ResourceCollector {
  readonly refs: Map<string, AnyResourceRef>;
}

export const ResourceCollector = Context.Service<ResourceCollector>(
  "@effect-ui/core/ResourceCollector"
);

interface ResourceEntry<A, E> {
  readonly state: WritableSignal<ResourceState<A, E>>;
  inFlight: ResourceInFlight<A, E> | undefined;
  gcFiber: Fiber.Fiber<void, never> | undefined;
}

interface ResourceInFlight<A, E> {
  readonly token: object;
  fiber: Fiber.Fiber<A, E>;
}

const familyDefinitions = new Map<string, AnyResourceFamily>();
const resourceTagDefinitions = new Map<string, ResourceTagDiagnostics>();
const familyIds = new WeakMap<object, number>();
let nextFamilyId = 0;

export class ResourceFailure<A = unknown, E = unknown> extends Data.TaggedError("ResourceFailure")<{
  readonly ref: ResourceRef<unknown, A, E, unknown>;
  readonly error: E;
  readonly previous: A | undefined;
}> {}

export class MissingResourceInput extends Data.TaggedError("MissingResourceInput")<{
  readonly key: string;
}> {}

export class UnsupportedDuration extends Data.TaggedError("UnsupportedDuration")<{
  readonly duration: unknown;
}> {}

/**
 * Runtime cache and state container for a set of resource refs.
 *
 * Most users create one through Resource.family and call the returned ref factory
 * instead of instantiating ResourceFamily directly.
 */
export class ResourceFamily<I, A, E = unknown, R = never> {
  constructor(readonly options: ResourceFamilyOptions<I, A, E, R>) {
    familyDefinitions.set(options.name, this as AnyResourceFamily);
  }

  #register(store: ResourceStoreState): void {
    store.families.set(this.options.name, this);
  }

  #inputs(store: ResourceStoreState): Map<string, I> {
    this.#register(store);
    const existing = store.inputs.get(this);
    if (existing) {
      return existing as Map<string, I>;
    }

    const inputs = new Map<string, I>();
    store.inputs.set(this, inputs as Map<string, unknown>);
    return inputs;
  }

  #entries(store: ResourceStoreState): Map<string, ResourceEntry<A, E>> {
    this.#register(store);
    const existing = store.entries.get(this);
    if (existing) {
      return existing as Map<string, ResourceEntry<A, E>>;
    }

    const entries = new Map<string, ResourceEntry<A, E>>();
    store.entries.set(this, entries as Map<string, unknown>);
    return entries;
  }

  #cache(store: ResourceStoreState): Cache.Cache<string, A, E, R> {
    this.#register(store);
    const existing = store.caches.get(this);
    if (existing) {
      return existing as Cache.Cache<string, A, E, R>;
    }

    const inputs = this.#inputs(store);
    const cache = Effect.runSync(
      Cache.makeWith<string, A, E, R, "lookup">(
        (key) => {
          if (!inputs.has(key)) {
            return Effect.die(new MissingResourceInput({ key }));
          }

          const input = inputs.get(key) as I;
          const load = toEffect(this.options.load(input));
          const retry = this.options.policy?.retry;
          return retry ? Effect.retry(load, retry) : load;
        },
        {
          capacity: Number.POSITIVE_INFINITY,
          requireServicesAt: "lookup",
          timeToLive: (exit: Exit.Exit<A, E>) =>
            Exit.isFailure(exit)
              ? 0
              : this.options.policy?.gcFor === undefined
                ? Duration.infinity
                : parseDuration(this.options.policy.gcFor)
        }
      )
    );
    store.caches.set(this, cache);
    return cache;
  }

  #remember(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState): void {
    this.#inputs(store).set(ref.key, ref.input);
  }

  /** Creates a stable ref for one input. */
  ref(input: I): ResourceRef<I, A, E, R> {
    const key = `${this.options.name}:${this.options.key?.(input) ?? stableStringify(input)}`;
    return {
      [ResourceTypeId]: ResourceTypeId,
      family: this,
      input,
      key
    };
  }

  /** Returns the store entry for a ref, creating it when needed. */
  entry(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState = currentResourceStore()): ResourceEntry<A, E> {
    this.#remember(ref, store);
    const entries = this.#entries(store);
    const existing = entries.get(ref.key);
    if (existing) {
      return existing;
    }

    const entry: ResourceEntry<A, E> = {
      state: Signal.make<ResourceState<A, E>>({ _tag: "Initial", waiting: false }),
      inFlight: undefined,
      gcFiber: undefined
    };
    entries.set(ref.key, entry);
    return entry;
  }

  /** Reads through the Effect Cache without updating ResourceState directly. */
  get(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState): Effect.Effect<A, E, R> {
    this.#remember(ref, store);
    return Cache.get(this.#cache(store), ref.key);
  }

  /** Refreshes the cached value for a ref through the Effect Cache. */
  refresh(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState): Effect.Effect<A, E, R> {
    this.#remember(ref, store);
    return Cache.refresh(this.#cache(store), ref.key);
  }

  invalidate(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState): Effect.Effect<void> {
    this.#remember(ref, store);
    return Cache.invalidate(this.#cache(store), ref.key);
  }

  hydrate(
    ref: ResourceRef<I, A, E, R>,
    state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>,
    store: ResourceStoreState
  ): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      self.#remember(ref, store);
      const entry = self.entry(ref, store);
      yield* interruptGcFiber(entry, store);
      yield* interruptInFlightResource(entry, store);
      entry.state.set(state);
      yield* Cache.set(self.#cache(store), ref.key, state.value);
      recordProvidedTags(ref, state.value, store);
      yield* scheduleGcEffect(ref, entry, store);
      yield* publishStoreEvent(store, {
        _tag: "ResourceHydrated",
        name: self.options.name,
        key: ref.key,
        updatedAt: state.updatedAt
      });
    });
  }

  entries(store: ResourceStoreState = currentResourceStore()): Iterable<ResourceEntry<A, E>> {
    return this.#entries(store).values();
  }

  deleteEffect(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState = currentResourceStore()): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const entries = self.#entries(store);
      const entry = entries.get(ref.key);
      if (entry) {
        yield* interruptGcFiber(entry, store);
        yield* interruptInFlightResource(entry, store);
      }

      entries.delete(ref.key);
      removeRefFromTagIndex(ref, store);
      yield* self.invalidate(ref, store);
      yield* publishStoreEvent(store, {
        _tag: "ResourceDeleted",
        name: self.options.name,
        key: ref.key
      });
    });
  }

  delete(ref: ResourceRef<I, A, E, R>, store: ResourceStoreState = currentResourceStore()): void {
    void runFork(Effect.provideService(this.deleteEffect(ref, store), ResourceStore, store));
  }
}

const currentResourceStore = (): ResourceStoreState => currentOrDefaultRuntime().resourceStore;

const resourceStoreEffect: Effect.Effect<ResourceStoreState> =
  Effect.gen(function* () {
    const store = yield* Effect.serviceOption(ResourceStore);
    return Option.isSome(store) ? store.value : currentResourceStore();
  });

const publishStoreEvent = (
  store: ResourceStoreState,
  event: ResourceStoreEvent
): Effect.Effect<void> =>
  PubSub.publish(store.events, event).pipe(Effect.asVoid);

const familyStoreId = (family: AnyResourceFamily): number => {
  const existing = familyIds.get(family);
  if (existing !== undefined) {
    return existing;
  }

  const id = nextFamilyId++;
  familyIds.set(family, id);
  return id;
};

const refStoreKey = (ref: AnyResourceRef): string =>
  `${familyStoreId(ref.family)}:${ref.key}`;

const parseDuration = (duration: DurationInput | undefined): number => {
  if (duration === undefined) {
    return 0;
  }

  if (typeof duration === "number") {
    return duration;
  }

  const match = /^(\d+) (milliseconds?|seconds?|minutes?)$/.exec(duration);
  if (!match) {
    throw new UnsupportedDuration({ duration });
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  if (unit.startsWith("millisecond")) return amount;
  if (unit.startsWith("second")) return amount * 1_000;
  return amount * 60_000;
};

const resourceFamilyDiagnostics = (
  family: AnyResourceFamily
): ResourceFamilyDiagnostics => {
  const policy = family.options.policy;
  return {
    name: family.options.name,
    inputSchema: family.options.input !== undefined,
    outputSchema: family.options.output !== undefined,
    errorSchema: family.options.error !== undefined,
    providesTags: family.options.provides !== undefined,
    policy: {
      ...(policy?.staleFor === undefined ? {} : { staleFor: policy.staleFor }),
      ...(policy?.gcFor === undefined ? {} : { gcFor: policy.gcFor }),
      retry: policy?.retry !== undefined
    }
  };
};

const getPrevious = <A, E>(state: ResourceState<A, E>): A | undefined => {
  switch (state._tag) {
    case "Success":
      return state.value;
    case "Pending":
    case "Failure":
      return state.previous;
    case "Initial":
      return undefined;
  }
};

const isStale = <A, E>(ref: ResourceRef<unknown, A, E, unknown>, state: ResourceState<A, E>): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  return staleFor > 0 && Date.now() - state.updatedAt > staleFor;
};

const isCollected = <A, E>(ref: ResourceRef<unknown, A, E, unknown>, state: ResourceState<A, E>): boolean => {
  if (state._tag !== "Success") {
    return false;
  }

  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  return gcFor > 0 && Date.now() - state.updatedAt > gcFor;
};

const deadline = (updatedAt: number | undefined, duration: number): number | undefined =>
  updatedAt === undefined || duration <= 0 ? undefined : updatedAt + duration;

const remaining = (deadline: number | undefined, now: number): number | undefined =>
  deadline === undefined ? undefined : Math.max(0, deadline - now);

const statusFromState = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  state: ResourceState<A, E>,
  now: number
): ResourceStatus<I, A, E, R> => {
  const staleFor = parseDuration(ref.family.options.policy?.staleFor);
  const gcFor = parseDuration(ref.family.options.policy?.gcFor);
  const updatedAt = state._tag === "Success" ? state.updatedAt : undefined;
  const staleAt = deadline(updatedAt, staleFor);
  const gcAt = deadline(updatedAt, gcFor);
  const hasPrevious = (state._tag === "Pending" || state._tag === "Failure") && "previous" in state;
  const value =
    state._tag === "Success"
      ? state.value
      : hasPrevious
        ? state.previous
        : undefined;
  const base: ResourceStatusBase<I, A, E, R> = {
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
    gcInMillis: remaining(gcAt, now)
  };

  switch (state._tag) {
    case "Initial":
      return {
        ...base,
        _tag: "Initial",
        state,
        value: undefined,
        previous: undefined,
        error: undefined
      };
    case "Pending":
      return {
        ...base,
        _tag: "Pending",
        state,
        value,
        previous: hasPrevious ? state.previous : undefined,
        error: undefined
      };
    case "Success":
      return {
        ...base,
        _tag: "Success",
        state,
        value: state.value,
        previous: undefined,
        error: undefined
      };
    case "Failure":
      return {
        ...base,
        _tag: "Failure",
        state,
        value,
        previous: hasPrevious ? state.previous : undefined,
        error: state.error
      };
  }
};

const inspectResource = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  store: ResourceStoreState,
  now: number
): ResourceStatus<I, A, E, R> =>
  statusFromState(ref, ref.family.entry(ref, store).state.get(), now);

const interruptGcFiber = <A, E>(
  entry: ResourceEntry<A, E>,
  store: ResourceStoreState
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const fiber = entry.gcFiber;
    if (!fiber) {
      return Effect.succeed(false);
    }

    entry.gcFiber = undefined;
    store.fibers.delete(fiber);
    return Fiber.interrupt(fiber).pipe(Effect.as(true));
  });

const clearInFlightResource = <A, E>(
  entry: ResourceEntry<A, E>,
  store: ResourceStoreState,
  token: object
): Effect.Effect<void> =>
  Effect.sync(() => {
    const inFlight = entry.inFlight;
    if (inFlight?.token !== token) {
      return;
    }

    entry.inFlight = undefined;
    store.fibers.delete(inFlight.fiber);
  });

const interruptInFlightResource = <A, E>(
  entry: ResourceEntry<A, E>,
  store: ResourceStoreState
): Effect.Effect<boolean> =>
  Effect.suspend(() => {
    const inFlight = entry.inFlight;
    entry.inFlight = undefined;
    if (!inFlight) {
      return Effect.succeed(false);
    }

    store.fibers.delete(inFlight.fiber);
    return Fiber.interrupt(inFlight.fiber).pipe(Effect.as(true));
  });

const scheduleGcEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  entry: ResourceEntry<A, E>,
  store: ResourceStoreState
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const interrupted = yield* interruptGcFiber(entry, store);
    if (interrupted) {
      yield* publishStoreEvent(store, {
        _tag: "ResourceGcInterrupted",
        name: ref.family.options.name,
        key: ref.key
      });
    }

    const gcFor = parseDuration(ref.family.options.policy?.gcFor);
    if (gcFor <= 0) {
      return;
    }

    const fiber = yield* Effect.forkDetach(
      Effect.gen(function* () {
        yield* Effect.sleep(gcFor);
        entry.gcFiber = undefined;
        store.fibers.delete(fiber);
        yield* ref.family.deleteEffect(ref, store);
      }),
      { startImmediately: true }
    );
    entry.gcFiber = fiber;
    store.fibers.add(fiber);
    yield* publishStoreEvent(store, {
      _tag: "ResourceGcScheduled",
      name: ref.family.options.name,
      key: ref.key,
      gcFor
    });
  });

const setPending = <A, E>(entry: ResourceEntry<A, E>): void => {
  const previous = getPrevious(entry.state.get());
  entry.state.set({
    _tag: "Pending",
    waiting: true,
    ...(previous === undefined ? {} : { previous })
  });
};

const setFailure = <A, E>(entry: ResourceEntry<A, E>, error: E): void => {
  const previous = getPrevious(entry.state.get());
  entry.state.set({
    _tag: "Failure",
    waiting: false,
    error,
    ...(previous === undefined ? {} : { previous })
  });
};

export const isResourceTag = (value: unknown): value is ResourceTag =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTagTypeId]?: unknown })[ResourceTagTypeId] === ResourceTagTypeId &&
  typeof (value as { readonly key?: unknown }).key === "string";

const makeResourceTag = (name: string, key: string): ResourceTag => ({
  [ResourceTagTypeId]: ResourceTagTypeId,
  name,
  key
});

const removeRefFromTagIndex = (ref: AnyResourceRef, store: ResourceStoreState): void => {
  const storeKey = refStoreKey(ref);
  const tags = store.refTags.get(storeKey);
  if (!tags) {
    return;
  }

  for (const tagKey of tags) {
    const refs = store.tagIndex.get(tagKey);
    refs?.delete(storeKey);
    if (refs?.size === 0) {
      store.tagIndex.delete(tagKey);
    }
  }

  store.refTags.delete(storeKey);
};

const recordProvidedTags = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  value: A,
  store: ResourceStoreState
): void => {
  const tags = ref.family.options.provides?.(value, ref.input) ?? [];
  removeRefFromTagIndex(ref, store);

  if (tags.length === 0) {
    return;
  }

  const storeKey = refStoreKey(ref);
  const keys = new Set<string>();
  for (const tag of tags) {
    let refs = store.tagIndex.get(tag.key);
    if (!refs) {
      refs = new Map();
      store.tagIndex.set(tag.key, refs);
    }
    refs.set(storeKey, ref);
    keys.add(tag.key);
  }

  store.refTags.set(storeKey, keys);
};

export const isResourceRef = (value: unknown): value is ResourceRef =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTypeId]?: unknown })[ResourceTypeId] === ResourceTypeId;

const planInvalidationTargets = (
  target: ResourceInvalidationTarget,
  store: ResourceStoreState = currentResourceStore()
): ResourceInvalidationPlan => {
  const targets = Array.isArray(target) ? target : [target];
  const entries = new Map<string, { readonly ref: AnyResourceRef<any>; readonly causes: Array<ResourceInvalidationCause> }>();
  const addCause = (ref: AnyResourceRef<any>, cause: ResourceInvalidationCause): void => {
    const storeKey = refStoreKey(ref);
    const existing = entries.get(storeKey);
    if (existing) {
      existing.causes.push(cause);
    } else {
      entries.set(storeKey, { ref, causes: [cause] });
    }
  };

  for (const candidate of targets) {
    if (isResourceRef(candidate)) {
      addCause(candidate, { _tag: "Ref", ref: candidate });
      continue;
    }

    if (isResourceTag(candidate)) {
      const taggedRefs = store.tagIndex.get(candidate.key);
      if (!taggedRefs) {
        continue;
      }

      for (const ref of taggedRefs.values() as Iterable<AnyResourceRef<any>>) {
        addCause(ref, { _tag: "Tag", tag: candidate });
      }
    }
  }

  return {
    targets,
    entries: Array.from(entries.values()).map((entry) => ({
      ref: entry.ref,
      causes: entry.causes
    }))
  };
};

const describeStoreInvalidationCause = (
  cause: ResourceInvalidationCause
): ResourceStoreInvalidationCause => {
  switch (cause._tag) {
    case "Ref":
      return {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      };
    case "Tag":
      return {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };
  }
};

const recordTouched = (ref: AnyResourceRef): Effect.Effect<void> =>
  Effect.gen(function* () {
    const collector = yield* Effect.serviceOption(ResourceCollector);
    if (Option.isSome(collector)) {
      collector.value.refs.set(ref.key, ref);
    }
  });

/**
 * Resource helpers for cached Effect data, suspense reads, invalidation, and hydration.
 */
export namespace Resource {
  export type Ref<I, A, E = unknown, R = never> = ResourceRef<I, A, E, R>;
  export type AnyRef<R = never> = AnyResourceRef<R>;
  export type State<A, E = unknown> = ResourceState<A, E>;
  export type Tag = ResourceTag;
  export type TagDefinition<Input> = ResourceTagDefinition<Input>;
  export type Invalidation = ResourceInvalidation;
  export type InvalidationTarget = ResourceInvalidationTarget;
  export type InvalidationCause = ResourceInvalidationCause;
  export type InvalidationPlanEntry = ResourceInvalidationPlanEntry;
  export type InvalidationPlan = ResourceInvalidationPlan;
  export type Snapshot<I = unknown, A = unknown, E = unknown> = ResourceHydrationSnapshot<I, A, E>;
  export type HydrationPayload = ResourceHydrationPayload;
  export type Status<I, A, E = unknown, R = never> = ResourceStatus<I, A, E, R>;
  export type StoreEvent = ResourceStoreEvent;
  export type FamilyDiagnostics = ResourceFamilyDiagnostics;
  export type TagDiagnostics = ResourceTagDiagnostics;
  export type Diagnostics = ResourceDiagnostics;
  export type Collected<A> = {
    readonly value: A;
    readonly refs: ReadonlyArray<AnyResourceRef>;
  };

  /**
   * Defines a resource family and returns a ref factory.
   *
   * Call the returned function with input to create Resource refs, then use
   * prefetchEffect, refreshEffect, or read to load and consume values.
   *
   * @example
   * ```ts
   * const User = Resource.family({
   *   name: "User",
   *   load: ({ id }: { id: string }) => ServerGetUser.effect({ id })
   * });
   *
   * const ref = User({ id: "42" });
   * const user = yield* Resource.prefetchEffect(ref);
   * ```
   */
  export const family = <I, A, E = unknown, R = never>(
    options: Omit<ResourceFamilyOptions<I, A, E, R>, "load"> & {
      readonly load: (input: I) => EffectInput<A, E, R>;
    }
  ): ((input: I) => ResourceRef<I, A, E, R>) & { readonly family: ResourceFamily<I, A, E, R> } => {
    const family = new ResourceFamily(options as ResourceFamilyOptions<I, A, E, R>);
    const makeRef = ((input: I) => family.ref(input)) as ((input: I) => ResourceRef<I, A, E, R>) & {
      readonly family: ResourceFamily<I, A, E, R>;
    };

    Object.defineProperty(makeRef, "family", {
      value: family,
      enumerable: true
    });

    return makeRef;
  };

  const makeTagDefinition = <Input>(
    name: string,
    options: { readonly key?: (input: Input) => string } = {}
  ): ResourceTagDefinition<Input> => {
    const keyFor = options.key ?? ((input: Input) => stableStringify(input));
    const make = ((input: Input) => makeResourceTag(name, `${name}:${keyFor(input)}`)) as ResourceTagDefinition<Input>;

    Object.defineProperties(make, {
      [ResourceTagTypeId]: {
        value: ResourceTagTypeId,
        enumerable: false
      },
      name: {
        value: name,
        configurable: true,
        enumerable: true
      },
      ref: {
        value: make,
        enumerable: true
      }
    });

    return make;
  };

  /**
   * Defines an invalidation tag.
   *
   * Use unkeyed tags for broad invalidation and keyed tag definitions for specific
   * entities, then return tags from a family's `provides` callback.
   */
  export function tag(name: string): ResourceTag;
  export function tag<Input>(
    name: string,
    options: { readonly key?: (input: Input) => string }
  ): ResourceTagDefinition<Input>;
  export function tag<Input>(
    name: string,
    options?: { readonly key?: (input: Input) => string }
  ): ResourceTag | ResourceTagDefinition<Input> {
    resourceTagDefinitions.set(name, {
      name,
      keyed: options !== undefined
    });
    return options === undefined
      ? makeResourceTag(name, name)
      : makeTagDefinition(name, options);
  }

  export const definitions = (): ReadonlyMap<string, AnyResourceFamily> =>
    familyDefinitions;

  export const tagDefinitions = (): ReadonlyMap<string, ResourceTagDiagnostics> =>
    resourceTagDefinitions;

  export const diagnostics = (): ResourceDiagnostics => ({
    families: Array.from(familyDefinitions.values(), resourceFamilyDiagnostics)
      .sort((left, right) => left.name.localeCompare(right.name)),
    tags: Array.from(resourceTagDefinitions.values())
      .sort((left, right) => left.name.localeCompare(right.name))
  });

  export const refsForTag = (tag: ResourceTag): ReadonlyArray<AnyResourceRef> =>
    Array.from(currentResourceStore().tagIndex.get(tag.key)?.values() ?? []) as ReadonlyArray<AnyResourceRef>;

  /** Computes which cached refs would be affected by a ref or tag invalidation. */
  export const planInvalidation = (target: ResourceInvalidationTarget): ResourceInvalidationPlan =>
    planInvalidationTargets(target, currentResourceStore());

  /** Effect version of planInvalidation that uses the ResourceStore in context. */
  export const planInvalidationEffect = (
    target: ResourceInvalidationTarget
  ): Effect.Effect<ResourceInvalidationPlan> =>
    Effect.map(resourceStoreEffect, (store) => planInvalidationTargets(target, store));

  export const subscribeEventsEffect = (): Effect.Effect<PubSub.Subscription<ResourceStoreEvent>, never, Scope.Scope> =>
    Effect.flatMap(resourceStoreEffect, (store) => PubSub.subscribe(store.events));

  export const result = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): ReadableSignal<ResourceState<A, E>> =>
    ref.family.entry(ref, currentResourceStore()).state;

  /**
   * Returns a rich snapshot of a resource ref without starting a load.
   *
   * Use this for UI state such as loading, refreshing, stale, and cache age.
   */
  export const status = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): ResourceStatus<I, A, E, R> =>
    inspectResource(ref, currentResourceStore(), Date.now());

  /** Effect version of status that reads time and store from Effect context. */
  export const statusEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<ResourceStatus<I, A, E, R>> =>
    Effect.gen(function* () {
      const store = yield* resourceStoreEffect;
      const now = yield* Clock.currentTimeMillis;
      return inspectResource(ref, store, now);
    });

  export const value = <A, E>(state: ResourceState<A, E>): A | undefined => {
    switch (state._tag) {
      case "Success":
        return state.value;
      case "Pending":
      case "Failure":
        return state.previous;
      case "Initial":
        return undefined;
    }
  };

  export const error = <A, E>(state: ResourceState<A, E>): E | undefined =>
    state._tag === "Failure" ? state.error : undefined;

  const run = <I, A, E, R>(
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
          const shouldShowPending =
            options.force ||
            current._tag === "Initial" ||
            current._tag === "Failure" ||
            isCollected(ref as ResourceRef<unknown, A, E, unknown>, current);

          if (shouldShowPending) {
            yield* interruptGcFiber(entry, store);
            setPending(entry);
            yield* publishStoreEvent(store, {
              _tag: "ResourcePending",
              name: ref.family.options.name,
              key: ref.key,
              force: options.force,
              previous: getPrevious(current) !== undefined
            });
          }

          const value = yield* (options.force ? ref.family.refresh(ref, store) : ref.family.get(ref, store));
          const updatedAt = yield* Clock.currentTimeMillis;
          entry.state.set({
            _tag: "Success",
            waiting: false,
            value,
            updatedAt
          });

          recordProvidedTags(ref, value, store);
          yield* scheduleGcEffect(ref, entry, store);
          yield* publishStoreEvent(store, {
            _tag: "ResourceSuccess",
            name: ref.family.options.name,
            key: ref.key,
            updatedAt
          });

          return value;
        }).pipe(Effect.ensuring(clearInFlightResource(entry, store, token)));
      });
    }).pipe(
      Effect.catch((error: E) =>
        Effect.gen(function* () {
          const store = yield* resourceStoreEffect;
          const entry = ref.family.entry(ref, store);
          yield* interruptGcFiber(entry, store);
          const previous = getPrevious(entry.state.get());
          setFailure(entry, error);
          yield* ref.family.invalidate(ref, store);
          yield* publishStoreEvent(store, {
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

  /**
   * Forces a resource ref to reload as an Effect and updates cache state.
   *
   * Prefer this inside route preloads, actions, and other Effect workflows.
   */
  export const refreshEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E, R> =>
    run(ref, { force: true });
  /**
   * Ensures a resource ref is loaded as an Effect, reusing fresh cached data.
   *
   * This records the ref for route preload collection and shares in-flight work.
   */
  export const prefetchEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, E, R> =>
    run(ref, { force: false });

  /** Runs an Effect and returns the resource refs it touched through prefetch/read. */
  export const collectEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<Collected<A>, E, R> =>
    Effect.gen(function* () {
      const collector: ResourceCollector = { refs: new Map() };
      const value = yield* Effect.provideService(effect, ResourceCollector, collector);
      return {
        value,
        refs: Array.from(collector.refs.values())
      };
    });

  const suspensePromise = <I, A, E, R>(
    ref: ResourceRef<I, A, E, R>,
    entry: ResourceEntry<A, E>
  ): Promise<A> => {
    const runtime = currentOrDefaultRuntime();
    return entry.inFlight
      ? runtime.runPromise(Fiber.join(entry.inFlight.fiber))
      : runtime.runPromise(prefetchEffect(ref));
  };

  /**
   * Reads a resource value for render code.
   *
   * If the value is missing it throws a Promise for suspense. If loading failed it
   * throws ResourceFailure. Stale values are returned immediately while refresh runs
   * in the background.
   */
  export const read = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): A => {
    const entry = ref.family.entry(ref, currentResourceStore());
    const state = readSignal(entry.state);

    if (state._tag === "Initial") {
      throw suspensePromise(ref, entry);
    }

    if (state._tag === "Pending") {
      if ("previous" in state) {
        return state.previous as A;
      }
      throw suspensePromise(ref, entry);
    }

    if (state._tag === "Failure") {
      throw new ResourceFailure({
        ref: ref as ResourceRef<unknown, A, E, unknown>,
        error: state.error,
        previous: state.previous
      });
    }

    if (isCollected(ref as ResourceRef<unknown, A, E, unknown>, state)) {
      entry.state.set({ _tag: "Initial", waiting: false });
      throw suspensePromise(ref, entry);
    }

    if (isStale(ref as ResourceRef<unknown, A, E, unknown>, state)) {
      void runFork(
        refreshEffect(ref).pipe(
          Effect.catch(() => Effect.void)
        )
      );
    }

    return state.value;
  };

  /**
   * Invalidates refs or tags and refreshes affected resources as an Effect.
   */
  export const invalidateEffect = <R = any>(
    target: ResourceInvalidationTarget
  ): Effect.Effect<void, never, R> =>
    Effect.gen(function* () {
      const store = yield* resourceStoreEffect;
      yield* runInvalidationPlanEffect(planInvalidationTargets(target, store));
    });

  /** Runs a previously computed invalidation plan as an Effect. */
  export const runInvalidationPlanEffect = <R = any>(
    plan: ResourceInvalidationPlan
  ): Effect.Effect<void, never, R> =>
    Effect.gen(function* () {
      const store = yield* resourceStoreEffect;
      for (const entry of plan.entries) {
        yield* publishStoreEvent(store, {
          _tag: "ResourceInvalidated",
          name: entry.ref.family.options.name,
          key: entry.ref.key,
          causes: entry.causes.map(describeStoreInvalidationCause)
        });
        yield* refreshEffect(entry.ref).pipe(Effect.catch(() => Effect.void));
      }
    });

  /** Fire-and-forget runtime boundary for invalidateEffect. */
  export const invalidate = (
    target: ResourceInvalidationTarget
  ): void => {
    runInvalidationPlan(planInvalidationTargets(target, currentResourceStore()));
  };

  /** Fire-and-forget runtime boundary for runInvalidationPlanEffect. */
  export const runInvalidationPlan = (
    plan: ResourceInvalidationPlan
  ): void => {
    const store = currentResourceStore();
    void runFork(
      Effect.provideService(runInvalidationPlanEffect(plan), ResourceStore, store).pipe(
        Effect.catch(() => Effect.void)
      )
    );
  };

  const dehydrateWithStore = (
    refs: Iterable<AnyResourceRef>,
    store: ResourceStoreState
  ): ReadonlyArray<ResourceHydrationSnapshot> => {
    const snapshot: Array<ResourceHydrationSnapshot> = [];

    for (const ref of refs) {
      const state = ref.family.entry(ref, store).state.get() as ResourceState<unknown, unknown>;
      if (state._tag === "Success") {
        snapshot.push({
          name: ref.family.options.name,
          key: ref.key,
          input: ref.input,
          state
        });
      }
    }

    return snapshot;
  };

  /** Serializes successful resource refs from the current store for hydration. */
  export const dehydrate = (
    refs: Iterable<AnyResourceRef>
  ): ReadonlyArray<ResourceHydrationSnapshot> =>
    dehydrateWithStore(refs, currentResourceStore());

  /** Effect version of dehydrate that reads the ResourceStore from context. */
  export const dehydrateEffect = (
    refs: Iterable<AnyResourceRef>
  ): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>> =>
    Effect.map(resourceStoreEffect, (store) => dehydrateWithStore(refs, store));

  /** Wraps dehydrated snapshots in the payload shape used by route plans. */
  export const hydrationPayload = (refs: Iterable<AnyResourceRef>): ResourceHydrationPayload => ({
    resources: dehydrate(refs)
  });

  /** Effect version of hydrationPayload. */
  export const hydrationPayloadEffect = (
    refs: Iterable<AnyResourceRef>
  ): Effect.Effect<ResourceHydrationPayload> =>
    Effect.map(dehydrateEffect(refs), (resources) => ({ resources }));

  const snapshotsFrom = (
    input: ReadonlyArray<ResourceHydrationSnapshot> | ResourceHydrationPayload
  ): ReadonlyArray<ResourceHydrationSnapshot> =>
    "resources" in input ? input.resources : input;

  /**
   * Restores successful resource snapshots into the current ResourceStore.
   *
   * Unknown families and mismatched keys are skipped, making it safe to hydrate
   * partial payloads.
   */
  export const hydrateEffect = (
    input: ReadonlyArray<ResourceHydrationSnapshot> | ResourceHydrationPayload
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const store = yield* resourceStoreEffect;
      for (const snapshot of snapshotsFrom(input)) {
        const family =
          store.families.get(snapshot.name) as AnyResourceFamily | undefined ??
          familyDefinitions.get(snapshot.name);
        if (!family) {
          continue;
        }

        const ref = family.ref(snapshot.input);
        if (ref.key !== snapshot.key) {
          continue;
        }

        yield* family.hydrate(ref, snapshot.state as Extract<ResourceState<any, any>, { readonly _tag: "Success" }>, store);
      }
    });

  /** Synchronous runtime boundary for hydrateEffect. */
  export const hydrate = (
    input: ReadonlyArray<ResourceHydrationSnapshot> | ResourceHydrationPayload
  ): void => {
    currentOrDefaultRuntime().runSync(hydrateEffect(input));
  };
}

const readSignal = <A>(signal: ReadableSignal<A>): A => signal.get();
