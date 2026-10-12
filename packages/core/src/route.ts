import { Cause, Data, Effect, Exit, Fiber, Schema } from "effect";
import type {
  EffectInputError,
  EffectInputRequirements,
  EnsureEffectInput,
} from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import {
  isResourceRef,
  type AnyResourceFamily,
  type AnyResourceRef,
  type ResourceHydrationPayload,
} from "./resource.js";
import {
  collectResourceEffect,
  resourceHydrationPayloadEffect,
  resourceStoreEffect,
} from "./resource-runtime.js";
import type { ResourceSnapshotCodecError } from "./resource-snapshot-codec.js";
import { hydrateRoutePreloadFailure } from "./route-preload-failure-hydration.js";
import {
  buildRoutePath,
  compareRoutePathSpecificity,
  hrefForRouteInput,
  matchRoutePath,
  parseRouteUrl,
  parseRoutePathSegments,
  type ParamsForPath,
} from "./route-grammar.js";

export type AnySchema<A = unknown> = {
  readonly Type?: A;
};

type SchemaType<S> = S extends { readonly Type: infer A } ? A : unknown;

/** Static resource hint accepted by route preload diagnostics. */
export type RoutePreloadResourceInput =
  | string
  | AnyResourceFamily
  | AnyResourceRef<any>
  | {
      readonly name: string;
    }
  | {
      readonly family: AnyResourceFamily;
    };

/** Static collection hint accepted by route preload diagnostics. */
export type RoutePreloadCollectionInput =
  | string
  | {
      readonly name: string;
    };

/** Static preload resource declaration status for route diagnostics. */
export type RoutePreloadResourceStatus = "declared" | "none" | "unknown";

/** Resource families statically declared by a route preload hint. */
export interface RoutePreloadResourceDiagnostics {
  readonly status: RoutePreloadResourceStatus;
  readonly families: readonly string[];
}

/** Static preload collection declaration status for route diagnostics. */
export type RoutePreloadCollectionStatus = "declared" | "none" | "unknown";

/** Collections statically declared by a route preload hint. */
export interface RoutePreloadCollectionDiagnostics {
  readonly status: RoutePreloadCollectionStatus;
  readonly collections: readonly string[];
}

/**
 * Value accepted from a route preload callback.
 *
 * Route preload return values are ignored, so plain preload callbacks should
 * return `void`. Use an Effect when preload work needs services, failures, or
 * interruption. Promise-shaped returns are rejected at the type and runtime
 * EffectInput seam.
 */
export type RoutePreloadResult<Requirements = never, E = unknown> = void | Effect.Effect<
  unknown,
  E,
  Requirements
>;

/**
 * Schema for a route's typed preload failure, like Effect RPC's `error`.
 *
 * Start encodes a failure the server rendered with this schema (as JSON) and
 * the hydrating client decodes it back into the same typed value, so both
 * renders show the real failure with its declared fields. Encoding and
 * decoding run synchronously, so the schema cannot require services.
 */
export type RouteErrorSchema<E = unknown> = Schema.Codec<E, unknown, never, never>;

export const RouteLazyComponentTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/RouteLazyComponent",
) as never;

type RouteLazyComponentState<Component, E> =
  | {
      readonly _tag: "Initial";
    }
  | {
      readonly _tag: "Pending";
      readonly fiber: Fiber.Fiber<Component, E | RouteLazyComponentLoadError>;
    }
  | {
      readonly _tag: "Success";
      readonly component: Component;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: Cause.Cause<E | RouteLazyComponentLoadError>;
    };

/**
 * Framework-neutral descriptor for route UI code loaded on demand.
 *
 * Lazy component chunks are app-code assets, so their load state is cached on
 * the descriptor rather than on one route render scope. The loader runs as an
 * Effect, while the Solid adapter turns it into an async memo for `<Loading>`.
 */
export interface RouteLazyComponent<Component = unknown, E = never> {
  readonly [RouteLazyComponentTypeId]: typeof RouteLazyComponentTypeId;
  /** Export name read from the lazily imported module. */
  readonly exportName: string;
  /** Starts loading the component chunk as an Effect and reuses the descriptor's in-flight owner. */
  preload(): Effect.Effect<Component, E | RouteLazyComponentLoadError>;
  /** Returns the loaded component, or throws a tagged pending/failure value for UI adapters. */
  read(): Component;
}

/**
 * Marker key carried by renderer components that are values rather than plain
 * functions (Solid's typed `Component`), so routes accept them as components.
 */
export const RouteViewTypeId = "~@sunfall/arc-core/RouteView";

/** A renderer component value accepted as a route component; `P` is its props. */
export interface RouteView<in P> {
  readonly [RouteViewTypeId]: { readonly _P: (props: P) => void };
}

/**
 * Phantom carried by routes from `Route.withComponent(...)`: the attached
 * component's type, so renderer adapters can check what it requires.
 */
export interface RouteWithComponent<out C> {
  readonly "~@sunfall/arc-core/RouteComponent"?: C;
}

/** Error thrown by `Route.readComponent(...)` when a lazy route component is still loading. */
export class RouteLazyComponentPending<E = never> extends Data.TaggedError(
  "RouteLazyComponentPending",
)<{
  readonly exportName: string;
  readonly preload: Effect.Effect<unknown, E | RouteLazyComponentLoadError>;
}> {}

/** Error failed by lazy route component preload Effects when the loaded module is invalid. */
export class RouteLazyComponentLoadError extends Data.TaggedError("RouteLazyComponentLoadError")<{
  readonly exportName: string;
  readonly cause: unknown;
}> {}

/** Error thrown by `Route.readComponent(...)` after a lazy route component load fails. */
export class RouteLazyComponentFailed<E = never> extends Data.TaggedError(
  "RouteLazyComponentFailed",
)<{
  readonly exportName: string;
  readonly cause: Cause.Cause<E | RouteLazyComponentLoadError>;
}> {}

export type RouteLazyComponentModule<Component, ExportName extends string = "default"> = {
  readonly [Key in ExportName]: Component;
};

