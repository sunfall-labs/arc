import {
  Effect,
  Request as EffectRequest,
  RequestResolver,
  Schema,
  type Schedule
} from "effect";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput,
  EnsureEffectInputValue
} from "./effect-like.js";
import { EffectInputCallbackError, EffectInputPromiseRejected } from "./effect-like.js";
import { isPromiseLikeValue } from "./effect-input-sync.js";
import type { DurationInput } from "./resource-duration.js";
import { ResourceKeyError, type ResourceFailure, type ResourcePending } from "./resource-errors.js";
import { ResourceTagIdentityTypeId, ResourceTagTypeId, ResourceTypeId } from "./resource-identifiers.js";
import type { ResourceStoreEvent } from "./resource-store.js";
import type { ReadableSignal } from "./signal.js";
import { encodeResourceKey } from "./resource-key-codec.js";
import type { ResourceCollected } from "./resource-collector.js";
import {
  decodeResourceHydrationPayloadEffect,
  encodeResourceHydrationPayloadEffect,
  ResourceHydrationApplyError,
  type ResourceSnapshotCodecError
} from "./resource-snapshot-codec.js";
import {
  registerResourceDefinition,
  registerResourceTagDefinition,
  resourceDefinitionRegistry,
  resourceDiagnostics,
  resourceRegistryDiagnostics,
  resourceTagDefinitionRegistry
} from "./resource-registry.js";
import {
  collectResourceEffect,
  dehydrateResources,
  dehydrateResourcesEffect,
  deleteResourceEffect,
  hydrateResources,
  hydrateResourcesEffect,
  invalidateResource,
  invalidateResourceEffect,
  lookupResourceFamilyEffect,
  planResourceInvalidation,
  planResourceInvalidationEffect,
  prefetchResourceEffect,
  readResourceEffect,
  readResource,
  refsForResourceTag,
  refreshResourceEffect,
  resourceHydrationPayload,
  resourceHydrationPayloadEffect,
  resourceResult,
  resourceStatus,
  resourceStatusEffect,
  runResourceInvalidationPlan,
  runResourceInvalidationPlanEffect,
  subscribeResourceEventsEffect
} from "./resource-runtime.js";

export { isResourceRef, isResourceTag } from "./resource-dependency-graph.js";
export { UnsupportedDuration } from "./resource-duration.js";
export type { DurationInput } from "./resource-duration.js";
export { ResourceTagIdentityTypeId, ResourceTagTypeId, ResourceTypeId } from "./resource-identifiers.js";
export { MissingResourceInput, ResourceFailure, ResourceKeyError, ResourcePending } from "./resource-errors.js";

/** Cache lifecycle policy for a resource family. */
export interface ResourcePolicy<E = never> {
  /** How long a successful value is considered fresh before reads trigger refresh. */
  readonly staleFor?: DurationInput;
  /** How long a successful value remains cached before it can be collected. */
  readonly gcFor?: DurationInput;
  /** Retry schedule applied to the family load Effect. */
  readonly retry?: Schedule.Schedule<unknown, E>;
}

