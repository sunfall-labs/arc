import {
  Effect,
  Request as EffectRequest,
  RequestResolver,
  Schema,
  type Schedule,
  type Stream,
} from "effect";
import type { AsyncResult } from "effect/reactivity";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput,
} from "./effect-like.js";
import { EffectInputPromiseRejected } from "./effect-like.js";
import { isEffectLikeValue, isPromiseLikeValue } from "./effect-input-sync.js";
import type { DurationInput } from "./resource-duration.js";
import {
  ResourceKeyError,
  type ResourceFailure,
  type ResourcePending,
  type ResourceUntypedFailure,
} from "./resource-errors.js";
import {
  ResourceTagIdentityTypeId,
  ResourceTagTypeId,
  ResourceTypeId,
} from "./resource-identifiers.js";
import type { ResourceStoreEvent } from "./resource-store.js";
import type { ReadableSignal } from "./signal.js";
import { encodeResourceKey } from "./resource-key-codec.js";
import type { ResourceCollected } from "./resource-collector.js";
import {
  decodeResourceHydrationPayloadEffect,
  encodeResourceHydrationPayloadEffect,
  ResourceHydrationApplyError,
  type ResourceSnapshotCodecError,
} from "./resource-snapshot-codec.js";
import {
  registerResourceDefinition,
  registerResourceTagDefinition,
  resourceDiagnostics,
} from "./resource-registry.js";
import {
  collectResourceEffect,
  dehydrateResourcesEffect,
  deleteResourceEffect,
  hydrateResourcesEffect,
  invalidateResourceEffect,
  planResourceInvalidationEffect,
  prefetchResourceEffect,
  readResourceEffect,
  refreshResourceEffect,
  resourceHydrationPayloadEffect,
  resourceChangesStream,
  resourceResult,
  resourceStatusEffect,
  runResourceInvalidationPlanEffect,
  subscribeResourceEventsEffect,
} from "./resource-runtime.js";

export { isResourceRef, isResourceTag } from "./resource-dependency-graph.js";
export { UnsupportedDuration } from "./resource-duration.js";
export type { DurationInput } from "./resource-duration.js";
export {
  ResourceTagIdentityTypeId,
  ResourceTagTypeId,
  ResourceTypeId,
} from "./resource-identifiers.js";
export {
  MissingResourceInput,
  ResourceFailure,
  ResourceFailureCodecError,
  ResourceKeyError,
  ResourcePending,
  ResourceUntypedFailure,
} from "./resource-errors.js";

/** Cache lifecycle policy for a resource family. */
export interface ResourcePolicy<E = never> {
  /** How long a successful value is considered fresh before reads trigger refresh. */
  readonly staleFor?: DurationInput;
  /** How long a successful value remains cached before it can be collected. */
  readonly gcFor?: DurationInput;
  /**
   * Retry schedule applied to the family load Effect; it observes the load's
   * errors (`E`). The input is typed `any` because a Schedule's input is
   * contravariant: a precise `E` would stop never-failing families from being
   * assignable to erased `AnyResourceFamily`/`AnyResourceRef`.
   */
  readonly retry?: RetrySchedule<E>;
}

/** Retry schedule observing errors of type `E`; see `ResourcePolicy.retry`. */
// oxlint-disable-next-line no-unused-vars -- `E` documents what the schedule observes.
export type RetrySchedule<E> = Schedule.Schedule<unknown, any>;

/**
 * Schema for a Resource family's typed load failure, like a route's `error`.
 *
 * A server render that shows a failed Resource read encodes the failure with
 * this schema (as JSON) and the hydrating client decodes it back into the same
 * typed value, so both renders show the real failure with its declared
 * fields. Encoding and decoding run synchronously, so the schema cannot
 * require services.
 */
export type ResourceErrorSchema<E = unknown> = Schema.Codec<E, unknown, never, never>;

type IsUndefined<T> = [T] extends [undefined] ? true : false;
type ErrorSchemaType<S> = S extends { readonly Type: infer A } ? A : never;

/** Declared load error of a family: its `error` schema's type, else the load's inferred error. */
type ResourceDeclaredError<ErrorSchema, LoadError> =
  IsUndefined<ErrorSchema> extends true ? LoadError : ErrorSchemaType<ErrorSchema>;

/**
 * Render failure of a family's reads: its `error` schema's type when one is
 * declared, `ResourceUntypedFailure` when the load can fail without one, and
 * `never` when it cannot fail.
 */