const lazyRouteComponentMissingExport = (exportName: string): RouteLazyComponentLoadError =>
  new RouteLazyComponentLoadError({
    exportName,
    cause: new Error(`Lazy route component module did not export ${JSON.stringify(exportName)}.`),
  });

function lazyRouteComponent<Component, E = never>(
  importer: Effect.Effect<RouteLazyComponentModule<Component>, E>,
): RouteLazyComponent<Component, E>;
function lazyRouteComponent<const ExportName extends string, Component, E = never>(
  importer: Effect.Effect<RouteLazyComponentModule<Component, ExportName>, E>,
  exportName: ExportName,
): RouteLazyComponent<Component, E>;
function lazyRouteComponent<Component, E = never>(
  importer: Effect.Effect<Record<string, Component>, E>,
  exportName = "default",
): RouteLazyComponent<Component, E> {
  let state: RouteLazyComponentState<Component, E> = { _tag: "Initial" };

  const loadEffect = Effect.exit(
    importer.pipe(
      Effect.flatMap((module) =>
        Effect.suspend(() => {
          if (module === null || typeof module !== "object" || !(exportName in module)) {
            return Effect.fail(lazyRouteComponentMissingExport(exportName));
          }
          return Effect.succeed(Reflect.get(module, exportName) as Component);
        }),
      ),
    ),
  ).pipe(
    Effect.flatMap((exit) => {
      if (Exit.isSuccess(exit)) {
        const component = exit.value;
        return Effect.sync(() => {
          state = { _tag: "Success", component };
          return component;
        });
      }

      return Effect.sync(() => {
        state = { _tag: "Failure", cause: exit.cause };
      }).pipe(Effect.andThen(Effect.failCause(exit.cause)));
    }),
  );

  const startEffect = (): Effect.Effect<Component, E | RouteLazyComponentLoadError> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(loadEffect, { startImmediately: true });
      if (state._tag === "Initial") {
        state = { _tag: "Pending", fiber };
      }
      return yield* Fiber.join(fiber);
    });

  const preloadEffect = (): Effect.Effect<Component, E | RouteLazyComponentLoadError> =>
    Effect.suspend(() => {
      switch (state._tag) {
        case "Initial":
          return startEffect();
        case "Pending":
          return Fiber.join(state.fiber);
        case "Success":
          return Effect.succeed(state.component);
        case "Failure":
          return Effect.failCause(state.cause);
      }
    });

  return {
    [RouteLazyComponentTypeId]: RouteLazyComponentTypeId,
    exportName,
    preload: preloadEffect,
    read: () => {
      switch (state._tag) {
        case "Initial":
          throw new RouteLazyComponentPending({ exportName, preload: preloadEffect() });
        case "Pending":
          throw new RouteLazyComponentPending({
            exportName,
            preload: Fiber.join(state.fiber),
          });
        case "Success":
          return state.component;
        case "Failure":
          throw new RouteLazyComponentFailed({ exportName, cause: state.cause });
      }
    },
  };
}

const isRouteLazyComponent = (value: unknown): value is RouteLazyComponent =>
  value !== null &&
  typeof value === "object" &&
  (value as { readonly [RouteLazyComponentTypeId]?: unknown })[RouteLazyComponentTypeId] ===
    RouteLazyComponentTypeId;

const readRouteComponent = (component: unknown): unknown =>
  isRouteLazyComponent(component) ? component.read() : component;

const routeLazyComponentPendingEffect = <E = never>(
  value: unknown,
): Effect.Effect<unknown, E | RouteLazyComponentLoadError> | undefined =>
  value instanceof RouteLazyComponentPending
    ? (value.preload as Effect.Effect<unknown, E | RouteLazyComponentLoadError>)
    : undefined;

/** Runtime capability needed to launch lazy route component Suspense preload work. */
export interface RouteLazyComponentSuspenseRuntime<RuntimeError = never> {
  /** Forks the lazy component preload Effect in the active UI runtime. */
  readonly runFork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E | RuntimeError>;
}

/**
 * Converts a thrown lazy route pending marker into a runtime-owned preload fiber.
 *
 * UI adapters keep the final host Suspense token conversion, but Core owns the
 * lazy route pending classification and preload launch policy.
 */
const forkRouteLazyComponentSuspense = <RuntimeError, E = never>(
  value: unknown,
  runtime: RouteLazyComponentSuspenseRuntime<RuntimeError>,
): Fiber.Fiber<void, E | RouteLazyComponentLoadError | RuntimeError> | undefined => {
  const pendingEffect = routeLazyComponentPendingEffect<E>(value);
  return pendingEffect === undefined
    ? undefined
    : runtime.runFork(pendingEffect.pipe(Effect.asVoid));
};

/** Props a route passes to its component: decoded params and search plus the match. */
export interface RouteComponentProps<
  R extends RouteDefinition<string, unknown, unknown, unknown, unknown> = RouteDefinition<
    string,
    unknown,
    unknown,
    unknown,
    unknown
  >,
> {
  readonly params: RouteParams<R>;
  readonly search: RouteSearch<R>;
  readonly match: RouteMatch<R>;
}

/**
 * Runtime options a route definition carries.
 *
 * `Route.define(path, options)` checks the options' types (`RouteDefineOptions`);
 * the stored options stay loosely typed and the definition's generics carry
 * the precise params, search, preload services, and preload failure.
 */
export interface RouteOptions<Path extends string, Params, Search, PreloadRequirements = never> {
  /** Optional schema that decodes path params after route matching. */
  readonly params?: AnySchema<Params>;
  /** Optional schema that decodes URL search values after route matching. */
  readonly search?: AnySchema<Search>;
  /** Optional schema for the typed preload failure; see `RouteDefineOptions.error`. */
  readonly error?: RouteErrorSchema<any>;
  /** Effect-first work run before navigation/render. */
  readonly preload?: (
    context: RouteContext<RouteDefinition<Path, Params, Search, PreloadRequirements, any>>,
  ) => RoutePreloadResult<PreloadRequirements, unknown>;
  /** Static resource preload hints used by Start diagnostics and devtools. */
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  /** Static collection preload hints used by Start diagnostics and devtools. */
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
  /** Framework-owned component value attached by `Route.withComponent(...)`. */
  readonly component?: unknown;
  /** Maps the route's component props to the attached component's props. */
  readonly componentProps?: (props: RouteComponentProps<any>) => unknown;
}

