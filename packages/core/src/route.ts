import { Effect, Schema } from "effect";
import type { EffectInput, EnsureEffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import {
  Resource,
  isResourceRef,
  type AnyResourceFamily,
  type AnyResourceRef,
  type ResourceHydrationPayload
} from "./resource.js";
import {
  buildRoutePath,
  hrefForRouteInput,
  matchRoutePath,
  parseRouteUrl,
  type ParamsForPath
} from "./route-grammar.js";

export type AnySchema<A = unknown> = {
  readonly Type?: A;
};

type SchemaType<S> = S extends { readonly Type: infer A } ? A : unknown;

export type RoutePreloadResourceInput =
  | string
  | AnyResourceFamily
  | AnyResourceRef
  | {
      readonly name: string;
    }
  | {
      readonly family: AnyResourceFamily;
    };

export type RoutePreloadCollectionInput =
  | string
  | {
      readonly name: string;
    };

export type RoutePreloadResourceStatus = "declared" | "none" | "unknown";

export interface RoutePreloadResourceDiagnostics {
  readonly status: RoutePreloadResourceStatus;
  readonly families: readonly string[];
}

export type RoutePreloadCollectionStatus = "declared" | "none" | "unknown";

export interface RoutePreloadCollectionDiagnostics {
  readonly status: RoutePreloadCollectionStatus;
  readonly collections: readonly string[];
}

/**
 * Route configuration with optional schema decoding and Effect-first preload work.
 *
 * `preload` can read resources or run Effects before navigation/render. Declare
 * preloadResources or preloadCollections when adapters need static preload hints.
 */
export interface RouteOptions<Path extends string, Params, Search> {
  readonly params?: AnySchema<Params>;
  readonly search?: AnySchema<Search>;
  readonly preload?: (context: RouteContext<RouteDefinition<Path, Params, Search>>) => EffectInput<unknown>;
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
  readonly component?: unknown;
}

export interface RouteOptionsInput {
  readonly params?: AnySchema<unknown>;
  readonly search?: AnySchema<unknown>;
  readonly preload?: (context: any) => EffectInput<unknown>;
  readonly preloadResources?: readonly RoutePreloadResourceInput[];
  readonly preloadCollections?: readonly RoutePreloadCollectionInput[];
  readonly component?: unknown;
}

/** Runtime route object produced by `route`. */
export interface RouteDefinition<Path extends string, Params, Search> {
  readonly path: Path;
  readonly options: RouteOptions<Path, Params, Search>;
  /** Builds an href from typed path params and optional search values. */
  build(params: Params, search?: Partial<Search>): string;
  /** Matches a URL and decodes params/search when schemas are present. */
  match(input: string | URL): RouteMatch<this> | undefined;
}

type ParamsFromOptions<Path extends string, Options> = Options extends { readonly params: infer Schema }
  ? SchemaType<Schema>
  : ParamsForPath<Path>;

type SearchFromOptions<Options> = Options extends { readonly search: infer Schema }
  ? SchemaType<Schema>
  : Record<string, never>;

export type RouteParams<R> = R extends RouteDefinition<infer _Path, infer Params, infer _Search> ? Params : never;

export type RouteSearch<R> = R extends RouteDefinition<infer _Path, infer _Params, infer Search> ? Search : never;

export type RouteContext<R extends RouteDefinition<string, unknown, unknown>> = {
  readonly route: R;
  readonly params: RouteParams<R>;
  readonly search: RouteSearch<R>;
  readonly pathname: string;
  readonly href: string;
};

export type RouteMatch<R extends RouteDefinition<string, unknown, unknown> = RouteDefinition<string, unknown, unknown>> =
  RouteContext<R>;

export interface RoutePreloadPlan<R extends RouteDefinition<string, unknown, unknown> = RouteDefinition<string, unknown, unknown>> {
  readonly match: RouteMatch<R>;
  readonly refs: ReadonlyArray<AnyResourceRef>;
  readonly resources: ResourceHydrationPayload;
}

export type RouteNavigationPlan<R extends RouteDefinition<string, unknown, unknown> = RouteDefinition<string, unknown, unknown>> =
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

export type RouteHrefOptions<R extends RouteDefinition<string, unknown, unknown>> = {
  readonly params: RouteParams<R>;
  readonly search?: Partial<RouteSearch<R>>;
};

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
  resources: readonly RoutePreloadResourceInput[]
): readonly string[] =>
  Array.from(
    new Set(resources.flatMap((resource) => {
      const name = resourceFamilyName(resource);
      return name === undefined ? [] : [name];
    }))
  ).sort();