type ResourceRenderErrorFor<ErrorSchema, LoadError> =
  IsUndefined<ErrorSchema> extends true
    ? [LoadError] extends [never]
      ? never
      : ResourceUntypedFailure
    : ErrorSchemaType<ErrorSchema>;

/**
 * Readable type error: the Resource load can fail with `Undeclared`, which
 * the family's `error` schema does not cover. Widen the schema (e.g.
 * `Schema.Union([...])`) or handle those failures in `load`.
 */
export interface ResourceLoadFailureNotInErrorSchema<Undeclared> {
  readonly "~resource-error": "This Resource's load can fail with errors its `error` schema does not declare";
  readonly undeclared: Undeclared;
}

type ResourceErrorSchemaCheck<ErrorSchema, LoadError> =
  IsUndefined<ErrorSchema> extends true
    ? unknown
    : [LoadError] extends [ErrorSchemaType<ErrorSchema>]
      ? unknown
      : {
          readonly error: ResourceLoadFailureNotInErrorSchema<
            Exclude<LoadError, ErrorSchemaType<ErrorSchema>>
          >;
        };

/** The `error` option every `Resource.define` overload takes, with its coverage check. */
type ResourceErrorOption<ErrorSchema, LoadError> = {
  /**
   * Optional schema for the typed load failure. When present, `load` may fail
   * only with this schema's type, the family's error is that type, and a
   * server render sends a failed read to the client encoded with it. Without
   * it a failed read renders as `ResourceUntypedFailure` (its `_tag` only).
   */
  readonly error?: ErrorSchema;
} & ResourceErrorSchemaCheck<ErrorSchema, LoadError>;

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
  /** Optional schema for the typed load failure; see `ResourceErrorSchema`. */
  readonly error?: ResourceErrorSchema<any>;
  readonly policy?: ResourcePolicy<E>;
  /** Optional stable key override. Defaults to a stable stringify of the input. */
  readonly key?: (input: I) => string;
  /**
   * Loads one value. May return a plain value or an Effect.
   *
   * Direct Effect values are interpreted as work. If the domain value itself is
   * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
   * Interface as data.
   */
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
  RX = never,
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

/** Stable invalidation tag attached to Resource refs through `Resource.tag(...)`. */
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

/** Callable tag definition that creates keyed or unkeyed Resource invalidation tags. */
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
export type ResourceInvalidationTarget<R = any> =
  | ResourceInvalidation<R>
  | ReadonlyArray<ResourceInvalidation<R>>;
/**
 * One Resource ref or an array of refs: the target shape of `Resource.preload`
 * and `Resource.refresh`, matching `Resource.invalidate`'s ref-or-array target.
 */
type ResourceRefTarget = AnyResourceRef | ReadonlyArray<AnyResourceRef>;
type ResourceRefValue<Ref> = Ref extends ResourceRef<any, infer A, any, any> ? A : never;
type ResourceRefError<Ref> = Ref extends ResourceRef<any, any, infer E, any> ? E : never;
type ResourceRefRequirements<Ref> = Ref extends ResourceRef<any, any, any, infer R> ? R : never;
/** Loaded value(s) of a `ResourceRefTarget`: one value, or a tuple of values in order. */
type ResourceRefTargetValue<Target> =
  Target extends ReadonlyArray<unknown>
    ? { -readonly [K in keyof Target]: ResourceRefValue<Target[K]> }
    : ResourceRefValue<Target>;
/** Union of the declared load errors of a `ResourceRefTarget`. */
type ResourceRefTargetError<Target> =
  Target extends ReadonlyArray<infer Ref> ? ResourceRefError<Ref> : ResourceRefError<Target>;
/** Union of the load services of a `ResourceRefTarget`. */
type ResourceRefTargetRequirements<Target> =
  Target extends ReadonlyArray<infer Ref>
    ? ResourceRefRequirements<Ref>
    : ResourceRefRequirements<Target>;
export type ResourceInvalidationCause =
  | { readonly _tag: "Ref"; readonly ref: AnyResourceRef<any> }
  | { readonly _tag: "Tag"; readonly tag: ResourceTag };

/** One resource ref selected by an invalidation target, with the reasons it matched. */
export interface ResourceInvalidationPlanEntry<R = any> {
  readonly ref: AnyResourceRef<R>;
  readonly causes: ReadonlyArray<ResourceInvalidationCause>;
}