type IsUndefined<T> = [T] extends [undefined] ? true : false;

type ParamsFromSchema<Path extends string, ParamsSchema> =
  IsUndefined<ParamsSchema> extends true ? ParamsForPath<Path> : SchemaType<ParamsSchema>;

type SearchFromSchema<SearchSchema> =
  IsUndefined<SearchSchema> extends true ? Record<string, never> : SchemaType<SearchSchema>;

/**
 * Failure of a route preload whose route declares no `error` schema.
 *
 * Without a schema only the failure's `_tag` can cross the wire, so the
 * router reports every schema-less preload failure as this value, on the
 * server, on the client, and after hydration alike. Declare an `error` schema
 * to keep the failure's data.
 */
export class RoutePreloadUntypedFailure extends Data.TaggedError("RoutePreloadUntypedFailure")<{
  /** `_tag` of the original failure, when it had one. */
  readonly tag?: string;
}> {
  override get message(): string {
    return this.tag === undefined
      ? "Route preload failed (declare an `error` schema to keep the failure)"
      : `Route preload failed with "${this.tag}" (declare an \`error\` schema to keep its data)`;
  }
}

/**
 * Typed preload failure for a route: the `error` schema's type when one is
 * declared, `RoutePreloadUntypedFailure` when the preload can fail without
 * one, and `never` when the preload cannot fail.
 */
type PreloadFailureFor<ErrorSchema, Out> = [Out] extends [never]
  ? never
  : IsUndefined<ErrorSchema> extends true
    ? [EffectInputError<Out>] extends [never]
      ? never
      : RoutePreloadUntypedFailure
    : SchemaType<ErrorSchema>;

/**
 * Readable type error: the route preload can fail with `Undeclared`, which
 * the route's `error` schema does not cover. Widen the schema (e.g.
 * `Schema.Union([...])`) or handle those failures in the preload.
 */
export interface RoutePreloadFailureNotInErrorSchema<Undeclared> {
  readonly "~route-error": "This route's preload can fail with errors its `error` schema does not declare";
  readonly undeclared: Undeclared;
}

/**
 * Readable type error: the route preload returned a Promise-shaped value.
 * Return an Effect instead, adapting host Promise work with `Effect.tryPromise`.
 */
export interface RoutePreloadReturnsPromise {
  readonly "~route-preload": "Route preload must return void or an Effect, not a Promise";
}

type RoutePreloadCheck<ErrorSchema, Out> = [Out] extends [never]
  ? unknown
  : [EnsureEffectInput<Out>] extends [never]
    ? { readonly preload: RoutePreloadReturnsPromise }
    : IsUndefined<ErrorSchema> extends true
      ? unknown
      : [EffectInputError<Out>] extends [SchemaType<ErrorSchema>]
        ? unknown
        : {
            readonly error: RoutePreloadFailureNotInErrorSchema<
              Exclude<EffectInputError<Out>, SchemaType<ErrorSchema>>
            >;
          };

/**
 * Options accepted by `Route.define(path, options)` (and Start's
 * `FileRoute.define(path)(options)`).
 *
 * `preload` is inferred from its own body: its params come from `params` (or
 * the path), its services and failures from what it returns. With an `error`
 * schema the inferred failure must be covered by the schema's type; a
 * mismatch is reported on `error` as `RoutePreloadFailureNotInErrorSchema`.
 */
export type RouteDefineOptions<
  Path extends string,
  ParamsSchema,
  SearchSchema,
  ErrorSchema,
  Out,
> = {
  /** Optional schema that decodes path params after route matching. */
  readonly params?: ParamsSchema;
  /** Optional schema that decodes URL search values after route matching. */
  readonly search?: SearchSchema;
  /**
   * Optional schema for the typed preload failure, like Effect RPC's `error`.
   * When present, `preload` may fail only with this schema's type, and Start
   * sends a server-rendered failure to the client encoded with it. Without
   * it a failing preload reports `RoutePreloadUntypedFailure` (its `_tag` only).
   */
  readonly error?: ErrorSchema;
  /**
   * Effect-first work run before navigation/render. Promise returns are
   * rejected; synchronous throws are defects, not typed failures.
   */
  readonly preload?: (
    context: RouteContext<
      RouteDefinition<
        Path,
        ParamsFromSchema<Path, ParamsSchema>,
        SearchFromSchema<SearchSchema>,
        any,
        any
      >
    >,
  ) => Out;
  /** Static resource preload hints used by Start diagnostics and devtools. */
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  /** Static collection preload hints used by Start diagnostics and devtools. */
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
} & RoutePreloadCheck<ErrorSchema, Out>;

/**
 * Typed route constructor for one path: `Route.define(path, options)` and
 * Start's `FileRoute.define(path)` share it.
 */
export interface RouteFactory<Path extends string> {
  <
    ParamsSchema extends AnySchema | undefined = undefined,
    SearchSchema extends AnySchema | undefined = undefined,
    ErrorSchema extends RouteErrorSchema<any> | undefined = undefined,
    Out = never,
  >(
    options: RouteDefineOptions<Path, ParamsSchema, SearchSchema, ErrorSchema, Out>,
  ): RouteDefinition<
    Path,
    ParamsFromSchema<Path, ParamsSchema>,
    SearchFromSchema<SearchSchema>,
    EffectInputRequirements<Out>,
    PreloadFailureFor<ErrorSchema, Out>
  >;
}

/**
 * Runtime route object produced by `route`.
 *
 * `PreloadError` is the typed preload failure: the `error` schema's type when
 * one is declared, `RoutePreloadUntypedFailure` for a preload that can fail
 * without one, and `never` when the route cannot fail to preload.
 */
export interface RouteDefinition<
  Path extends string,
  Params,
  Search,
  PreloadRequirements = never,
  PreloadError = unknown,