const collectionName = (value: RoutePreloadCollectionInput): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  return isObjectLike(value) && typeof value.name === "string"
    ? value.name
    : undefined;
};

const uniqueSortedCollectionNames = (
  collections: readonly RoutePreloadCollectionInput[]
): readonly string[] =>
  Array.from(
    new Set(collections.flatMap((collection) => {
      const name = collectionName(collection);
      return name === undefined ? [] : [name];
    }))
  ).sort();

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
export const route = <const Path extends string, const Options extends RouteOptionsInput>(
  path: Path,
  options: Options & CheckedRoutePreload<Options>
): RouteDefinition<Path, ParamsFromOptions<Path, Options>, SearchFromOptions<Options>> => {
  type Params = ParamsFromOptions<Path, Options>;
  type Search = SearchFromOptions<Options>;

  const definition: RouteDefinition<Path, Params, Search> = {
    path,
    options: options as RouteOptions<Path, Params, Search>,
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
        href: `${url.pathname}${url.search}`
      } as RouteMatch<typeof definition>;
    }
  };

  return definition;
};

/** Helpers for matching, building, and preloading route definitions. */
export namespace Route {
  export type Definition<Path extends string = string, Params = unknown, Search = unknown> =
    RouteDefinition<Path, Params, Search>;

  export type Match<R extends Definition<string, unknown, unknown> = Definition<string, unknown, unknown>> =
    RouteMatch<R>;

  export type PreloadPlan<R extends Definition<string, unknown, unknown> = Definition<string, unknown, unknown>> =
    RoutePreloadPlan<R>;

  export type NavigationPlan<R extends Definition<string, unknown, unknown> = Definition<string, unknown, unknown>> =
    RouteNavigationPlan<R>;

  export type Context<R extends Definition<string, unknown, unknown>> = RouteContext<R>;

  export type Params<R> = RouteParams<R>;

  export type Search<R> = RouteSearch<R>;

  export type HrefOptions<R extends Definition<string, unknown, unknown>> = RouteHrefOptions<R>;

  export type PreloadResourceInput = RoutePreloadResourceInput;

  export type PreloadResourceDiagnostics = RoutePreloadResourceDiagnostics;

  export type PreloadCollectionInput = RoutePreloadCollectionInput;

  export type PreloadCollectionDiagnostics = RoutePreloadCollectionDiagnostics;

  export type Props<R> = R extends RouteDefinition<infer _Path, infer Params, infer Search>
    ? {
        readonly params: Params;
        readonly search: Search;
      }
    : never;

  /** Builds an href for a route from typed params and optional search values. */
  export const href = <R extends Definition<string, unknown, unknown>>(
    definition: R,
    options: HrefOptions<R>
  ): string => definition.build(options.params, options.search);

  export const withComponent = <R extends Definition<string, unknown, unknown>, Component>(
    definition: R,
    component: Component
  ): Definition<R["path"], Params<R>, Search<R>> =>
    route(definition.path, {
      ...definition.options,
      component
    }) as Definition<R["path"], Params<R>, Search<R>>;

  /** Returns the first matching route for a URL, or undefined when none match. */
  export const match = <const Routes extends readonly Definition<string, unknown, unknown>[]>(
    routes: Routes,
    input: string | URL
  ): Match<Routes[number]> | undefined => {
    for (const definition of routes) {
      const matched = definition.match(input);
      if (matched) {
        return matched as Match<Routes[number]>;
      }
    }

    return undefined;
  };