/** Resolved invalidation plan listing targets and loaded refs matched by those targets. */
export interface ResourceInvalidationPlan<R = any> {
  readonly targets: ReadonlyArray<ResourceInvalidation<R>>;
  readonly entries: ReadonlyArray<ResourceInvalidationPlanEntry<R>>;
}

/**
 * Wire form of a hydrated Resource result: the `AsyncResult.Schema` JSON
 * encoding of a settled `Success`, with `value` encoded through the family's
 * `output` schema when one exists.
 */
export interface ResourceHydrationSuccessState<A = unknown> {
  readonly _tag: "Success";
  readonly value: A;
  readonly waiting: false;
  readonly timestamp: number;
}

/**
 * Serializable success snapshot used to transfer loaded resources across boundaries.
 *
 * Arc's envelope (`name`, `key`, `input`) identifies the ref; `state` is the
 * `AsyncResult` Success encoding. Hydration is Success-only: failures can carry
 * server-only causes and are never serialized.
 */
export interface ResourceHydrationSnapshot<I = unknown, A = unknown> {
  readonly name: string;
  readonly key: string;
  readonly input: I;
  readonly state: ResourceHydrationSuccessState<A>;
}

/**
 * Payload object accepted by `Resource.hydrate(...)`.
 *
 * Resource hydration APIs intentionally accept this wrapper shape only; raw
 * snapshot arrays must be wrapped as `{ resources: snapshots }`. Use
 * `Resource.hydrationPayload(...)` when creating a payload from loaded
 * Resource refs.
 */
export interface ResourceHydrationPayload {
  /** Successful Resource snapshots to restore into the active Resource Store. */
  readonly resources: ReadonlyArray<ResourceHydrationSnapshot>;
}

/** Effect-first read failures for a Resource ref whose value is unavailable. */
export type ResourceReadError<I, A, E = never, R = never> =
  | ResourcePending<I, A, E, R>
  | ResourceFailure<I, A, E, R, E>;

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
  /**
   * How to timestamp hydrated success snapshots. `preserve` keeps the snapshot
   * timestamp, while `now` treats the active hydration pass as the freshness
   * boundary.
   */
  readonly timestamp?: "preserve" | "now";
  /**
   * Skip applying snapshots for refs that are already successful, fresh, and
   * not garbage-collection expired. This lets target-page hydration warm
   * missing data without replacing equivalent fresh data already on screen.
   */
  readonly skipFresh?: boolean;
}

/**
 * Computed Resource read status used by adapters, devtools, and diagnostics.
 *
 * `result` is the ref's `AsyncResult`; the remaining fields are the cache
 * policy facts `AsyncResult` does not know about. Freshness deadlines derive
 * from the `Success` timestamp only.
 */
export interface ResourceStatus<I, A, E = never, R = never, RefError = E> {
  readonly ref: ResourceRef<I, A, RefError, R>;
  readonly name: string;
  readonly key: string;
  readonly input: I;
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly isStale: boolean;
  readonly isGcExpired: boolean;
  readonly staleAt: number | undefined;
  readonly gcAt: number | undefined;
  readonly ageMillis: number | undefined;
  readonly staleInMillis: number | undefined;
  readonly gcInMillis: number | undefined;
}

const resourceKeyCallbackPromiseError = (operation: string, name: string): ResourceKeyError =>
  new ResourceKeyError({
    operation,
    name,
    path: "$",
    reason: "PromiseLikeKey",
    cause: new EffectInputPromiseRejected({
      guidance:
        "Resource key callbacks must return strings synchronously. Move async key work before Resource ref/tag construction.",
    }),
    guidance:
      "Resource key callbacks must return stable string keys synchronously. Promise-shaped keys would create unstable Resource identities.",
  });

const resourceKeyCallbackEffectError = (operation: string, name: string): ResourceKeyError =>
  new ResourceKeyError({
    operation,
    name,
    path: "$",
    reason: "EffectLikeKey",
    cause: new TypeError("Resource key callbacks must return strings, not Effect values."),
    guidance:
      "Resource key callbacks must return stable string keys synchronously. Use Effects before Resource ref/tag construction when identity requires executable work.",
  });

const resourceKeyCallbackNonStringError = (
  operation: string,
  name: string,
  value: unknown,
): ResourceKeyError =>
  new ResourceKeyError({
    operation,
    name,
    path: "$",
    reason: "NonStringKey",
    cause: value,
    guidance:
      "Resource key callbacks must return stable string keys. Return a string explicitly instead of relying on implicit coercion.",
  });