> {
  readonly path: Path;
  readonly options: RouteOptions<Path, Params, Search, PreloadRequirements>;
  /** Phantom: the route's typed preload failure (see `Route.PreloadFailure`). */
  readonly "~preloadFailure"?: (_: never) => PreloadError;
  /** Builds an href from typed path params and optional search values. */
  build(params: Params, search?: Partial<Search>): string;
  /**
   * Matches a URL and synchronously decodes params/search when schemas are present.
   *
   * Schema decode failures throw from this sync API. Use
   * `Route.planNavigation(...)` when callers need typed
   * `RouteNavigationError` failures instead.
   */
  match(input: string | URL): RouteMatch<this> | undefined;
}

/** Params type carried by a route definition. */
export type RouteParams<R> =
  R extends RouteDefinition<infer _Path, infer Params, infer _Search, infer _PreloadRequirements>
    ? Params
    : never;

/** Search type carried by a route definition. */
export type RouteSearch<R> =
  R extends RouteDefinition<infer _Path, infer _Params, infer Search, infer _PreloadRequirements>
    ? Search
    : never;

/** Services required by a route preload callback. */
export type RoutePreloadRequirements<R> =
  R extends RouteDefinition<infer _Path, infer _Params, infer _Search, infer PreloadRequirements>
    ? PreloadRequirements
    : never;

/** Typed preload failure of a route definition (distributes over route unions). */
export type RoutePreloadFailure<R> =
  R extends RouteDefinition<
    infer _Path,
    infer _Params,
    infer _Search,
    infer _PreloadRequirements,
    infer PreloadError
  >
    ? PreloadError
    : never;

/** Context passed to route preload callbacks and route matches. */
export type RouteContext<R extends RouteDefinition<string, unknown, unknown, unknown>> = {
  readonly route: R;
  readonly params: RouteParams<R>;
  readonly search: RouteSearch<R>;
  readonly pathname: string;
  readonly href: string;
};

/** Successful route match with decoded params and search values. */
export type RouteMatch<
  R extends RouteDefinition<string, unknown, unknown, unknown> = RouteDefinition<
    string,
    unknown,
    unknown,
    unknown
  >,
> = RouteContext<R>;

/** Result of preloading one matched route. */
export interface RoutePreloadPlan<
  R extends RouteDefinition<string, unknown, unknown, unknown> = RouteDefinition<
    string,
    unknown,
    unknown,
    unknown
  >,
> {
  readonly match: RouteMatch<R>;
  readonly refs: ReadonlyArray<AnyResourceRef>;
  readonly resources: ResourceHydrationPayload;
}

/** Navigation plan for a href, including match/preload resources or not-found state. */
export type RouteNavigationPlan<
  R extends RouteDefinition<string, unknown, unknown, unknown> = RouteDefinition<
    string,
    unknown,
    unknown,
    unknown
  >,
> =
  | {
      readonly _tag: "Matched";
      readonly href: string;
      readonly match: RouteMatch<R>;
      readonly refs: ReadonlyArray<AnyResourceRef>;
      readonly resources: ResourceHydrationPayload;
    }
  | {
      readonly _tag: "NotFound";
      readonly href: string;
      readonly match: undefined;
      readonly refs: readonly [];
      readonly resources: ResourceHydrationPayload;
    };

type RouteHrefParamsOptions<Params> = {} extends Params
  ? { readonly params?: Params }
  : { readonly params: Params };

/** Params and optional search values accepted by `Route.href` and router helpers. */
export type RouteHrefOptions<R extends RouteDefinition<string, unknown, unknown, unknown>> =
  RouteHrefParamsOptions<RouteParams<R>> & {
    readonly search?: Partial<RouteSearch<R>>;
  };

/** Variadic arguments accepted by `Route.href`; static and optional-param routes can omit options. */
export type RouteHrefArgs<R extends RouteDefinition<string, unknown, unknown, unknown>> =
  {} extends RouteParams<R> ? [options?: RouteHrefOptions<R>] : [options: RouteHrefOptions<R>];

const routePreloadCauseTag = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "_tag" in cause && typeof cause._tag === "string"
    ? cause._tag
    : undefined;

const routePreloadCauseSummary = (cause: unknown): string | undefined =>
  (cause instanceof RoutePreloadUntypedFailure ? cause.tag : routePreloadCauseTag(cause)) ??
  (cause instanceof Error && cause.message.length > 0 ? cause.message : undefined);

/** A matched route's preload failed; `cause` is the typed preload failure. */
export class RoutePreloadError<E = unknown> extends Data.TaggedError("RoutePreloadError")<{
  readonly path: string;
  readonly href: string;
  readonly cause: E;
}> {
  /** Names the route, the href, and the failure so logs and fallback views say what failed. */
  override get message(): string {
    const summary = routePreloadCauseSummary(this.cause);
    return `Route "${this.path}" failed to preload "${this.href}"${summary === undefined ? "" : `: ${summary}`}`;
  }
}

/**
 * Wire form of a route preload failure.
 *
 * - `Encoded`: the route declares an `error` schema; `value` is the failure
 *   encoded as JSON by that schema, decoded back into the typed failure.
 * - `Untyped`: the route has no `error` schema; only the failure `_tag`
 *   crosses the wire and the rebuilt cause is `{ _tag }`.
 * - `Unencodable`: the failure did not encode with the route's `error`
 *   schema; it is rendered as a `RoutePreloadFailureCodecError` defect.
 */
export type RoutePreloadFailureEncoding =
  | { readonly _tag: "Encoded"; readonly value: Schema.Json }
  | { readonly _tag: "Untyped"; readonly tag?: string }
  | { readonly _tag: "Unencodable" };

/**
 * Serializable record of a route preload failure that a server render shows,
 * so the hydrating client starts in the same router `Failure` state.
 *
 * Both the server render and the client render the failure decoded from this
 * snapshot, so their output agrees. Failure data crosses the wire only as the
 * route's `error` schema encodes it.
 */
export interface RoutePreloadFailureSnapshot {
  readonly path: string;
  readonly href: string;
  readonly failure: RoutePreloadFailureEncoding;
}

