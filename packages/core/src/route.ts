import { Cause, Data, Effect, Exit, Fiber, Schema } from "effect";
import type { EffectInputRequirements, EnsureEffectInput } from "./effect-like.js";
import { catchEffectInputPromiseDefect, toEffect } from "./effect-like.js";
import {
  isResourceRef,
  type AnyResourceFamily,
  type AnyResourceRef,
  type ResourceHydrationPayload,
} from "./resource.js";
import { collectResourceEffect, resourceHydrationPayloadEffect } from "./resource-runtime.js";
import type { ResourceSnapshotCodecError } from "./resource-snapshot-codec.js";
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
export type RoutePreloadResult<Requirements = never> = void | Effect.Effect<
  unknown,
  unknown,
  Requirements
>;

export const RouteLazyComponentTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/RouteLazyComponent",
) as never;

type RouteLazyComponentState<Component> =
  | {
      readonly _tag: "Initial";
    }
  | {
      readonly _tag: "Pending";
      readonly fiber: Fiber.Fiber<Component, unknown>;
    }
  | {
      readonly _tag: "Success";
      readonly component: Component;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: Cause.Cause<unknown>;
    };

/**
 * Framework-neutral descriptor for route UI code loaded on demand.
 *
 * Lazy component chunks are app-code assets, so their load state is cached on
 * the descriptor rather than on one route render scope. The loader runs as an
 * Effect, while React and Solid own the final host Suspense token conversion.
 */
export interface RouteLazyComponent<Component = unknown> {
  readonly [RouteLazyComponentTypeId]: typeof RouteLazyComponentTypeId;
  /** Export name read from the lazily imported module. */
  readonly exportName: string;
  /** Starts loading the component chunk as an Effect and reuses the descriptor's in-flight owner. */
  preloadEffect(): Effect.Effect<Component, unknown>;
  /** Returns the loaded component, or throws a tagged pending/failure value for UI adapters. */
  read(): Component;
}

/** Error thrown by `Route.readComponent(...)` when a lazy route component is still loading. */
export class RouteLazyComponentPending extends Data.TaggedError("RouteLazyComponentPending")<{
  readonly exportName: string;
  readonly preloadEffect: Effect.Effect<unknown, unknown>;
}> {}

/** Error thrown by `Route.readComponent(...)` after a lazy route component load fails. */
export class RouteLazyComponentFailed extends Data.TaggedError("RouteLazyComponentFailed")<{
  readonly exportName: string;
  readonly cause: Cause.Cause<unknown>;
}> {}

export type RouteLazyComponentModule<Component, ExportName extends string = "default"> = {
  readonly [Key in ExportName]: Component;
};

const lazyRouteComponentMissingExport = (exportName: string): Error =>
  new Error(`Lazy route component module did not export ${JSON.stringify(exportName)}.`);