const customResourceKey = (operation: string, name: string, value: unknown): string => {
  if (isPromiseLikeValue(value)) {
    throw resourceKeyCallbackPromiseError(operation, name);
  }
  if (isEffectLikeValue(value)) {
    throw resourceKeyCallbackEffectError(operation, name);
  }
  if (typeof value !== "string") {
    throw resourceKeyCallbackNonStringError(operation, name, value);
  }

  return value;
};

/**
 * Resource family definition and stable ref factory.
 *
 * The family owns resource identity, key encoding, loader policy, and static
 * metadata. Cache state, hydration snapshots, and request/runtime lifetime live
 * in the active `ResourceStore`, not on the family itself. Most users create a
 * family through `Resource.define(...)` and call the returned ref factory.
 */
export class ResourceFamily<I, A, E = never, R = never> {
  constructor(readonly options: ResourceFamilyOptions<I, A, E, R>) {
    registerResourceDefinition(options.name, this as AnyResourceFamily);
  }

  /** Creates a stable ref for one input. */
  ref(input: I): ResourceRef<I, A, E, R> {
    const encodedKey =
      this.options.key === undefined
        ? encodeResourceKey(input, {
            operation: "Resource.define.ref",
            name: this.options.name,
          })
        : customResourceKey("Resource.define.ref", this.options.name, this.options.key(input));
    const key = `${this.options.name}:${encodedKey}`;
    return {
      [ResourceTypeId]: ResourceTypeId,
      family: this,
      input,
      key,
    };
  }
}

const makeResourceTag = (
  name: string,
  key: string,
  identity: ResourceTagIdentity,
): ResourceTag => ({
  [ResourceTagTypeId]: ResourceTagTypeId,
  [ResourceTagIdentityTypeId]: identity,
  name,
  key,
});

type CheckedResourceLoad<I, Definition> = Definition extends {
  readonly load: (input: I) => infer Out;
}
  ? { readonly load: (input: I) => EnsureEffectInput<Out> }
  : never;

/**
 * Ref factory returned by `Resource.define(...)`: call it with an input to get
 * a ref. `RenderError` is the failure a render of its reads reports (see
 * `Resource.RenderError`).
 */
export type ResourceRefFactory<
  I,
  A,
  E = never,
  R = never,
  RenderError = [E] extends [never] ? never : ResourceUntypedFailure,
> = ((input: I) => ResourceRef<I, A, E, R>) & {
  readonly family: ResourceFamily<I, A, E, R>;
  /** Phantom: the failure a render of this family's reads reports. */
  readonly "~renderError"?: (_: never) => RenderError;
};

type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;

type ResourceFamilyCommonOptions<I, A, E, R> = Omit<
  ResourceFamilyOptions<I, A, E, R>,
  "input" | "output" | "load" | "error"
>;

const makeResourceFamily = <I, A, E, R>(
  options: ResourceFamilyOptions<I, A, E, R>,
): ResourceRefFactory<I, A, E, R, unknown> => {
  const family = new ResourceFamily(options);
  const makeRef = ((input: I) => family.ref(input)) as ResourceRefFactory<I, A, E, R, unknown>;

  Object.defineProperty(makeRef, "family", {
    value: family,
    enumerable: true,
  });

  return makeRef;
};

const isRequestFamilyOptions = (
  options: unknown,
): options is ResourceRequestFamilyOptions<unknown, EffectRequest.Any, unknown, unknown> =>
  typeof options === "object" && options !== null && "request" in options && "resolver" in options;

/**
 * Resource helpers for cached Effect data, synchronous reads, invalidation, and hydration.
 */