  /**
   * Runs a matched route's preload function as an Effect.
   *
   * Prefer this when composing preload with resources or server calls.
   */
  export const preloadEffect = <R extends Definition<string, unknown, unknown>>(
    match: Match<R>
  ): Effect.Effect<void, unknown> => {
    const preload = match.route.options.preload;
    if (!preload) {
      return Effect.void;
    }

    return toEffect(preload(match)).pipe(Effect.asVoid);
  };

  export const preload = <R extends Definition<string, unknown, unknown>>(
    match: Match<R>
  ): Effect.Effect<void, unknown> => preloadEffect(match);

  export const preloadResourceFamilies = <R extends Definition<string, unknown, unknown>>(
    definition: R
  ): readonly string[] =>
    uniqueSortedResourceFamilies(definition.options.preloadResources ?? []);

  export const preloadCollectionNames = <R extends Definition<string, unknown, unknown>>(
    definition: R
  ): readonly string[] =>
    uniqueSortedCollectionNames(definition.options.preloadCollections ?? []);

  export const describePreloadResources = <R extends Definition<string, unknown, unknown>>(
    definition: R
  ): RoutePreloadResourceDiagnostics => {
    if (definition.options.preloadResources !== undefined) {
      return {
        status: "declared",
        families: preloadResourceFamilies(definition)
      };
    }

    return definition.options.preload === undefined
      ? {
          status: "none",
          families: []
        }
      : {
          status: "unknown",
          families: []
        };
  };

  export const describePreloadCollections = <R extends Definition<string, unknown, unknown>>(
    definition: R
  ): RoutePreloadCollectionDiagnostics => {
    if (definition.options.preloadCollections !== undefined) {
      return {
        status: "declared",
        collections: preloadCollectionNames(definition)
      };
    }

    return definition.options.preload === undefined
      ? {
          status: "none",
          collections: []
        }
      : {
          status: "unknown",
          collections: []
        };
  };

  export const planPreloadEffect = <R extends Definition<string, unknown, unknown>>(
    match: Match<R>
  ): Effect.Effect<PreloadPlan<R>, unknown> =>
    Resource.collectEffect(preloadEffect(match)).pipe(
      Effect.flatMap((collected) =>
        Resource.hydrationPayloadEffect(collected.refs).pipe(
          Effect.map((resources) => ({
            match,
            refs: collected.refs,
            resources
          }))
        )
      )
    );

  export const planPreload = <R extends Definition<string, unknown, unknown>>(
    match: Match<R>
  ): Effect.Effect<PreloadPlan<R>, unknown> => planPreloadEffect(match);

  /**
   * Matches a URL and produces a navigation plan with collected resource hydration.
   *
   * Route preloads run inside Effect so adapters can await data and serialize only
   * resources touched during the preload.
   */
  export const planNavigationEffect = <const Routes extends readonly Definition<string, unknown, unknown>[]>(
    routes: Routes,
    input: string | URL
  ): Effect.Effect<NavigationPlan<Routes[number]>, unknown> => {
    const href = hrefForRouteInput(input);
    const matched = match(routes, input);
    if (!matched) {
      return Effect.succeed({
        _tag: "NotFound",
        href,
        match: undefined,
        refs: [],
        resources: { resources: [] }
      });
    }

    return planPreloadEffect(matched).pipe(
      Effect.map((plan) => ({
        _tag: "Matched" as const,
        href,
        match: plan.match,
        refs: plan.refs,
        resources: plan.resources
      }))
    );
  };

  export const planNavigation = <const Routes extends readonly Definition<string, unknown, unknown>[]>(
    routes: Routes,
    input: string | URL
  ): Effect.Effect<NavigationPlan<Routes[number]>, unknown> =>
    planNavigationEffect(routes, input);
}
