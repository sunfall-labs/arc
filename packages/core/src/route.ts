import { Data, Effect, Schema } from "effect";
import type { EffectInput, EnsureEffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import {
  Resource,
  isResourceRef,
  type AnyResourceRef,
  type ResourceFamily,
  type ResourceHydrationPayload
} from "./resource.js";
import { runPromise } from "./runtime.js";

export type AnySchema<A = unknown> = {
  readonly Type?: A;
};

type SchemaType<S> = S extends { readonly Type: infer A } ? A : unknown;

type StripParamName<S extends string> = S extends `${infer Name}?`
  ? Name
  : S extends `${infer Name}.${string}`
    ? Name
    : S;

type PathParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? StripParamName<Param> | PathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? StripParamName<Param>
      : never;

type IsOptionalParam<S extends string> = S extends `${string}?` ? true : false;

type OptionalPathParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? (IsOptionalParam<Param> extends true ? StripParamName<Param> : never) | OptionalPathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? IsOptionalParam<Param> extends true ? StripParamName<Param> : never
      : never;

type RequiredPathParamNames<Path extends string> = Exclude<
  PathParamNames<Path>,
  OptionalPathParamNames<Path>
>;

export type ParamsForPath<Path extends string> = [PathParamNames<Path>] extends [never]
  ? Record<string, never>
  : { readonly [K in RequiredPathParamNames<Path>]: string } &
    { readonly [K in OptionalPathParamNames<Path>]?: string };

export type RoutePreloadResourceInput =
  | string
  | ResourceFamily<any, any, any, any>
  | AnyResourceRef
  | {
      readonly name: string;
    }
  | {
      readonly family: ResourceFamily<any, any, any, any>;
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

export interface RouteDefinition<Path extends string, Params, Search> {
  readonly path: Path;
  readonly options: RouteOptions<Path, Params, Search>;
  build(params: Params, search?: Partial<Search>): string;
  match(input: string | URL): RouteMatch<this> | undefined;
}

type ParamsFromOptions<Path extends string, Options> = Options extends { readonly params: infer Schema }
  ? SchemaType<Schema>
  : ParamsForPath<Path>;

type SearchFromOptions<Options> = Options extends { readonly search: infer Schema }
  ? SchemaType<Schema>
  : Record<string, never>;

export type RouteParams<R> = R extends RouteDefinition<string, infer Params, any> ? Params : never;

export type RouteSearch<R> = R extends RouteDefinition<string, any, infer Search> ? Search : never;

export type RouteContext<R extends RouteDefinition<string, any, any>> = {
  readonly route: R;
  readonly params: RouteParams<R>;
  readonly search: RouteSearch<R>;
  readonly pathname: string;
  readonly href: string;
};

export type RouteMatch<R extends RouteDefinition<string, any, any> = RouteDefinition<string, any, any>> =
  RouteContext<R>;

export interface RoutePreloadPlan<R extends RouteDefinition<string, any, any> = RouteDefinition<string, any, any>> {
  readonly match: RouteMatch<R>;
  readonly refs: ReadonlyArray<AnyResourceRef>;
  readonly resources: ResourceHydrationPayload;
}

export type RouteNavigationPlan<R extends RouteDefinition<string, any, any> = RouteDefinition<string, any, any>> =
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

export type RouteHrefOptions<R extends RouteDefinition<string, any, any>> = {
  readonly params: RouteParams<R>;
  readonly search?: Partial<RouteSearch<R>>;
};

type CheckedRoutePreload<Options> = Options extends {
  readonly preload: (...args: infer Args) => infer Out;
}
  ? { readonly preload: (...args: Args) => EnsureEffectInput<Out> }
  : {};

type PathPart =
  | { readonly _tag: "Static"; readonly value: string }
  | { readonly _tag: "Param"; readonly name: string; readonly optional: boolean };

export class MissingRouteParam extends Data.TaggedError("MissingRouteParam")<{
  readonly route: string;
  readonly param: string;
}> {}

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

const parseUrl = (input: string | URL): URL => {
  if (input instanceof URL) {
    return input;
  }

  return new URL(input, "http://effect-ui.local");
};

const hrefForInput = (input: string | URL): string => {
  const url = parseUrl(input);
  return `${url.pathname}${url.search}`;
};

const splitPath = (path: string): ReadonlyArray<string> =>
  path.split("/").filter((part) => part.length > 0);

const pathParts = (path: string): ReadonlyArray<PathPart> =>
  splitPath(path).map((part) =>
    part.startsWith(":")
      ? {
          _tag: "Param",
          name: stripParamNameRuntime(part.slice(1)),
          optional: isOptionalParamRuntime(part.slice(1))
        }
      : {
          _tag: "Static",
          value: part
        }
  );

const isOptionalParamRuntime = (name: string): boolean => {
  const dot = name.indexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return base.endsWith("?");
};

const stripParamNameRuntime = (name: string): string => {
  const dot = name.indexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return base.endsWith("?") ? base.slice(0, -1) : base;
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

const matchPath = (
  pattern: string,
  pathname: string
): Record<string, string> | undefined => {
  const patternParts = pathParts(pattern);
  const currentParts = splitPath(pathname);

  const match = (
    patternIndex: number,
    currentIndex: number,
    params: Record<string, string>
  ): Record<string, string> | undefined => {
    if (patternIndex === patternParts.length) {
      return currentIndex === currentParts.length ? params : undefined;
    }

    const patternPart = patternParts[patternIndex];
    const currentPart = currentParts[currentIndex];

    if (!patternPart) {
      return undefined;
    }

    if (patternPart._tag === "Static") {
      return currentPart === patternPart.value
        ? match(patternIndex + 1, currentIndex + 1, params)
        : undefined;
    }

    if (currentPart !== undefined) {
      const consumed = match(patternIndex + 1, currentIndex + 1, {
        ...params,
        [patternPart.name]: decodeURIComponent(currentPart)
      });
      if (consumed) {
        return consumed;
      }
    }

    return patternPart.optional
      ? match(patternIndex + 1, currentIndex, params)
      : undefined;
  };

  return match(0, 0, {});
};

const buildPath = (path: string, params: Record<string, unknown>): string => {
  const parts = pathParts(path).flatMap((part) => {
    if (part._tag === "Static") {
      return [part.value];
    }

    const value = params[part.name];
    if (value === undefined || value === null) {
      if (part.optional) {
        return [];
      }
      throw new MissingRouteParam({ route: path, param: part.name });
    }

    return [encodeURIComponent(String(value))];
  });

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
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
      const compiled = buildPath(path, record);

      return appendSearch(compiled, search as Record<string, unknown> | undefined);
    },
    match(input) {
      const url = parseUrl(input);
      const params = matchPath(path, url.pathname);
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

export namespace Route {
  export type Definition<Path extends string = string, Params = unknown, Search = unknown> =
    RouteDefinition<Path, Params, Search>;

  export type Match<R extends Definition<string, any, any> = Definition<string, any, any>> =
    RouteMatch<R>;

  export type PreloadPlan<R extends Definition<string, any, any> = Definition<string, any, any>> =
    RoutePreloadPlan<R>;

  export type NavigationPlan<R extends Definition<string, any, any> = Definition<string, any, any>> =
    RouteNavigationPlan<R>;

  export type Context<R extends Definition<string, any, any>> = RouteContext<R>;

  export type Params<R> = RouteParams<R>;

  export type Search<R> = RouteSearch<R>;

  export type HrefOptions<R extends Definition<string, any, any>> = RouteHrefOptions<R>;

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

  export const href = <R extends Definition<string, any, any>>(
    definition: R,
    options: HrefOptions<R>
  ): string => definition.build(options.params, options.search);

  export const withComponent = <R extends Definition<string, any, any>, Component>(
    definition: R,
    component: Component
  ): Definition<R["path"], Params<R>, Search<R>> =>
    route(definition.path, {
      ...definition.options,
      component
    }) as Definition<R["path"], Params<R>, Search<R>>;

  export const match = <const Routes extends readonly Definition<string, any, any>[]>(
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

  export const preloadEffect = <R extends Definition<string, any, any>>(
    match: Match<R>
  ): Effect.Effect<void, unknown> => {
    const preload = match.route.options.preload;
    if (!preload) {
      return Effect.void;
    }

    return toEffect(preload(match)).pipe(Effect.asVoid);
  };

  export const preload = <R extends Definition<string, any, any>>(
    match: Match<R>
  ): Promise<void> => runPromise(preloadEffect(match));

  export const preloadResourceFamilies = <R extends Definition<string, any, any>>(
    definition: R
  ): readonly string[] =>
    uniqueSortedResourceFamilies(definition.options.preloadResources ?? []);

  export const preloadCollectionNames = <R extends Definition<string, any, any>>(
    definition: R
  ): readonly string[] =>
    uniqueSortedCollectionNames(definition.options.preloadCollections ?? []);

  export const describePreloadResources = <R extends Definition<string, any, any>>(
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

  export const describePreloadCollections = <R extends Definition<string, any, any>>(
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

  export const planPreloadEffect = <R extends Definition<string, any, any>>(
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

  export const planPreload = <R extends Definition<string, any, any>>(
    match: Match<R>
  ): Promise<PreloadPlan<R>> => runPromise(planPreloadEffect(match));

  export const planNavigationEffect = <const Routes extends readonly Definition<string, any, any>[]>(
    routes: Routes,
    input: string | URL
  ): Effect.Effect<NavigationPlan<Routes[number]>, unknown> => {
    const href = hrefForInput(input);
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

  export const planNavigation = <const Routes extends readonly Definition<string, any, any>[]>(
    routes: Routes,
    input: string | URL
  ): Promise<NavigationPlan<Routes[number]>> => runPromise(planNavigationEffect(routes, input));
}