/**
 * Defect for a route preload failure that could not cross the wire with the
 * route's `error` schema: encoding failed on the server, or decoding failed
 * on the client. It carries no failure data.
 */
export class RoutePreloadFailureCodecError extends Data.TaggedError(
  "RoutePreloadFailureCodecError",
)<{
  readonly path: string;
  readonly href: string;
  readonly operation: "encode" | "decode";
}> {
  override get message(): string {
    return `Route "${this.path}" preload failure for "${this.href}" could not ${this.operation} with the route error schema`;
  }
}

export class RouteNavigationError extends Data.TaggedError("RouteNavigationError")<{
  readonly input: string;
  readonly cause: unknown;
}> {}

export type RoutePreloadPlanError<E = unknown> = RoutePreloadError<E> | ResourceSnapshotCodecError;

export type RouteNavigationPlanError<E = unknown> = RouteNavigationError | RoutePreloadPlanError<E>;

const appendSearch = (path: string, search: Record<string, unknown> | undefined): string => {
  if (!search) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
};

const searchObject = (searchParams: URLSearchParams): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of searchParams) {
    out[key] = value;
  }
  return out;
};

const decode = <A>(schema: unknown, input: unknown): A => {
  if (!Schema.isSchema(schema)) {
    return input as A;
  }

  return Schema.decodeUnknownSync(schema as Schema.Decoder<A>)(input);
};

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const resourceFamilyName = (value: RoutePreloadResourceInput): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (isResourceRef(value)) {
    return value.family.options.name;
  }

  if (!isObjectLike(value)) {
    return undefined;
  }

  const object = value as {
    readonly options?: unknown;
    readonly family?: unknown;
    readonly name?: unknown;
  };
  const directOptions = object.options;
  if (isObjectLike(directOptions) && typeof directOptions.name === "string") {
    return directOptions.name;
  }

  const family = object.family;
  if (
    isObjectLike(family) &&
    isObjectLike(family.options) &&
    typeof family.options.name === "string"
  ) {
    return family.options.name;
  }

  return typeof object.name === "string" ? object.name : undefined;
};

const uniqueSortedResourceFamilies = (
  resources: readonly RoutePreloadResourceInput[],
): readonly string[] =>
  Array.from(
    new Set(
      resources.flatMap((resource) => {
        const name = resourceFamilyName(resource);
        return name === undefined ? [] : [name];
      }),
    ),
  ).sort();

const collectionName = (value: RoutePreloadCollectionInput): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  return isObjectLike(value) && typeof value.name === "string" ? value.name : undefined;
};

const uniqueSortedCollectionNames = (
  collections: readonly RoutePreloadCollectionInput[],
): readonly string[] =>
  Array.from(
    new Set(
      collections.flatMap((collection) => {
        const name = collectionName(collection);
        return name === undefined ? [] : [name];
      }),
    ),
  ).sort();

const routePreloadError = <E>(match: RouteMatch, cause: E): RoutePreloadError<E> =>
  new RoutePreloadError({
    path: match.route.path,
    href: match.href,
    cause,
  });

const routeNavigationError = (input: string | URL, cause: unknown): RouteNavigationError =>
  new RouteNavigationError({
    input: typeof input === "string" ? input : input.href,
    cause,
  });

const orderedRouteDefinitions = <
  const Routes extends readonly RouteDefinition<string, unknown, unknown, any>[],
>(
  routes: Routes,
): ReadonlyArray<Routes[number]> =>
  routes
    .map((definition, index) => ({
      definition,
      index,
      segments: parseRoutePathSegments(definition.path),
    }))
    .sort((left, right) => {
      const comparison = compareRoutePathSpecificity(left.segments, right.segments);
      return comparison === 0 ? left.index - right.index : comparison;
    })
    .map((entry) => entry.definition);

const untypedPreloadFailure = (cause: unknown): RoutePreloadUntypedFailure => {
  if (cause instanceof RoutePreloadUntypedFailure) {
    return cause;
  }
  const tag = routePreloadCauseTag(cause);
  return new RoutePreloadUntypedFailure(tag === undefined ? {} : { tag });
};

/**
 * The route each `Route.withComponent(...)` copy was made from, and the
 * components attached to each such source route. A route and its copies are
 * one route (they compare by path), so preloading the source's match can load
 * the component a copy renders: Start does this before hydrating, where only
 * the app's route list (often without components) is at hand.
 */
const routeSources = new WeakMap<object, object>();
const routeAttachedComponents = new WeakMap<object, Set<unknown>>();

const routeSource = (definition: object): object => routeSources.get(definition) ?? definition;

const attachRouteComponent = (source: object, copy: object, component: unknown): void => {
  routeSources.set(copy, source);
  const attached = routeAttachedComponents.get(source) ?? new Set<unknown>();
  attached.add(component);
  routeAttachedComponents.set(source, attached);
};

const makeRouteDefinition = (
  path: string,
  options: RouteOptions<string, unknown, unknown, unknown>,
): RouteDefinition<string, unknown, unknown, unknown, unknown> => {
  const definition: RouteDefinition<string, unknown, unknown, unknown, unknown> = {
    path,
    options,
    build(params, search) {
      const compiled = buildRoutePath(path, params as Record<string, unknown>);
      return appendSearch(compiled, search as Record<string, unknown> | undefined);
    },
    match(input) {
      const url = parseRouteUrl(input);
      const params = matchRoutePath(path, url.pathname);
      if (!params) {
        return undefined;
      }

      return {
        route: definition,
        params: decode(options.params, params),
        search: decode(options.search, searchObject(url.searchParams)),
        pathname: url.pathname,
        href: `${url.pathname}${url.search}`,
      } as RouteMatch<typeof definition>;
    },
  };
  return definition;
};

/** Helpers for matching, building, and preloading route definitions. */
export namespace Route {
  export type Definition<
    Path extends string = string,
    Params = unknown,
    Search = unknown,
    PreloadRequirements = never,
    PreloadError = unknown,
  > = RouteDefinition<Path, Params, Search, PreloadRequirements, PreloadError>;

  export type Match<
    R extends Definition<string, unknown, unknown, any> = Definition<string, unknown, unknown, any>,
  > = RouteMatch<R>;