export namespace Resource {
  /** Typed reference to one cached Resource input/value pair. */
  export type Ref<I, A, E = never, R = never> = ResourceRef<I, A, E, R>;
  /** Erased Resource ref used by diagnostics, invalidation, and collection helpers. */
  export type AnyRef<R = any> = AnyResourceRef<R>;
  /** Invalidation tag emitted by Resources and consumed by Actions. */
  export type Tag = ResourceTag;
  /** Callable tag factory created with `Resource.tag(...)`. */
  export type TagDefinition<Input> = ResourceTagDefinition<Input>;
  /** Resource ref or tag target that an Action can invalidate. */
  export type Invalidation<R = any> = ResourceInvalidation<R>;
  /** Concrete Resource invalidation target after tag/ref normalization. */
  export type InvalidationTarget<R = any> = ResourceInvalidationTarget<R>;
  /** Source metadata explaining why a Resource invalidation occurred. */
  export type InvalidationCause = ResourceInvalidationCause;
  /** One planned invalidation target plus its cause. */
  export type InvalidationPlanEntry<R = any> = ResourceInvalidationPlanEntry<R>;
  /** Complete invalidation plan produced from Resource refs and tags. */
  export type InvalidationPlan<R = any> = ResourceInvalidationPlan<R>;
  /** Serializable snapshot for one Resource ref. */
  export type Snapshot<I = unknown, A = unknown> = ResourceHydrationSnapshot<I, A>;
  /** Serializable collection of Resource snapshots for hydration. */
  export type HydrationPayload = ResourceHydrationPayload;
  /** Options that control Resource hydration replacement and failure behavior. */
  export type HydrationOptions = ResourceHydrationOptions;
  /** Typed error raised when Resource hydration payloads cannot be decoded. */
  export type SnapshotCodecError = ResourceSnapshotCodecError;
  /** Typed error raised when a decoded Resource hydration payload cannot apply. */
  export type HydrationApplyError = ResourceHydrationApplyError;
  /** Error thrown by synchronous Resource reads when data is pending or failed. */
  export type ReadError<I, A, E = never, R = never> = ResourceReadError<I, A, E, R>;
  /** Diagnostic status for one Resource ref: its `AsyncResult` plus cache freshness facts. */
  export type Status<I, A, E = never, R = never, RefError = E> = ResourceStatus<
    I,
    A,
    E,
    R,
    RefError
  >;
  /** Resource store lifecycle event used by devtools and tests. */
  export type StoreEvent = ResourceStoreEvent;
  /** Diagnostics for one registered Resource family. */
  export type FamilyDiagnostics = ResourceFamilyDiagnostics;
  /** Diagnostics for one registered Resource tag. */
  export type TagDiagnostics = ResourceTagDiagnostics;
  /** Complete Resource registry/cache diagnostics snapshot. */
  export type Diagnostics = ResourceDiagnostics;
  /** Options for defining a Resource family backed by an Effect RequestResolver. */
  export type RequestFamilyOptions<
    I,
    Req extends EffectRequest.Any,
    EX = never,
    RX = never,
  > = ResourceRequestFamilyOptions<I, Req, EX, RX>;
  /** Value returned from `collect(...)` with the Resource refs touched by preload/read work. */
  export type Collected<A> = ResourceCollected<A>;
  /** Schema for a family's typed load failure (the `error` option). */
  export type ErrorSchema<E = unknown> = ResourceErrorSchema<E>;
  /** Ref factory returned by `Resource.define(...)`. */
  export type RefFactory<
    I,
    A,
    E = never,
    R = never,
    RenderError = [E] extends [never] ? never : ResourceUntypedFailure,
  > = ResourceRefFactory<I, A, E, R, RenderError>;
  /**
   * Failure a render of a family's reads reports: its `error` schema's type,
   * `ResourceUntypedFailure` for a family that can fail without one, `never`
   * when it cannot fail.
   */
  export type RenderError<F> =
    F extends ResourceRefFactory<any, any, any, any, infer RenderError> ? RenderError : never;