export function lazyRouteComponent<Component>(
  importer: Effect.Effect<RouteLazyComponentModule<Component>, unknown>,
): RouteLazyComponent<Component>;
export function lazyRouteComponent<const ExportName extends string, Component>(
  importer: Effect.Effect<RouteLazyComponentModule<Component, ExportName>, unknown>,
  exportName: ExportName,
): RouteLazyComponent<Component>;
export function lazyRouteComponent<Component>(
  importer: Effect.Effect<Record<string, Component>, unknown>,
  exportName = "default",
): RouteLazyComponent<Component> {
  let state: RouteLazyComponentState<Component> = { _tag: "Initial" };

  const loadEffect = Effect.exit(
    importer.pipe(
      Effect.flatMap((module) =>
        Effect.sync(() => {
          if (module === null || typeof module !== "object" || !(exportName in module)) {
            throw lazyRouteComponentMissingExport(exportName);
          }
          return Reflect.get(module, exportName) as Component;
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

  const startEffect = (): Effect.Effect<Component, unknown> =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkDetach(loadEffect, { startImmediately: true });
      if (state._tag === "Initial") {
        state = { _tag: "Pending", fiber };
      }
      return yield* Fiber.join(fiber);
    });

  const preloadEffect = (): Effect.Effect<Component, unknown> =>
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
    preloadEffect,
    read: () => {
      switch (state._tag) {
        case "Initial":
          throw new RouteLazyComponentPending({ exportName, preloadEffect: preloadEffect() });
        case "Pending":
          throw new RouteLazyComponentPending({
            exportName,
            preloadEffect: Fiber.join(state.fiber),
          });
        case "Success":
          return state.component;
        case "Failure":
          throw new RouteLazyComponentFailed({ exportName, cause: state.cause });
      }
    },
  };
}

export const isRouteLazyComponent = (value: unknown): value is RouteLazyComponent =>
  value !== null &&
  typeof value === "object" &&
  (value as { readonly [RouteLazyComponentTypeId]?: unknown })[RouteLazyComponentTypeId] ===
    RouteLazyComponentTypeId;

export const readRouteComponent = (component: unknown): unknown =>
  isRouteLazyComponent(component) ? component.read() : component;

export const routeLazyComponentPendingEffect = (
  value: unknown,
): Effect.Effect<unknown, unknown> | undefined =>
  value instanceof RouteLazyComponentPending ? value.preloadEffect : undefined;

/**
 * Route configuration with optional schema decoding and Effect-first preload work.
 *
 * `preload` can read resources or run Effects before navigation/render. Declare
 * preloadResources or preloadCollections when adapters need static preload hints.
 */
export interface RouteOptions<Path extends string, Params, Search, PreloadRequirements = never> {
  /** Optional schema that decodes path params after route matching. */
  readonly params?: AnySchema<Params>;
  /** Optional schema that decodes URL search values after route matching. */
  readonly search?: AnySchema<Search>;
  /** Effect-first work run before navigation/render. Promise returns are rejected. */
  readonly preload?: (
    context: RouteContext<RouteDefinition<Path, Params, Search, PreloadRequirements>>,
  ) => RoutePreloadResult<PreloadRequirements>;
  /** Static resource preload hints used by Start diagnostics and devtools. */
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  /** Static collection preload hints used by Start diagnostics and devtools. */
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
  /** Framework-owned component value attached by UI adapters. */
  readonly component?: unknown;
}

export interface RouteOptionsInput {
  readonly params?: AnySchema<unknown>;
  readonly search?: AnySchema<unknown>;
  readonly preload?: (context: any) => RoutePreloadResult<unknown>;
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
  readonly component?: unknown;
}

/** Runtime route object produced by `route`. */
export interface RouteDefinition<Path extends string, Params, Search, PreloadRequirements = never> {
  readonly path: Path;
  readonly options: RouteOptions<Path, Params, Search, PreloadRequirements>;
  /** Builds an href from typed path params and optional search values. */
  build(params: Params, search?: Partial<Search>): string;
  /**
   * Matches a URL and synchronously decodes params/search when schemas are present.
   *
   * Schema decode failures throw from this sync API. Use
   * `Route.planNavigationEffect(...)` when callers need typed
   * `RouteNavigationError` failures instead.
   */
  match(input: string | URL): RouteMatch<this> | undefined;
}

type ParamsFromOptions<Path extends string, Options> = Options extends {
  readonly params: infer Schema;
}
  ? SchemaType<Schema>
  : ParamsForPath<Path>;

type SearchFromOptions<Options> = Options extends { readonly search: infer Schema }
  ? SchemaType<Schema>
  : Record<string, never>;

type PreloadRequirementsFromOptions<Options> = Options extends {
  readonly preload: (...args: any) => infer Out;
}
  ? EffectInputRequirements<Out>
  : never;

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

export class RoutePreloadError extends Data.TaggedError("RoutePreloadError")<{
  readonly path: string;
  readonly href: string;
  readonly cause: unknown;
}> {}

export class RouteNavigationError extends Data.TaggedError("RouteNavigationError")<{
  readonly input: string;
  readonly cause: unknown;
}> {}

export type RoutePreloadPlanError = RoutePreloadError | ResourceSnapshotCodecError;

export type RouteNavigationPlanError = RouteNavigationError | RoutePreloadPlanError;

type CheckedRoutePreload<Options> = Options extends {
  readonly preload: (...args: infer Args) => infer Out;
}
  ? { readonly preload: (...args: Args) => EnsureEffectInput<Out> }
  : {};

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

const routePreloadError = (match: RouteMatch, cause: unknown): RoutePreloadError =>
  cause instanceof RoutePreloadError
    ? cause
    : new RoutePreloadError({
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

/**
 * Defines a typed route with path params, optional search decoding, and preload work.
 *
 * Params are inferred from `:param` segments unless a params schema is supplied.
 *
 * @example
 * ```ts
 * const userRoute = route("/users/:id", {
 *   preload: ({ params }) => Resource.prefetchEffect(UserResource(params.id))
 * });
 *
 * const href = userRoute.build({ id: "42" });
 * ```
 */
export function route<const Path extends string>(
  path: Path,
): RouteDefinition<Path, ParamsForPath<Path>, Record<string, never>>;
export function route<const Path extends string, const Options extends RouteOptionsInput>(
  path: Path,
  options: Options & CheckedRoutePreload<Options>,
): RouteDefinition<
  Path,
  ParamsFromOptions<Path, Options>,
  SearchFromOptions<Options>,
  PreloadRequirementsFromOptions<Options>
>;
export function route<const Path extends string, const Options extends RouteOptionsInput>(
  path: Path,
  options: Options & CheckedRoutePreload<Options> = {} as Options & CheckedRoutePreload<Options>,
): RouteDefinition<
  Path,
  ParamsFromOptions<Path, Options>,
  SearchFromOptions<Options>,
  PreloadRequirementsFromOptions<Options>
> {
  type Params = ParamsFromOptions<Path, Options>;
  type Search = SearchFromOptions<Options>;
  type PreloadRequirements = PreloadRequirementsFromOptions<Options>;

  const definition: RouteDefinition<Path, Params, Search, PreloadRequirements> = {
    path,
    options: options as RouteOptions<Path, Params, Search, PreloadRequirements>,
    build(params, search) {
      const record = params as Record<string, unknown>;
      const compiled = buildRoutePath(path, record);

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
        params: decode<Params>(options.params, params),
        search: decode<Search>(options.search, searchObject(url.searchParams)),
        pathname: url.pathname,
        href: `${url.pathname}${url.search}`,
      } as RouteMatch<typeof definition>;
    },
  };

  return definition;
}

/** Helpers for matching, building, and preloading route definitions. */
export namespace Route {
  export type Definition<
    Path extends string = string,
    Params = unknown,
    Search = unknown,
    PreloadRequirements = never,
  > = RouteDefinition<Path, Params, Search, PreloadRequirements>;

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
  export type PreloadError = RoutePreloadPlanError;

  export type NavigationError = RouteNavigationPlanError;

  export type Props<R> =
    R extends RouteDefinition<infer _Path, infer Params, infer Search, infer _PreloadRequirements>
      ? {
          readonly params: Params;
          readonly search: Search;
          readonly match: Match<R>;
        }
      : never;

  export type Component<R extends Definition<string, unknown, unknown, any>> = (
    props: Props<R>,
  ) => unknown;

  export type LazyComponent<ComponentValue = unknown> = RouteLazyComponent<ComponentValue>;

  export type LazyComponentModule<
    ComponentValue,
    ExportName extends string = "default",
  > = RouteLazyComponentModule<ComponentValue, ExportName>;

  export type ComponentInput<R extends Definition<string, unknown, unknown, any>> =
    | Component<R>
    | LazyComponent<Component<R>>;

  /** Creates a route component descriptor backed by a lazily imported module. */
  export const lazyComponent = lazyRouteComponent;

  /** Returns true when a route component is a lazy component descriptor. */
  export const isLazyComponent = isRouteLazyComponent;

  /** Reads a route component, throwing tagged lazy load states for UI adapters. */
  export const readComponent = readRouteComponent;

  /** Builds an href for a route from typed params and optional search values. */
  export const href = <R extends Definition<string, unknown, unknown, any>>(
    definition: R,
    ...args: HrefArgs<R>
  ): string => {
    const options = (args[0] ?? {}) as HrefOptions<R>;
    return definition.build((options.params ?? {}) as Params<R>, options.search);
  };

  export const withComponent = <
    R extends Definition<string, unknown, unknown, any>,
    RouteComponent extends ComponentInput<R>,
  >(
    definition: R,
    component: RouteComponent,
  ): Definition<R["path"], Params<R>, Search<R>, PreloadRequirements<R>> =>
    route(definition.path, {
      ...definition.options,
      component,
    }) as unknown as Definition<R["path"], Params<R>, Search<R>, PreloadRequirements<R>>;

  /**
   * Returns the first matching route for a URL, or undefined when none match.
   *
   * This sync helper delegates to each route's `match(...)`; schema-backed
   * params/search decode failures throw. Use `Route.planNavigationEffect(...)`
   * for an Effect-returning match path with typed `RouteNavigationError`
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
   * Effect-returning route matching for adapters that need typed navigation
   * failures instead of synchronous schema decode throws.
   */
  export const matchEffect = <
    const Routes extends readonly Definition<string, unknown, unknown, any>[],
  >(
    routes: Routes,
    input: string | URL,
  ): Effect.Effect<Match<Routes[number]> | undefined, RouteNavigationError> =>
    Effect.try({
      try: () => match(routes, input),
      catch: (cause) => routeNavigationError(input, cause),
    });

  /**
   * Runs a matched route's preload function as an Effect.
   *
   * Prefer this when composing preload with resources or server calls.
   */
  export const preloadEffect = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<void, RoutePreloadError, PreloadRequirements<R>> =>
    Effect.try({
      try: (): RoutePreloadResult<PreloadRequirements<R>> | undefined => {
        const preload = match.route.options.preload;
        return preload?.(match);
      },
      catch: (cause) => routePreloadError(match, cause),
    }).pipe(
      Effect.flatMap((input) =>
        input === undefined
          ? Effect.void
          : catchEffectInputPromiseDefect(
              `Route.preload(${match.route.path})`,
              toEffect(input as never) as Effect.Effect<void, unknown, PreloadRequirements<R>>,
            ).pipe(
              Effect.asVoid,
              Effect.mapError((cause) => routePreloadError(match, cause)),
            ),
      ),
    );

  export const preload = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<void, RoutePreloadError, PreloadRequirements<R>> => preloadEffect(match);

  /** Preloads a lazy route component chunk, when the route component is lazy. */
  export const preloadComponentEffect = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<void, RoutePreloadError> => {
    const component = match.route.options.component;
    if (!isRouteLazyComponent(component)) {
      return Effect.void;
    }

    return component.preloadEffect().pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.fail(routePreloadError(match, cause))),
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

  /** Runs matched route preload and captures touched resources for hydration. */
  export const planPreloadEffect = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<PreloadPlan<R>, RoutePreloadPlanError, PreloadRequirements<R>> =>
    collectResourceEffect(preloadEffect(match)).pipe(
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

  /** Alias for `planPreloadEffect`; kept Effect-first for adapters and tests. */
  export const planPreload = <R extends Definition<string, unknown, unknown, any>>(
    match: Match<R>,
  ): Effect.Effect<PreloadPlan<R>, RoutePreloadPlanError, PreloadRequirements<R>> =>
    planPreloadEffect(match);

  /**
   * Matches a URL and produces a navigation plan with collected resource hydration.
   *
   * Route preloads run inside Effect so adapters can await data and serialize only
   * resources touched during the preload.
   */
  export const planNavigationEffect = <
    const Routes extends readonly Definition<string, unknown, unknown, any>[],
  >(
    routes: Routes,
    input: string | URL,
  ): Effect.Effect<
    NavigationPlan<Routes[number]>,
    RouteNavigationPlanError,
    PreloadRequirements<Routes[number]>
  > =>
    Effect.try({
      try: () => hrefForRouteInput(input),
      catch: (cause) => routeNavigationError(input, cause),
    }).pipe(
      Effect.flatMap((href) =>
        matchEffect(routes, input).pipe(Effect.map((matched) => ({ href, matched }))),
      ),
      Effect.flatMap(
        ({
          href,
          matched,
        }): Effect.Effect<
          NavigationPlan<Routes[number]>,
          RouteNavigationPlanError,
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

          return planPreloadEffect(matched).pipe(
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

  export const planNavigation = <
    const Routes extends readonly Definition<string, unknown, unknown, any>[],
  >(
    routes: Routes,
    input: string | URL,
  ): Effect.Effect<
    NavigationPlan<Routes[number]>,
    RouteNavigationPlanError,
    PreloadRequirements<Routes[number]>
  > => planNavigationEffect(routes, input);
}