  /** Preload result collected for one matched route before navigation/render. */
  export type PreloadPlan<
    R extends Definition<string, unknown, unknown, any> = Definition<string, unknown, unknown, any>,
  > = RoutePreloadPlan<R>;

  export type NavigationPlan<
    R extends Definition<string, unknown, unknown, any> = Definition<string, unknown, unknown, any>,
  > = RouteNavigationPlan<R>;

  export type Context<R extends Definition<string, unknown, unknown, any>> = RouteContext<R>;

  export type Params<R> = RouteParams<R>;

  export type Search<R> = RouteSearch<R>;

  /** Service requirements needed by a route preload callback. */
  export type PreloadRequirements<R> = RoutePreloadRequirements<R>;

  /** Typed preload failure of a route: its `error` schema type, `RoutePreloadUntypedFailure` without one, `never` when it cannot fail. */
  export type PreloadFailure<R> = RoutePreloadFailure<R>;

  export type HrefOptions<R extends Definition<string, unknown, unknown, any>> =
    RouteHrefOptions<R>;

  export type HrefArgs<R extends Definition<string, unknown, unknown, any>> = RouteHrefArgs<R>;

  /** Static resource preload hint accepted by Route and Start file-route APIs. */
  export type PreloadResourceInput = RoutePreloadResourceInput;

  /** Resource preload diagnostics consumed by Start manifests and devtools. */
  export type PreloadResourceDiagnostics = RoutePreloadResourceDiagnostics;

  /** Static collection preload hint accepted by Route and Start file-route APIs. */
  export type PreloadCollectionInput = RoutePreloadCollectionInput;

  /** Collection preload diagnostics consumed by Start manifests and devtools. */
  export type PreloadCollectionDiagnostics = RoutePreloadCollectionDiagnostics;

  /** Error union for running route preload and resource hydration planning. */
  export type PreloadError<R = Definition> = RoutePreloadPlanError<PreloadFailure<R>>;

  /** Error union for matching and preloading a navigation to one of the routes `R`. */
  export type NavigationError<R = Definition> = RouteNavigationPlanError<PreloadFailure<R>>;

  /** Props a route passes to its component: decoded params and search plus the match. */
  export type Props<R extends Definition<string, unknown, unknown, any, any>> =
    RouteComponentProps<R>;

  /** A component taking props `P`: a plain render function or a renderer component value. */
  export type ComponentFor<P> = ((props: P) => unknown) | RouteView<P>;

  /** A route component taking the route's own `Props<R>`. */
  export type Component<R extends Definition<string, unknown, unknown, any>> = ComponentFor<
    Props<R>
  >;

  /** The component attached to a route by `withComponent` (`never` when none is known). */
  export type ComponentOf<R> =
    R extends RouteWithComponent<infer C> ? Exclude<C, undefined> : never;

  export type LazyComponent<ComponentValue = unknown, E = never> = RouteLazyComponent<
    ComponentValue,
    E
  >;

  export type LazyComponentSuspenseRuntime<RuntimeError = never> =
    RouteLazyComponentSuspenseRuntime<RuntimeError>;

  export type LazyComponentModule<
    ComponentValue,
    ExportName extends string = "default",
  > = RouteLazyComponentModule<ComponentValue, ExportName>;

  /**
   * Eager or lazy component descriptor taking props `P`.
   *
   * `E` is the lazy importer error channel. It defaults to `unknown` because
   * attaching a component is render-only; callers that need the lazy preload
   * error channel should work with `Route.LazyComponent<Component, E>` directly.
   */
  export type ComponentInput<P, E = unknown> = ComponentFor<P> | LazyComponent<ComponentFor<P>, E>;

  /** Route constructor for one path; see `RouteFactory`. */
  export type Factory<Path extends string> = RouteFactory<Path>;

  /**
   * Defines a typed route with path params, optional search decoding, and preload work.
   *
   * Params are inferred from `:param` segments unless a params schema is supplied.
   *
   * @example
   * ```ts
   * const userRoute = Route.define("/users/:id", {
   *   preload: ({ params }) => Resource.preload(UserResource(params.id))
   * });
   *
   * const href = userRoute.build({ id: "42" });
   * ```
   */
  export function define<const Path extends string>(
    path: Path,
  ): RouteDefinition<Path, ParamsForPath<Path>, Record<string, never>, never, never>;
  export function define<
    const Path extends string,
    ParamsSchema extends AnySchema | undefined = undefined,
    SearchSchema extends AnySchema | undefined = undefined,
    ErrorSchema extends RouteErrorSchema<any> | undefined = undefined,
    Out = never,
  >(
    path: Path,
    options: RouteDefineOptions<Path, ParamsSchema, SearchSchema, ErrorSchema, Out>,
  ): RouteDefinition<
    Path,
    ParamsFromSchema<Path, ParamsSchema>,
    SearchFromSchema<SearchSchema>,
    EffectInputRequirements<Out>,
    PreloadFailureFor<ErrorSchema, Out>
  >;
  export function define(
    path: string,
    options: object = {},
  ): RouteDefinition<string, unknown, unknown, unknown, unknown> {
    return makeRouteDefinition(path, options as RouteOptions<string, unknown, unknown, unknown>);
  }

  /** Creates a route component descriptor backed by a lazily imported module. */
  export const lazyComponent = lazyRouteComponent;

  /** Returns true when a route component is a lazy component descriptor. */
  export const isLazyComponent = isRouteLazyComponent;

  /** Reads a route component, throwing tagged lazy load states for UI adapters. */
  export const readComponent = readRouteComponent;

  /** Extracts preload work from a thrown lazy route pending marker. */
  export const lazyComponentPending = routeLazyComponentPendingEffect;

  /** Forks a pending lazy component preload for framework Suspense adapters. */
  export const forkLazyComponentSuspense = forkRouteLazyComponentSuspense;