/** Load state for one resource ref. */
export type ResourceState<A, E = never> =
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
export interface ResourceFamilyOptions<I, A, E = never, R = never> {
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

/**
 * Configuration for a resource family whose loads are delegated to an Effect
 * RequestResolver.
 */
export interface ResourceRequestFamilyOptions<
  I,
  Req extends EffectRequest.Any,
  EX = never,
  RX = never
> extends Omit<
    ResourceFamilyOptions<
      I,
      EffectRequest.Success<Req>,
      EffectRequest.Error<Req> | EX,
      EffectRequest.Services<Req> | RX
    >,
    "load"
  > {
  /** Builds the Effect Request for one resource input. */
  readonly request: (input: I) => Req;
  /** Resolver used by Effect.request, including its batching and deduping policy. */
  readonly resolver:
    | RequestResolver.RequestResolver<Req>
    | Effect.Effect<RequestResolver.RequestResolver<Req>, EX, RX>;
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
  readonly [ResourceTagIdentityTypeId]?: ResourceTagIdentity;
  readonly name: string;
  readonly key: string;
}

export type ResourceTagIdentity =
  | {
      readonly _tag: "Unkeyed";
      readonly name: string;
    }
  | {
      readonly _tag: "Keyed";
      readonly name: string;
      readonly key: string;
    };

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
export interface ResourceRef<I = unknown, A = unknown, E = never, R = never> {
  readonly [ResourceTypeId]: typeof ResourceTypeId;
  readonly family: ResourceFamily<I, A, E, R>;
  readonly input: I;
  readonly key: string;
}

export type AnyResourceFamily = ResourceFamily<any, any, any, any>;
export type AnyResourceRef<R = any> = ResourceRef<any, any, any, R>;
export type ResourceInvalidation<R = any> = AnyResourceRef<R> | ResourceTag;
export type ResourceInvalidationTarget<R = any> = ResourceInvalidation<R> | ReadonlyArray<ResourceInvalidation<R>>;
export type ResourceInvalidationCause =
  | { readonly _tag: "Ref"; readonly ref: AnyResourceRef<any> }
  | { readonly _tag: "Tag"; readonly tag: ResourceTag };

/** One resource ref selected by an invalidation target, with the reasons it matched. */
export interface ResourceInvalidationPlanEntry<R = any> {
  readonly ref: AnyResourceRef<R>;
  readonly causes: ReadonlyArray<ResourceInvalidationCause>;
}

export interface ResourceInvalidationPlan<R = any> {
  readonly targets: ReadonlyArray<ResourceInvalidation<R>>;
  readonly entries: ReadonlyArray<ResourceInvalidationPlanEntry<R>>;
}

/** Serializable success snapshot used to transfer loaded resources across boundaries. */
export interface ResourceHydrationSnapshot<I = unknown, A = unknown, E = never> {
  readonly name: string;
  readonly key: string;
  readonly input: I;
  readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>;
}

export interface ResourceHydrationPayload {
  readonly resources: ReadonlyArray<ResourceHydrationSnapshot>;
}

export type ResourceHydrationInput = ReadonlyArray<ResourceHydrationSnapshot> | ResourceHydrationPayload;

/** Resource load failures plus synchronous Resource callback failures. */
export type ResourceLoadError<E> = E | EffectInputCallbackError;

/** Effect-first read failures for a Resource ref whose value is unavailable. */
export type ResourceReadError<I, A, E = never, R = never> =
  | ResourcePending<I, A, E, R>
  | ResourceFailure<I, A, ResourceLoadError<E>, R, E>;

export interface ResourceHydrationOptions {
  /**
   * How to handle a snapshot whose family is not registered in the active
   * ResourceStore or global Resource definition registry. Defaults to fail.
   */
  readonly missingFamily?: "fail" | "skip";
  /**
   * How to handle a snapshot whose decoded input produces a different ref key
   * than the serialized key. Defaults to fail.
   */
  readonly keyMismatch?: "fail" | "skip";
}

interface ResourceStatusBase<I, A, E, R, RefError = E> {
  readonly ref: ResourceRef<I, A, RefError, R>;
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

export type ResourceStatus<I, A, E = never, R = never, RefError = E> =
  | (ResourceStatusBase<I, A, E, R, RefError> & {
      readonly _tag: "Initial";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Initial" }>;
      readonly value: undefined;
      readonly previous: undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R, RefError> & {
      readonly _tag: "Pending";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Pending" }>;
      readonly value: A | undefined;
      readonly previous: A | undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R, RefError> & {
      readonly _tag: "Success";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Success" }>;
      readonly value: A;
      readonly previous: undefined;
      readonly error: undefined;
    })
  | (ResourceStatusBase<I, A, E, R, RefError> & {
      readonly _tag: "Failure";
      readonly state: Extract<ResourceState<A, E>, { readonly _tag: "Failure" }>;
      readonly value: A | undefined;
      readonly previous: A | undefined;
      readonly error: E;
    });

const resourceKeyCallbackPromiseError = (
  operation: string,
  name: string
): ResourceKeyError =>
  new ResourceKeyError({
    operation,
    name,
    path: "$",
    reason: "PromiseLikeKey",
    cause: new EffectInputPromiseRejected({
      guidance: "Resource key callbacks must return strings synchronously. Move async key work before Resource ref/tag construction."
    }),
    guidance: "Resource key callbacks must return stable string keys synchronously. Promise-shaped keys would create unstable Resource identities."
  });

const customResourceKey = (
  operation: string,
  name: string,
  value: string
): string => {
  if (isPromiseLikeValue(value)) {
    throw resourceKeyCallbackPromiseError(operation, name);
  }

  return value;
};

/**
 * Runtime cache and state container for a set of resource refs.
 *
 * Most users create one through Resource.family and call the returned ref factory
 * instead of instantiating ResourceFamily directly.
 */
export class ResourceFamily<I, A, E = never, R = never> {
  constructor(readonly options: ResourceFamilyOptions<I, A, E, R>) {
    registerResourceDefinition(options.name, this as AnyResourceFamily);
  }

  /** Creates a stable ref for one input. */
  ref(input: I): ResourceRef<I, A, E, R> {
    const encodedKey = this.options.key === undefined
      ? encodeResourceKey(input, {
          operation: "Resource.family.ref",
          name: this.options.name
        })
      : customResourceKey("Resource.family.ref", this.options.name, this.options.key(input));
    const key = `${this.options.name}:${encodedKey}`;
    return {
      [ResourceTypeId]: ResourceTypeId,
      family: this,
      input,
      key
    };
  }
}

const makeResourceTag = (
  name: string,
  key: string,
  identity: ResourceTagIdentity
): ResourceTag => ({
  [ResourceTagTypeId]: ResourceTagTypeId,
  [ResourceTagIdentityTypeId]: identity,
  name,
  key
});

type CheckedResourceLoad<I, Definition> = Definition extends {
  readonly load: (input: I) => infer Out;
}
  ? { readonly load: (input: I) => EnsureEffectInput<Out> }
  : never;

type ResourceRefFactory<I, A, E = never, R = never> =
  ((input: I) => ResourceRef<I, A, E, R>) & { readonly family: ResourceFamily<I, A, E, R> };

type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;

type ResourceFamilyCommonOptions<I, A, E, R> =
  Omit<ResourceFamilyOptions<I, A, E, R>, "input" | "output" | "load">;

const makeResourceFamily = <I, A, E, R>(
  options: ResourceFamilyOptions<I, A, E, R>
): ResourceRefFactory<I, A, E, R> => {
  const family = new ResourceFamily(options);
  const makeRef = ((input: I) => family.ref(input)) as ResourceRefFactory<I, A, E, R>;

  Object.defineProperty(makeRef, "family", {
    value: family,
    enumerable: true
  });

  return makeRef;
};

/**
 * Resource helpers for cached Effect data, synchronous reads, invalidation, and hydration.
 */
export namespace Resource {
  export type Ref<I, A, E = never, R = never> = ResourceRef<I, A, E, R>;
  export type AnyRef<R = any> = AnyResourceRef<R>;
  export type State<A, E = never> = ResourceState<A, E>;
  export type Tag = ResourceTag;
  export type TagDefinition<Input> = ResourceTagDefinition<Input>;
  export type Invalidation<R = any> = ResourceInvalidation<R>;
  export type InvalidationTarget<R = any> = ResourceInvalidationTarget<R>;
  export type InvalidationCause = ResourceInvalidationCause;
  export type InvalidationPlanEntry<R = any> = ResourceInvalidationPlanEntry<R>;
  export type InvalidationPlan<R = any> = ResourceInvalidationPlan<R>;
  export type Snapshot<I = unknown, A = unknown, E = never> = ResourceHydrationSnapshot<I, A, E>;
  export type HydrationPayload = ResourceHydrationPayload;
  export type HydrationInput = ResourceHydrationInput;
  export type HydrationOptions = ResourceHydrationOptions;
  export type SnapshotCodecError = ResourceSnapshotCodecError;
  export type HydrationApplyError = ResourceHydrationApplyError;
  export type LoadError<E> = ResourceLoadError<E>;
  export type ReadError<I, A, E = never, R = never> = ResourceReadError<I, A, E, R>;
  export type Status<I, A, E = never, R = never, RefError = E> = ResourceStatus<I, A, E, R, RefError>;
  export type StoreEvent = ResourceStoreEvent;
  export type FamilyDiagnostics = ResourceFamilyDiagnostics;
  export type TagDiagnostics = ResourceTagDiagnostics;
  export type Diagnostics = ResourceDiagnostics;
  export type RequestFamilyOptions<I, Req extends EffectRequest.Any, EX = never, RX = never> =
    ResourceRequestFamilyOptions<I, Req, EX, RX>;
  /** Value returned from `collectEffect(...)` with the Resource refs touched by preload/read work. */
  export type Collected<A> = ResourceCollected<A>;

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
  export function family<
    const Input extends Schema.Top,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>
  >(
    options: ResourceFamilyCommonOptions<
      Schema.Schema.Type<Input>,
      Schema.Schema.Type<Output>,
      EffectInputError<Out>,
      EffectInputRequirements<Out>
    > & {
      readonly input: Input;
      readonly output: Output;
      readonly load: (input: Schema.Schema.Type<Input>) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>
  ): ResourceRefFactory<
    Schema.Schema.Type<Input>,
    Schema.Schema.Type<Output>,
    EffectInputError<Out>,
    EffectInputRequirements<Out>
  >;
  export function family<
    const Input extends Schema.Top,
    Out
  >(
    options: Omit<
      ResourceFamilyOptions<
        Schema.Schema.Type<Input>,
        EffectInputValue<Out>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "input" | "output" | "load"
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly load: (input: Schema.Schema.Type<Input>) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>
  ): ResourceRefFactory<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    EffectInputRequirements<Out>
  >;
  export function family<
    I,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>
  >(
    options: Omit<
      ResourceFamilyOptions<
        I,
        Schema.Schema.Type<Output>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "input" | "output" | "load"
    > & {
      readonly input?: never;
      readonly output: Output;
      readonly load: (input: I) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>
  ): ResourceRefFactory<
    I,
    Schema.Schema.Type<Output>,
    EffectInputError<Out>,
    EffectInputRequirements<Out>
  >;
  export function family<
    I,
    Out
  >(
    options: Omit<
      ResourceFamilyOptions<
        I,
        EffectInputValue<Out>,
        EffectInputError<Out>,
        EffectInputRequirements<Out>
      >,
      "output" | "load"
    > & {
      readonly output?: never;
      readonly load: (input: I) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>
  ): ResourceRefFactory<
    I,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    EffectInputRequirements<Out>
  >;
  export function family<
    I,
    A,
    E = never,
    R = never,
    Definition extends Omit<ResourceFamilyOptions<I, A, E, R>, "load"> & {
      readonly load: (input: I) => EffectInput<A, E, R>;
    } = Omit<ResourceFamilyOptions<I, A, E, R>, "load"> & {
      readonly load: (input: I) => EffectInput<A, E, R>;
    }
  >(
    options: Definition & CheckedResourceLoad<I, Definition>
  ): ResourceRefFactory<I, A, E, R>;
	  export function family(
	    options: unknown
	  ): any {
	    return makeResourceFamily(options as ResourceFamilyOptions<unknown, unknown, unknown, unknown>);
	  }

  /**
   * Defines a resource family backed by an Effect RequestResolver.
   *
   * This preserves the normal Resource cache/state lifecycle while letting Effect
   * batch sibling loads that are evaluated together, e.g. during route preloads.
   */
  export const requestFamily = <
    I,
    Req extends EffectRequest.Any,
    EX = never,
    RX = never
  >(
    options: ResourceRequestFamilyOptions<I, Req, EX, RX>
  ): ((input: I) => ResourceRef<
    I,
    EffectRequest.Success<Req>,
    EffectRequest.Error<Req> | EX,
    EffectRequest.Services<Req> | RX
  >) & {
    readonly family: ResourceFamily<
      I,
      EffectRequest.Success<Req>,
      EffectRequest.Error<Req> | EX,
      EffectRequest.Services<Req> | RX
    >;
  } => {
    const { request, resolver, ...familyOptions } = options;
    return family({
      ...familyOptions,
      load: (input: I) =>
        Effect.request(request(input), resolver) as never
    }) as ResourceRefFactory<
      I,
      EffectRequest.Success<Req>,
      EffectRequest.Error<Req> | EX,
      EffectRequest.Services<Req> | RX
    >;
  };

  const makeTagDefinition = <Input>(
    name: string,
    options: { readonly key?: (input: Input) => string } = {}
  ): ResourceTagDefinition<Input> => {
    const keyFor = options.key ?? ((input: Input) =>
      encodeResourceKey(input, {
        operation: "Resource.tag",
        name
      }));
    const make = ((input: Input) => {
      const key = customResourceKey("Resource.tag", name, keyFor(input));
      return makeResourceTag(name, `${name}:${key}`, {
        _tag: "Keyed",
        name,
        key
      });
    }) as ResourceTagDefinition<Input>;

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
    registerResourceTagDefinition(name, {
      name,
      keyed: options !== undefined
    });
    return options === undefined
      ? makeResourceTag(name, name, {
          _tag: "Unkeyed",
          name
        })
      : makeTagDefinition(name, options);
  }

  export const definitions = (): ReadonlyMap<string, AnyResourceFamily> =>
    resourceDefinitionRegistry();

  /** Resolves a Resource family by name, preferring the active Resource Store. */
  export const definitionEffect = (
    name: string
  ): Effect.Effect<AnyResourceFamily | undefined> =>
    lookupResourceFamilyEffect(name);

  export const tagDefinitions = (): ReadonlyMap<string, ResourceTagDiagnostics> =>
    resourceTagDefinitionRegistry();

  export const diagnostics = (): ResourceDiagnostics =>
    resourceDiagnostics();

  /** Registry diagnostics, including duplicate resource family/tag registrations. */
  export const registryDiagnostics = resourceRegistryDiagnostics;

  export const refsForTag = (tag: ResourceTag): ReadonlyArray<AnyResourceRef<any>> =>
    refsForResourceTag(tag);

  /** Computes which cached refs would be affected by a ref or tag invalidation. */
  export const planInvalidation = <R = never>(target: ResourceInvalidationTarget<R>): ResourceInvalidationPlan<R> =>
    planResourceInvalidation(target);

  /** Effect version of planInvalidation that uses the ResourceStore in context. */
  export const planInvalidationEffect = <R = never>(
    target: ResourceInvalidationTarget<R>
  ): Effect.Effect<ResourceInvalidationPlan<R>> =>
    planResourceInvalidationEffect(target);

  export const subscribeEventsEffect = subscribeResourceEventsEffect;

  export const result = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): ReadableSignal<ResourceState<A, ResourceLoadError<E>>> =>
    resourceResult(ref);

  /**
   * Synchronous render/host-adapter seam for inspecting a resource ref without
   * starting a load.
   *
   * Effect workflows should prefer statusEffect so the active ResourceStore and
   * Clock come from Effect context.
   */
  export const status = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): ResourceStatus<I, A, ResourceLoadError<E>, R, E> =>
    resourceStatus(ref);

  /**
   * Effect-first status inspection that reads the ResourceStore and Clock from
   * Effect context.
   */
  export const statusEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<ResourceStatus<I, A, ResourceLoadError<E>, R, E>> =>
    resourceStatusEffect(ref);

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

  /**
   * Forces a resource ref to reload as an Effect and updates cache state.
   *
   * Prefer this inside route preloads, actions, and other Effect workflows.
   */
  export const refreshEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E>, R> =>
    refreshResourceEffect(ref);
  /**
   * Ensures a resource ref is loaded as an Effect, reusing fresh cached data.
   *
   * This records the ref for route preload collection and shares in-flight work.
   */
  export const prefetchEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<A, ResourceLoadError<E>, R> =>
    prefetchResourceEffect(ref);

  /**
   * Deletes a resource ref from the active Resource Store.
   *
   * This interrupts GC and in-flight load work for the ref, removes dependency
   * graph facts, invalidates its Effect cache entry, and publishes
   * `ResourceDeleted`.
   */
  export const deleteEffect = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<void> =>
    deleteResourceEffect(ref);

  /** Runs an Effect and returns the resource refs it touched through prefetch/refresh. */
  export const collectEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<Collected<A>, E, R> =>
    collectResourceEffect(effect);

  /**
   * Synchronous render/host-adapter seam for reading a resource value after
   * Effect preload.
   *
   * If the value is missing or the entry has expired it throws ResourcePending.
   * If loading failed it throws ResourceFailure. Stale values are returned
   * immediately while refresh runs in the background. Effect workflows should
   * prefer readEffect so failures stay in the Effect error channel and runtime
   * state comes from Effect context.
   */
  export const read = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): A => {
    return readResource(ref);
  };

  /**
   * Effect-first read for an already-loaded resource value.
   *
   * Missing, pending, collected, and failed states are reported as typed Effect
   * failures instead of thrown render-control values.
   */
  export const readEffect = <I, A, E, R>(
    ref: ResourceRef<I, A, E, R>
  ): Effect.Effect<A, ResourceReadError<I, A, E, R>, R> =>
    readResourceEffect(ref);

  /**
   * Invalidates refs or tags and refreshes affected resources as an Effect.
   */
  export const invalidateEffect = <R = never>(
    target: ResourceInvalidationTarget<R>
  ): Effect.Effect<void, never, R> =>
    invalidateResourceEffect(target);

  /** Runs a previously computed invalidation plan as an Effect. */
  export const runInvalidationPlanEffect = <R = never>(
    plan: ResourceInvalidationPlan<R>
  ): Effect.Effect<void, never, R> =>
    runResourceInvalidationPlanEffect(plan);

  /** Fire-and-forget runtime boundary for invalidateEffect. */
  export const invalidate = (
    target: ResourceInvalidationTarget
  ): void => {
    invalidateResource(target);
  };

  /** Fire-and-forget runtime boundary for runInvalidationPlanEffect. */
  export const runInvalidationPlan = (
    plan: ResourceInvalidationPlan
  ): void => {
    runResourceInvalidationPlan(plan);
  };

  /** Serializes successful resource refs from the current store for hydration. */
  export const dehydrate = (
    refs: Iterable<AnyResourceRef<any>>
  ): ReadonlyArray<ResourceHydrationSnapshot> =>
    dehydrateResources(refs);

  /** Effect version of dehydrate that reads the ResourceStore from context. */
  export const dehydrateEffect = (
    refs: Iterable<AnyResourceRef<any>>
  ): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>, ResourceSnapshotCodecError> =>
    dehydrateResourcesEffect(refs);

  /** Wraps dehydrated snapshots in the payload shape used by route plans. */
  export const hydrationPayload = (refs: Iterable<AnyResourceRef<any>>): ResourceHydrationPayload =>
    resourceHydrationPayload(refs);

  /** Effect version of hydrationPayload. */
  export const hydrationPayloadEffect = (
    refs: Iterable<AnyResourceRef<any>>
  ): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
    resourceHydrationPayloadEffect(refs);

  /** Encodes a validated hydration payload as JSON. */
  export const encodeHydrationPayloadEffect = (
    payload: ResourceHydrationPayload
  ): Effect.Effect<string, ResourceSnapshotCodecError> =>
    encodeResourceHydrationPayloadEffect(payload);

  /** Decodes and validates a hydration payload from JSON. */
  export const decodeHydrationPayloadEffect = (
    encoded: string
  ): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
    decodeResourceHydrationPayloadEffect(encoded);

  /**
   * Restores successful resource snapshots into the current ResourceStore.
   *
   * Unknown families and key mismatches fail by default with
   * ResourceHydrationApplyError. Pass an explicit skip policy when a caller
   * intentionally hydrates a partial payload.
   */
  export const hydrateEffect = (
    input: ResourceHydrationInput,
    options?: ResourceHydrationOptions
  ): Effect.Effect<void, ResourceSnapshotCodecError | ResourceHydrationApplyError | EffectInputCallbackError> =>
    hydrateResourcesEffect(input, options);

  /** Synchronous runtime boundary for hydrateEffect. */
  export const hydrate = (
    input: ResourceHydrationInput,
    options?: ResourceHydrationOptions
  ): void => {
    hydrateResources(input, options);
  };
}