  /**
   * Defines a resource family and returns a ref factory.
   *
   * Call the returned function with input to create Resource refs, then use
   * `preload`, `refresh`, or `read` to load and consume values. A family loads
   * through `load`, or, given `request` and `resolver` instead, through an
   * Effect `RequestResolver`, which batches and dedupes sibling loads that run
   * together (for example during route preloads) under the same cache and
   * state lifecycle.
   *
   * @example
   * ```ts
   * const User = Resource.define({
   *   name: "User",
   *   load: ({ id }: { id: string }) => ServerGetUser.effect({ id })
   * });
   *
   * const ref = User({ id: "42" });
   * const user = yield* Resource.preload(ref);
   * ```
   */
  export function define<
    I,
    Req extends EffectRequest.Any,
    EX = never,
    RX = never,
    ErrorSchema extends ResourceErrorSchema<any> | undefined = undefined,
  >(
    options: Omit<ResourceRequestFamilyOptions<I, Req, EX, RX>, "error"> &
      ResourceErrorOption<ErrorSchema, EffectRequest.Error<Req> | EX>,
  ): ResourceRefFactory<
    I,
    EffectRequest.Success<Req>,
    ResourceDeclaredError<ErrorSchema, EffectRequest.Error<Req> | EX>,
    EffectRequest.Services<Req> | RX,
    ResourceRenderErrorFor<ErrorSchema, EffectRequest.Error<Req> | EX>
  >;
  export function define<
    const Input extends Schema.Top,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    ErrorSchema extends ResourceErrorSchema<any> | undefined = undefined,
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
    } & ResourceErrorOption<ErrorSchema, EffectInputError<Out>> &
      RejectPromiseEffectInput<Out>,
  ): ResourceRefFactory<
    Schema.Schema.Type<Input>,
    Schema.Schema.Type<Output>,
    ResourceDeclaredError<ErrorSchema, EffectInputError<Out>>,
    EffectInputRequirements<Out>,
    ResourceRenderErrorFor<ErrorSchema, EffectInputError<Out>>
  >;
  export function define<
    const Input extends Schema.Top,
    Load extends (input: Schema.Schema.Type<Input>) => unknown,
    ErrorSchema extends ResourceErrorSchema<any> | undefined = undefined,
  >(
    options: ResourceFamilyCommonOptions<
      Schema.Schema.Type<Input>,
      EffectInputValue<ReturnType<Load>>,
      EffectInputError<ReturnType<Load>>,
      EffectInputRequirements<ReturnType<Load>>
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly load: Load &
        ((input: Schema.Schema.Type<Input>) => EnsureEffectInput<ReturnType<Load>>);
    } & ResourceErrorOption<ErrorSchema, EffectInputError<ReturnType<Load>>> &
      RejectPromiseEffectInput<ReturnType<Load>>,
  ): ResourceRefFactory<
    Schema.Schema.Type<Input>,
    EffectInputValue<ReturnType<Load>>,
    ResourceDeclaredError<ErrorSchema, EffectInputError<ReturnType<Load>>>,
    EffectInputRequirements<ReturnType<Load>>,
    ResourceRenderErrorFor<ErrorSchema, EffectInputError<ReturnType<Load>>>
  >;
  export function define<
    I,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    ErrorSchema extends ResourceErrorSchema<any> | undefined = undefined,
  >(
    options: ResourceFamilyCommonOptions<
      I,
      Schema.Schema.Type<Output>,
      EffectInputError<Out>,
      EffectInputRequirements<Out>
    > & {
      readonly input?: never;
      readonly output: Output;
      readonly load: (input: I) => EnsureEffectInput<Out>;
    } & ResourceErrorOption<ErrorSchema, EffectInputError<Out>> &
      RejectPromiseEffectInput<Out>,
  ): ResourceRefFactory<
    I,
    Schema.Schema.Type<Output>,
    ResourceDeclaredError<ErrorSchema, EffectInputError<Out>>,
    EffectInputRequirements<Out>,
    ResourceRenderErrorFor<ErrorSchema, EffectInputError<Out>>
  >;
  export function define<
    I,
    A,
    E = never,
    R = never,
    Definition extends Omit<ResourceFamilyOptions<I, A, E, R>, "load" | "error"> & {
      readonly error?: ResourceErrorSchema<E>;
      readonly load: (input: I) => EffectInput<A, E, R>;
    } = Omit<ResourceFamilyOptions<I, A, E, R>, "load" | "error"> & {
      readonly error?: ResourceErrorSchema<E>;
      readonly load: (input: I) => EffectInput<A, E, R>;
    },
  >(
    options: Definition & CheckedResourceLoad<I, Definition>,
  ): ResourceRefFactory<
    I,
    A,
    E,
    R,
    ResourceRenderErrorFor<Definition extends { readonly error: infer S } ? S : undefined, E>
  >;
  export function define<
    I,
    Load extends (input: I) => unknown,
    ErrorSchema extends ResourceErrorSchema<any> | undefined = undefined,
  >(
    options: Omit<
      ResourceFamilyOptions<
        I,
        EffectInputValue<ReturnType<Load>>,
        EffectInputError<ReturnType<Load>>,
        EffectInputRequirements<ReturnType<Load>>
      >,
      "output" | "load" | "error"
    > & {
      readonly output?: never;
      readonly load: Load & ((input: I) => EnsureEffectInput<ReturnType<Load>>);
    } & ResourceErrorOption<ErrorSchema, EffectInputError<ReturnType<Load>>> &
      RejectPromiseEffectInput<ReturnType<Load>>,
  ): ResourceRefFactory<
    I,
    EffectInputValue<ReturnType<Load>>,
    ResourceDeclaredError<ErrorSchema, EffectInputError<ReturnType<Load>>>,
    EffectInputRequirements<ReturnType<Load>>,
    ResourceRenderErrorFor<ErrorSchema, EffectInputError<ReturnType<Load>>>
  >;
  export function define(options: unknown): any {
    if (isRequestFamilyOptions(options)) {
      const { request, resolver, ...familyOptions } = options;
      return makeResourceFamily({
        ...familyOptions,
        load: (input: unknown) => Effect.request(request(input), resolver as never),
      });
    }
    return makeResourceFamily(options as ResourceFamilyOptions<unknown, unknown, unknown, unknown>);
  }

  const makeTagDefinition = <Input>(
    name: string,
    options: { readonly key?: (input: Input) => string } = {},
  ): ResourceTagDefinition<Input> => {
    const keyFor =
      options.key ??
      ((input: Input) =>
        encodeResourceKey(input, {
          operation: "Resource.tag",
          name,
        }));
    const make = ((input: Input) => {
      const key = customResourceKey("Resource.tag", name, keyFor(input));
      return makeResourceTag(name, `${name}:${key}`, {
        _tag: "Keyed",
        name,
        key,
      });
    }) as ResourceTagDefinition<Input>;

    Object.defineProperties(make, {
      [ResourceTagTypeId]: {
        value: ResourceTagTypeId,
        enumerable: false,
      },
      name: {
        value: name,
        configurable: true,
        enumerable: true,
      },
      ref: {
        value: make,
        enumerable: true,
      },
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
    options: { readonly key?: (input: Input) => string },
  ): ResourceTagDefinition<Input>;
  export function tag<Input>(
    name: string,
    options?: { readonly key?: (input: Input) => string },
  ): ResourceTag | ResourceTagDefinition<Input> {
    registerResourceTagDefinition(name, {
      name,
      keyed: options !== undefined,
    });
    return options === undefined
      ? makeResourceTag(name, name, {
          _tag: "Unkeyed",
          name,
        })
      : makeTagDefinition(name, options);
  }

  /** Resource registry/cache diagnostics for devtools and adapter health checks. */
  export const diagnostics = (): ResourceDiagnostics => resourceDiagnostics();

  /** Computes which cached refs would be affected by a ref or tag invalidation. */
  export const planInvalidation = <R = never>(
    target: ResourceInvalidationTarget<R>,
  ): Effect.Effect<ResourceInvalidationPlan<R>> => planResourceInvalidationEffect(target);

  export const subscribeEvents = subscribeResourceEventsEffect;

  /**
   * Streams a ref's settled success values.
   *
   * Emits the current value when one is cached, then each later success from a
   * load, refresh, invalidation-triggered reload, or hydration. It never starts
   * a load itself, and it retains the ref against garbage collection while the
   * stream runs, so invalidation keeps refreshing what it follows.
   */
  export const changes = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Stream.Stream<A> =>
    resourceChangesStream(ref);

  /**
   * Reactive `AsyncResult` signal for a Resource ref, including callback failures.
   *
   * Loads mark the current result `waiting`; settlement writes `Success` or a
   * `Failure` carrying the full `Cause` (typed errors, defects) with the latest
   * success kept as `previousSuccess`. An interrupted load returns to the prior
   * settled result.
   */
  export const result = <I, A, E, R>(
    ref: ResourceRef<I, A, E, R>,
  ): ReadableSignal<AsyncResult.AsyncResult<A, E>> => resourceResult(ref);

  /**
   * Effect-first status inspection that reads the ResourceStore and Clock from
   * Effect context.
   */
  export const status = <I, A, E, R>(
    ref: ResourceRef<I, A, E, R>,
  ): Effect.Effect<ResourceStatus<I, A, E, R, E>> => resourceStatusEffect(ref);

  const forTarget = <const Target extends ResourceRefTarget>(
    target: Target,
    run: (ref: AnyResourceRef) => Effect.Effect<unknown, unknown, unknown>,
  ): Effect.Effect<
    ResourceRefTargetValue<Target>,
    ResourceRefTargetError<Target>,
    ResourceRefTargetRequirements<Target>
  > =>
    (Array.isArray(target)
      ? Effect.all(target.map(run), { concurrency: "unbounded" })
      : run(target as AnyResourceRef)) as Effect.Effect<
      ResourceRefTargetValue<Target>,
      ResourceRefTargetError<Target>,
      ResourceRefTargetRequirements<Target>
    >;

  /**
   * Forces a ref, or every ref of an array concurrently, to reload as an
   * Effect, updating cache state. An array yields the values in order.
   *
   * Prefer this inside route preloads, actions, and other Effect workflows.
   */
  export const refresh = <const Target extends ResourceRefTarget>(
    target: Target,
  ): Effect.Effect<
    ResourceRefTargetValue<Target>,
    ResourceRefTargetError<Target>,
    ResourceRefTargetRequirements<Target>
  > => forTarget(target, refreshResourceEffect);

  /**
   * Ensures a ref, or every ref of an array concurrently, is loaded as an
   * Effect, reusing fresh cached data. An array yields the values in order.
   *
   * This records the refs for route preload collection and shares in-flight work.
   *
   * @example
   * ```ts
   * preload: ({ params }) => Resource.preload([ProjectsRef, ProjectById(params.id)])
   * ```
   */
  export const preload = <const Target extends ResourceRefTarget>(
    target: Target,
  ): Effect.Effect<
    ResourceRefTargetValue<Target>,
    ResourceRefTargetError<Target>,
    ResourceRefTargetRequirements<Target>
  > => forTarget(target, prefetchResourceEffect);

  /**
   * Deletes a resource ref from the active Resource Store.
   *
   * This interrupts GC and in-flight load work for the ref, removes dependency
   * graph facts, invalidates its Effect cache entry, and publishes
   * `ResourceDeleted`.
   */
  export const evict = <I, A, E, R>(ref: ResourceRef<I, A, E, R>): Effect.Effect<void> =>
    deleteResourceEffect(ref);

  /** Runs an Effect and returns the resource refs it touched through preload/refresh. */
  export const collect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<Collected<A>, E, R> => collectResourceEffect(effect);

  /**
   * Effect-first read for an already-loaded resource value.
   *
   * Missing, pending, collected, and failed states are reported as typed Effect
   * failures instead of thrown render-control values.
   */
  export const read = <I, A, E, R>(
    ref: ResourceRef<I, A, E, R>,
  ): Effect.Effect<A, ResourceReadError<I, A, E, R>, R> => readResourceEffect(ref);

  /**
   * Invalidates refs or tags and refreshes affected resources as an Effect.
   */
  export const invalidate = <R = never>(
    target: ResourceInvalidationTarget<R>,
  ): Effect.Effect<void, never, R> => invalidateResourceEffect(target);

  /** Runs a previously computed invalidation plan as an Effect. */
  export const runInvalidationPlan = <R = never>(
    plan: ResourceInvalidationPlan<R>,
  ): Effect.Effect<void, never, R> => runResourceInvalidationPlanEffect(plan);

  /** Serializes successful resource refs from the active ResourceStore for hydration. */
  export const dehydrate = (
    refs: Iterable<AnyResourceRef<any>>,
  ): Effect.Effect<ReadonlyArray<ResourceHydrationSnapshot>, ResourceSnapshotCodecError> =>
    dehydrateResourcesEffect(refs);

  /** Builds a validated hydration payload from loaded Resource refs using the ResourceStore in context. */
  export const hydrationPayload = (
    refs: Iterable<AnyResourceRef<any>>,
  ): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
    resourceHydrationPayloadEffect(refs);

  /** Encodes a validated hydration payload as JSON. */
  export const encodeHydrationPayload = (
    payload: ResourceHydrationPayload,
  ): Effect.Effect<string, ResourceSnapshotCodecError> =>
    encodeResourceHydrationPayloadEffect(payload);

  /** Decodes and validates a hydration payload from JSON. */
  export const decodeHydrationPayload = (
    encoded: string,
  ): Effect.Effect<ResourceHydrationPayload, ResourceSnapshotCodecError> =>
    decodeResourceHydrationPayloadEffect(encoded);

  /**
   * Restores successful resource snapshots into the current ResourceStore.
   *
   * Unknown families and key mismatches fail by default with
   * ResourceHydrationApplyError. Pass an explicit skip policy when a caller
   * intentionally hydrates a partial payload.
   */
  export const hydrate = (
    input: ResourceHydrationPayload,
    options?: ResourceHydrationOptions,
  ): Effect.Effect<void, ResourceSnapshotCodecError | ResourceHydrationApplyError> =>
    hydrateResourcesEffect(input, options);
}