  /** Builds an href for a route from typed params and optional search values. */
  export const href = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
    ...args: HrefArgs<R>
  ): string => {
    const options = (args[0] ?? {}) as HrefOptions<R>;
    return definition.build((options.params ?? {}) as Params<R>, options.search);
  };

  /** Route returned by `withComponent`: the same route carrying its component `C`. */
  export type WithComponent<R extends Definition<string, unknown, unknown, any>, C> = Definition<
    R["path"],
    Params<R>,
    Search<R>,
    PreloadRequirements<R>,
    PreloadFailure<R>
  > &
    RouteWithComponent<C>;

  /**
   * Returns the route rendering `component` (eager or lazy).
   *
   * Without `props`, the component takes the route's own `Route.Props<R>`.
   * With `props`, it maps the route props (params, search, match) to the
   * component's props, so a feature component binds to a route directly:
   *
   * @example
   * ```tsx
   * Route.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id }))
   * ```
   *
   * Params, search, preload, and the other route options are preserved.
   */
  export function withComponent<
    R extends Definition<string, unknown, unknown, any>,
    C extends ComponentInput<Props<R>>,
  >(definition: R, component: C): WithComponent<R, C>;
  export function withComponent<
    R extends Definition<string, unknown, unknown, any>,
    P,
    C extends ComponentInput<P>,
  >(
    definition: R,
    component: C & ComponentInput<P>,
    props: (route: Props<R>) => NoInfer<P>,
  ): WithComponent<R, C>;
  export function withComponent(
    definition: Definition<string, unknown, unknown, any>,
    component: unknown,
    props?: (route: RouteComponentProps<any>) => unknown,
  ): Definition<string, unknown, unknown, any> {
    const { componentProps: _previous, ...options } = definition.options;
    const copy = makeRouteDefinition(definition.path, {
      ...options,
      component,
      ...(props === undefined ? {} : { componentProps: props }),
    });
    attachRouteComponent(routeSource(definition), copy, component);
    return copy;
  }

  /**
   * Returns the first matching route for a URL, or undefined when none match.
   *
   * This sync helper delegates to each route's `match(...)`; schema-backed
   * params/search decode failures throw. Use `Route.planNavigation(...)`
   * for an Effect-returning navigation path with typed `RouteNavigationError`
   * failures.
   */
  export const match = <const Routes extends readonly Definition<string, unknown, unknown, any>[]>(
    routes: Routes,
    input: string | URL,
  ): Match<Routes[number]> | undefined => {
    for (const definition of orderedRouteDefinitions(routes)) {
      const matched = definition.match(input);
      if (matched) {
        return matched as Match<Routes[number]>;
      }
    }

    return undefined;
  };

  /**
   * Narrows a route match to `definition`'s match.
   *
   * Routes compare by path, so the check also holds for the copies
   * `Route.withComponent(...)` returns.
   */
  export const isMatch = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
    match: Match<Definition<string, unknown, unknown, any>> | undefined,
  ): match is Match<R> => match?.route.path === definition.path;

  /**
   * Runs a matched route's preload function as an Effect.
   *
   * Typed preload failures become `RoutePreloadError<Route.PreloadFailure<R>>`;
   * without an `error` schema the failure is `RoutePreloadUntypedFailure`
   * carrying its `_tag`. Synchronous throws and Promise returns break the
   * preload contract and are defects.
   */
  export const preload = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<void, RoutePreloadError<PreloadFailure<R>>, PreloadRequirements<R>> =>
    Effect.suspend(() => {
      const input = match.route.options.preload?.(match);
      return input === undefined
        ? Effect.void
        : (toEffect(input as never) as Effect.Effect<
            unknown,
            PreloadFailure<R>,
            PreloadRequirements<R>
          >);
    }).pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        routePreloadError(
          match,
          (match.route.options.error === undefined
            ? untypedPreloadFailure(cause)
            : cause) as PreloadFailure<R>,
        ),
      ),
    );

  /**
   * Preloads the lazy component chunk the matched route renders: its own
   * component, or, for a route without one, the components
   * `Route.withComponent(...)` attached to copies of it (a route and its copies
   * compare by path). A failed load fails with `RouteLazyComponentFailed`.
   */
  export const preloadComponent = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<void, RouteLazyComponentFailed<unknown>> => {
    const own = match.route.options.component;
    const components = (
      own === undefined
        ? Array.from(routeAttachedComponents.get(routeSource(match.route)) ?? [])
        : [own]
    ).filter(isRouteLazyComponent);

    return Effect.forEach(
      components,
      (component) =>
        component
          .preload()
          .pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new RouteLazyComponentFailed<unknown>({ exportName: component.exportName, cause }),
              ),
            ),
          ),
      { concurrency: "unbounded", discard: true },
    );
  };

  /** Returns sorted resource family names statically declared by a route. */
  export const preloadResourceFamilies = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
  ): readonly string[] => uniqueSortedResourceFamilies(definition.options.preloadResources ?? []);

  /** Returns sorted collection names statically declared by a route. */
  export const preloadCollectionNames = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
  ): readonly string[] => uniqueSortedCollectionNames(definition.options.preloadCollections ?? []);

  /**
   * Describes route resource preload metadata for manifests and devtools.
   *
   * `declared` means the route provided static resource hints, `none` means the
   * route has no preload work, and `unknown` means custom preload work exists
   * but no static resource hints were declared.
   */
  export const describePreloadResources = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
  ): RoutePreloadResourceDiagnostics => {
    if (definition.options.preloadResources !== undefined) {
      return {
        status: "declared",
        families: preloadResourceFamilies(definition),
      };
    }

    return definition.options.preload === undefined
      ? {
          status: "none",
          families: [],
        }
      : {
          status: "unknown",
          families: [],
        };
  };

  /**
   * Describes route collection preload metadata for manifests and devtools.
   *
   * `declared` means the route provided static collection hints, `none` means
   * the route has no preload work, and `unknown` means custom preload work
   * exists but no static collection hints were declared.
   */
  export const describePreloadCollections = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
  ): RoutePreloadCollectionDiagnostics => {
    if (definition.options.preloadCollections !== undefined) {
      return {
        status: "declared",
        collections: preloadCollectionNames(definition),
      };
    }

    return definition.options.preload === undefined
      ? {
          status: "none",
          collections: [],
        }
      : {
          status: "unknown",
          collections: [],
        };
  };

  /**
   * Captures the wire snapshot of a preload failure of `definition`.
   *
   * With an `error` schema the failure is encoded as JSON by that schema; a
   * failure that does not encode is logged and sent as `Unencodable`, without
   * its data. Without an `error` schema only the failure `_tag` is sent.
   */
  export const preloadFailureSnapshot = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
    error: RoutePreloadError<PreloadFailure<R>>,
  ): Effect.Effect<RoutePreloadFailureSnapshot> => {
    const snapshot = (failure: RoutePreloadFailureEncoding): RoutePreloadFailureSnapshot => ({
      path: error.path,
      href: error.href,
      failure,
    });
    const schema = definition.options.error;
    if (schema === undefined) {
      const tag = untypedPreloadFailure(error.cause).tag;
      return Effect.succeed(snapshot({ _tag: "Untyped", ...(tag === undefined ? {} : { tag }) }));
    }
    return Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(error.cause).pipe(
      Effect.map((value) => snapshot({ _tag: "Encoded", value })),
      Effect.catch((schemaError) =>
        Effect.logWarning(
          `Route "${error.path}" preload failure for "${error.href}" did not encode with the route error schema`,
          schemaError,
        ).pipe(Effect.as(snapshot({ _tag: "Unencodable" }))),
      ),
    );
  };

  /**
   * Rebuilds the router failure a snapshot describes for `definition`.
   *
   * An `Encoded` failure decodes with the route's `error` schema into the
   * typed `RoutePreloadError` cause; an `Untyped` one rebuilds it as
   * `RoutePreloadUntypedFailure` with the same `tag`. A failure that cannot cross the wire with the route's schema
   * (unencodable, undecodable, or mismatched with the route) is a
   * `RoutePreloadFailureCodecError` defect.
   */
  export const preloadFailureCauseFromSnapshot = <
    R extends Definition<string, unknown, unknown, any>,
  >(
    definition: R,
    snapshot: RoutePreloadFailureSnapshot,
  ): Cause.Cause<RoutePreloadError<PreloadFailure<R>>> => {
    const codecDefect = (operation: "encode" | "decode") =>
      Cause.die(
        new RoutePreloadFailureCodecError({
          path: snapshot.path,
          href: snapshot.href,
          operation,
        }),
      );
    const fail = (cause: PreloadFailure<R>) =>
      Cause.fail(new RoutePreloadError({ path: snapshot.path, href: snapshot.href, cause }));
    const schema = definition.options.error;
    const failure = snapshot.failure;
    if (snapshot.path !== definition.path) {
      return codecDefect("decode");
    }
    switch (failure._tag) {
      case "Unencodable":
        return codecDefect("encode");
      case "Untyped":
        return schema === undefined
          ? fail(
              new RoutePreloadUntypedFailure(
                failure.tag === undefined ? {} : { tag: failure.tag },
              ) as PreloadFailure<R>,
            )
          : codecDefect("decode");
      case "Encoded": {
        if (schema === undefined) {
          return codecDefect("decode");
        }
        const decoded = Schema.decodeUnknownExit(Schema.toCodecJson(schema))(failure.value);
        return Exit.isSuccess(decoded)
          ? fail(decoded.value as PreloadFailure<R>)
          : codecDefect("decode");
      }
    }
  };

  /**
   * Starts the next router created on the active runtime for `snapshot.href`
   * in the `Failure` state the snapshot describes, instead of `Ready`.
   *
   * Start runs this in the server request runtime when route preload fails and
   * in the browser runtime while hydrating that document, so both renders show
   * the outlet's failure view. The record is consumed by the first router that
   * reads it; later navigations to the href run its preload again.
   */
  export const hydratePreloadFailure = (
    snapshot: RoutePreloadFailureSnapshot,
  ): Effect.Effect<void> =>
    Effect.map(resourceStoreEffect, (store) => hydrateRoutePreloadFailure(store, snapshot));

  /** Runs matched route preload and captures touched resources for hydration. */
  export const planPreload = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<PreloadPlan<R>, PreloadError<R>, PreloadRequirements<R>> =>
    collectResourceEffect(preload(match)).pipe(
      Effect.flatMap((collected) =>
        resourceHydrationPayloadEffect(collected.refs).pipe(
          Effect.map((resources) => ({
            match,
            refs: collected.refs,
            resources,
          })),
        ),
      ),
    );

  /**
   * Matches a URL and produces a navigation plan with collected resource hydration.
   *
   * Route preloads run inside Effect so adapters can await data and serialize only
   * resources touched during the preload.
   */
  export const planNavigation = <
    const Routes extends readonly Definition<string, unknown, unknown, any>[],
  >(
    routes: Routes,
    input: string | URL,
  ): Effect.Effect<
    NavigationPlan<Routes[number]>,
    NavigationError<Routes[number]>,
    PreloadRequirements<Routes[number]>
  > =>
    Effect.try({
      try: () => hrefForRouteInput(input),
      catch: (cause) => routeNavigationError(input, cause),
    }).pipe(
      Effect.flatMap((href) =>
        Effect.try({
          try: () => match(routes, input),
          catch: (cause) => routeNavigationError(input, cause),
        }).pipe(Effect.map((matched) => ({ href, matched }))),
      ),
      Effect.flatMap(
        ({
          href,
          matched,
        }): Effect.Effect<
          NavigationPlan<Routes[number]>,
          NavigationError<Routes[number]>,
          PreloadRequirements<Routes[number]>
        > => {
          if (!matched) {
            const notFound: NavigationPlan<Routes[number]> = {
              _tag: "NotFound" as const,
              href,
              match: undefined,
              refs: [],
              resources: { resources: [] },
            };
            return Effect.succeed(notFound);
          }

          return planPreload(matched).pipe(
            Effect.map(
              (plan): NavigationPlan<Routes[number]> => ({
                _tag: "Matched" as const,
                href,
                match: plan.match,
                refs: plan.refs,
                resources: plan.resources,
              }),
            ),
          );
        },
      ),
    );
}
