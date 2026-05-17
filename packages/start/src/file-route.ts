import {
  Resource,
  isPromiseLikeValue,
  route,
  toEffect,
  type EffectInputRequirements,
  type EnsureEffectInput,
  type ParamsForPath,
  type Route,
  type RouteOptionsInput,
} from "@effect-ui/core";
import { Collection, type AnyCollection } from "@effect-ui/db";
import { Data, Effect } from "effect";

type CheckedFileRoutePreload<Options> = Options extends {
  readonly preload: (...args: infer Args) => infer Out;
}
  ? { readonly preload: (...args: Args) => EnsureEffectInput<Out> }
  : {};

type SchemaType<S> = S extends { readonly Type: infer A } ? A : unknown;

type FileRouteOptionsParams<Options, Fallback> = Options extends { readonly params: infer Schema }
  ? SchemaType<Schema>
  : Fallback;

type FileRouteOptionsSearch<Options, Fallback> = Options extends { readonly search: infer Schema }
  ? SchemaType<Schema>
  : Fallback;

type FileRouteContext<Path extends string, Params, Search> = Route.Context<
  Route.Definition<Path, Params, Search, any>
>;

type ResourceRefFactory = ((input: any) => unknown) & {
  readonly family: {
    readonly options: {
      readonly name: string;
    };
  };
};

type ResourceInput<F extends ResourceRefFactory> = Parameters<F>[0];

type ResourceRefFromFactory<F extends ResourceRefFactory> =
  ReturnType<F> extends Resource.Ref<any, any, any, any> ? ReturnType<F> : never;

type ResourceRefRequirements<Ref> = Ref extends Resource.AnyRef<infer R> ? R : never;

type ResourcePreloadRequirements<Resources> = Resources extends readonly FileRoutePreloadResource<
  any,
  infer Ref,
  any,
  any
>[]
  ? ResourceRefRequirements<Ref>
  : never;

type CollectionPreloadRequirements<Collections> =
  Collections extends readonly (infer CollectionInput)[]
    ? CollectionInput extends AnyCollection<any, infer R>
      ? R
      : never
    : never;

type FileRoutePreloadRequirements<Options> =
  | ResourcePreloadRequirements<
      Options extends { readonly resources: infer Resources } ? Resources : never
    >
  | CollectionPreloadRequirements<
      Options extends { readonly collections: infer Collections } ? Collections : never
    >;

/**
 * Route options accepted by `defineFileRoute(path).preload(...).route(...)`.
 *
 * Preload-owned fields are intentionally omitted so schemas, declared preload
 * resources, declared collections, and preload requirements stay attached to
 * the builder output.
 */
export type FileRoutePreloadRouteOptions = Omit<
  RouteOptionsInput,
  "params" | "search" | "preload" | "preloadResources" | "preloadCollections"
>;

type FileRoutePreloadDefinition<Path extends string, Params, Search, Requirements> = {
  readonly preloadResources: readonly Route.PreloadResourceInput[];
  readonly preloadCollections: readonly Route.PreloadCollectionInput[];
  readonly preload: (
    context: FileRouteContext<Path, Params, Search>,
  ) => Effect.Effect<void, never, Requirements>;
  readonly route: <const Options extends FileRoutePreloadRouteOptions = {}>(
    options?: Options,
  ) => Route.Definition<Path, Params, Search, Requirements>;
};

/** Resource preload selected from a file-route context with static family metadata attached. */
export interface FileRoutePreloadResource<
  Path extends string = string,
  Ref extends Resource.AnyRef<any> = Resource.AnyRef<any>,
  Params = unknown,
  Search = unknown,
> {
  readonly family: Route.PreloadResourceInput;
  readonly refs: (context: FileRouteContext<Path, Params, Search>) => readonly Ref[];
}

/** Options accepted by `defineFileRoute(...).preload(...)`. */
export interface FileRoutePreloadOptions<
  Path extends string = string,
  Params = unknown,
  Search = unknown,
> {
  /** Resource selectors to declare in metadata and prefetch during route preload. */
  readonly resources?: readonly FileRoutePreloadResource<
    Path,
    Resource.AnyRef<any>,
    Params,
    Search
  >[];
  /** Concrete collections or stable collection names to declare in route preload metadata. */
  readonly collections?: readonly Route.PreloadCollectionInput[];
}

type FileRouteResourceHelper<Path extends string, Params, Search> = <
  const Family extends ResourceRefFactory,
>(
  family: Family,
  input: (context: FileRouteContext<Path, Params, Search>) => ResourceInput<Family>,
) => FileRoutePreloadResource<Path, ResourceRefFromFactory<Family>, Params, Search>;

/** Error raised by the file-route preload helper before core wraps it as a route preload failure. */
export class FileRoutePreloadError extends Data.TaggedError("FileRoutePreloadError")<{
  readonly path: string;
  readonly operation: "resource-selector" | "custom-preload";
  readonly cause: unknown;
  readonly guidance: string;
}> {}

const fileRoutePreloadError = (
  path: string,
  operation: FileRoutePreloadError["operation"],
  cause: unknown,
  guidance: string,
): FileRoutePreloadError => new FileRoutePreloadError({ path, operation, cause, guidance });

const fileRouteResourceSelectorGuidance =
  "File route resource selectors must return an array of Resource refs synchronously. Move async work into the resource loader with Effect.tryPromise(...).";

const resourcePreloadEffect = <Path extends string>(
  path: Path,
  resource: FileRoutePreloadResource<Path, Resource.AnyRef<any>, unknown, unknown>,
  context: FileRouteContext<Path, unknown, unknown>,
): Effect.Effect<void, unknown, unknown> =>
  Effect.flatMap(
    Effect.try({
      try: () => {
        const refs = resource.refs(context);
        if (isPromiseLikeValue(refs)) {
          throw fileRoutePreloadError(
            path,
            "resource-selector",
            refs,
            fileRouteResourceSelectorGuidance,
          );
        }
        if (!Array.isArray(refs)) {
          throw fileRoutePreloadError(
            path,
            "resource-selector",
            new TypeError("File route resource selectors must return an array of Resource refs."),
            fileRouteResourceSelectorGuidance,
          );
        }
        return refs;
      },
      catch: (cause) =>
        cause instanceof FileRoutePreloadError
          ? cause
          : fileRoutePreloadError(
              path,
              "resource-selector",
              cause,
              fileRouteResourceSelectorGuidance,
            ),
    }),
    (refs) => Effect.all(refs.map((ref) => Resource.prefetchEffect(ref))).pipe(Effect.asVoid),
  );

const customPreloadEffect = <Path extends string>(
  path: Path,
  preload: (context: FileRouteContext<Path, unknown, unknown>) => unknown,
  context: FileRouteContext<Path, unknown, unknown>,
): Effect.Effect<void, unknown, unknown> =>
  Effect.flatMap(
    Effect.try({
      try: () => preload(context),
      catch: (cause) =>
        fileRoutePreloadError(
          path,
          "custom-preload",
          cause,
          "File route preload callbacks must return a value or Effect. Synchronous throws are reported through RoutePreloadError.",
        ),
    }),
    (input) => {
      if (isPromiseLikeValue(input)) {
        return Effect.fail(
          fileRoutePreloadError(
            path,
            "custom-preload",
            undefined,
            "File route preload callbacks must return an Effect, not a Promise. Wrap host Promise work with Effect.tryPromise(...) at the preload Adapter seam.",
          ),
        );
      }

      return toEffect(input as never).pipe(Effect.asVoid);
    },
  );

/** Builder returned from `defineFileRoute(path)` with preload ergonomics helpers. */
export interface DefineFileRouteBuilder<Path extends string> {
  <const Options extends RouteOptionsInput>(
    options: Options & CheckedFileRoutePreload<Options>,
  ): Route.Definition<
    Path,
    FileRouteOptionsParams<Options, ParamsForPath<Path>>,
    FileRouteOptionsSearch<Options, Record<string, never>>,
    Options extends { readonly preload: (...args: any) => infer Out }
      ? EffectInputRequirements<Out>
      : never
  >;
  /**
   * Declares one static resource preload hint from typed route params/search.
   *
   * The returned descriptor is consumed by `.preload(...)` so Start diagnostics,
   * manifest generation, and devtools can name the resource family without
   * executing the route preload.
   */
  readonly resource: <const Family extends ResourceRefFactory>(
    family: Family,
    input: (
      context: FileRouteContext<Path, ParamsForPath<Path>, Record<string, never>>,
    ) => ResourceInput<Family>,
  ) => FileRoutePreloadResource<
    Path,
    ResourceRefFromFactory<Family>,
    ParamsForPath<Path>,
    Record<string, never>
  >;
  /**
   * Attaches declared resources/collections and optional custom Effect preload.
   *
   * Resource and collection declarations are static metadata for Start and
   * tooling; the preload callback is the Effect-first runtime work that may use
   * services, fail in its error channel, or be interrupted by the route owner.
   */
  readonly preload: {
    <
      const Resources extends
        | readonly FileRoutePreloadResource<
            Path,
            Resource.AnyRef<any>,
            ParamsForPath<Path>,
            Record<string, never>
          >[]
        | undefined = undefined,
      const Collections extends readonly Route.PreloadCollectionInput[] | undefined = undefined,
    >(options: {
      readonly resources?: Resources;
      readonly collections?: Collections;
    }): FileRoutePreloadDefinition<
      Path,
      ParamsForPath<Path>,
      Record<string, never>,
      ResourcePreloadRequirements<Resources> | CollectionPreloadRequirements<Collections>
    >;
    <
      const Resources extends
        | readonly FileRoutePreloadResource<
            Path,
            Resource.AnyRef<any>,
            ParamsForPath<Path>,
            Record<string, never>
          >[]
        | undefined = undefined,
      const Collections extends readonly Route.PreloadCollectionInput[] | undefined = undefined,
      Out = unknown,
    >(
      options: {
        readonly resources?: Resources;
        readonly collections?: Collections;
      },
      preload: (
        context: FileRouteContext<Path, ParamsForPath<Path>, Record<string, never>>,
      ) => EnsureEffectInput<Out>,
    ): FileRoutePreloadDefinition<
      Path,
      ParamsForPath<Path>,
      Record<string, never>,
      | ResourcePreloadRequirements<Resources>
      | CollectionPreloadRequirements<Collections>
      | EffectInputRequirements<Out>
    >;
    <
      const ParamsSchema extends NonNullable<RouteOptionsInput["params"]>,
      const SearchSchema extends NonNullable<RouteOptionsInput["search"]>,
      const Resources extends
        | readonly FileRoutePreloadResource<
            Path,
            Resource.AnyRef<any>,
            SchemaType<ParamsSchema>,
            SchemaType<SearchSchema>
          >[]
        | undefined = undefined,
      const Collections extends readonly Route.PreloadCollectionInput[] | undefined = undefined,
      Out = unknown,
    >(
      options: {
        readonly params: ParamsSchema;
        readonly search: SearchSchema;
        readonly resources?: (helpers: {
          readonly resource: FileRouteResourceHelper<
            Path,
            SchemaType<ParamsSchema>,
            SchemaType<SearchSchema>
          >;
        }) => Resources;
        readonly collections?: Collections;
      },
      preload?: (
        context: FileRouteContext<Path, SchemaType<ParamsSchema>, SchemaType<SearchSchema>>,
      ) => EnsureEffectInput<Out>,
    ): {
      readonly params: ParamsSchema;
      readonly search: SearchSchema;
    } & FileRoutePreloadDefinition<
      Path,
      SchemaType<ParamsSchema>,
      SchemaType<SearchSchema>,
      | ResourcePreloadRequirements<Resources>
      | CollectionPreloadRequirements<Collections>
      | EffectInputRequirements<Out>
    >;
    <
      const ParamsSchema extends NonNullable<RouteOptionsInput["params"]>,
      const Resources extends
        | readonly FileRoutePreloadResource<
            Path,
            Resource.AnyRef<any>,
            SchemaType<ParamsSchema>,
            Record<string, never>
          >[]
        | undefined = undefined,
      const Collections extends readonly Route.PreloadCollectionInput[] | undefined = undefined,
      Out = unknown,
    >(
      options: {
        readonly params: ParamsSchema;
        readonly resources?: (helpers: {
          readonly resource: FileRouteResourceHelper<
            Path,
            SchemaType<ParamsSchema>,
            Record<string, never>
          >;
        }) => Resources;
        readonly collections?: Collections;
      },
      preload?: (
        context: FileRouteContext<Path, SchemaType<ParamsSchema>, Record<string, never>>,
      ) => EnsureEffectInput<Out>,
    ): {
      readonly params: ParamsSchema;
    } & FileRoutePreloadDefinition<
      Path,
      SchemaType<ParamsSchema>,
      Record<string, never>,
      | ResourcePreloadRequirements<Resources>
      | CollectionPreloadRequirements<Collections>
      | EffectInputRequirements<Out>
    >;
  };
}

const makeDefineFileRouteBuilder = <const Path extends string>(
  path: Path,
): DefineFileRouteBuilder<Path> => {
  const builder = (<const Options extends RouteOptionsInput>(
    options: Options & CheckedFileRoutePreload<Options>,
  ) => route<Path, Options>(path, options)) as DefineFileRouteBuilder<Path>;

  const makeResource = <const Family extends ResourceRefFactory>(
    family: Family,
    input: (context: FileRouteContext<Path, unknown, unknown>) => ResourceInput<Family>,
  ): FileRoutePreloadResource<Path, ResourceRefFromFactory<Family>, unknown, unknown> => ({
    family: { name: family.family.options.name },
    refs: (context) => {
      const selectedInput = input(context);
      if (isPromiseLikeValue(selectedInput)) {
        throw fileRoutePreloadError(
          path,
          "resource-selector",
          undefined,
          "File route resource selectors must return resource input synchronously, not a Promise. Move async work into the resource loader with Effect.tryPromise(...).",
        );
      }

      return [family(selectedInput) as ResourceRefFromFactory<Family>];
    },
  });

  Object.defineProperties(builder, {
    resource: {
      enumerable: true,
      value: makeResource,
    },
    preload: {
      enumerable: true,
      value: <
        const Options extends FileRoutePreloadOptions<Path, unknown, unknown> &
          Record<string, unknown>,
      >(
        options: Options,
        preload?: (context: FileRouteContext<Path, unknown, unknown>) => unknown,
      ) => {
        const {
          resources: resourceInput,
          collections,
          ...routeOptions
        } = options as Options & {
          readonly resources?:
            | readonly FileRoutePreloadResource<Path, Resource.AnyRef<any>, unknown, unknown>[]
            | ((helpers: {
                readonly resource: typeof makeResource;
              }) => readonly FileRoutePreloadResource<
                Path,
                Resource.AnyRef<any>,
                unknown,
                unknown
              >[]);
          readonly collections?: readonly Route.PreloadCollectionInput[];
        };
        const resources =
          typeof resourceInput === "function"
            ? resourceInput({ resource: makeResource })
            : resourceInput;

        const definition = {
          ...routeOptions,
          preloadResources: (resources ?? []).map((resource) => resource.family),
          preloadCollections: collections ?? [],
          preload: (context: FileRouteContext<Path, unknown, unknown>) => {
            const effects: Array<Effect.Effect<unknown, unknown, unknown>> = [];
            for (const resource of resources ?? []) {
              effects.push(resourcePreloadEffect(path, resource, context));
            }
            for (const collection of collections ?? []) {
              if (Collection.isCollection(collection)) {
                effects.push(collection.preloadEffect());
              }
            }
            if (preload) {
              effects.push(customPreloadEffect(path, preload, context));
            }

            return Effect.all(effects).pipe(Effect.asVoid) as Effect.Effect<
              void,
              never,
              FileRoutePreloadRequirements<Options>
            >;
          },
        };
        Object.defineProperty(definition, "route", {
          enumerable: false,
          value: <const RouteOptions extends FileRoutePreloadRouteOptions = {}>(
            routeDefinitionOptions: RouteOptions = {} as RouteOptions,
          ) =>
            route(path, {
              ...definition,
              ...routeDefinitionOptions,
            } as RouteOptionsInput),
        });

        return definition;
      },
    },
  });

  return builder;
};

/** File-route module marker for a layout that wraps child route components. */
export interface FileRouteLayoutDefinition<Options = unknown> {
  readonly _tag: "FileRouteLayout";
  readonly options: Options;
}

/** File-route module marker for rendering matched route failures. */
export interface FileRouteErrorBoundaryDefinition<Options = unknown> {
  readonly _tag: "FileRouteErrorBoundary";
  readonly options: Options;
}

/** File-route module marker for route metadata exports. */
export interface FileRouteMetadataDefinition<Options = unknown> {
  readonly _tag: "FileRouteMetadata";
  readonly options: Options;
}

/**
 * Defines a file-backed route with the same typed options as core `route`.
 *
 * Use this in route modules generated or discovered by Start. Route `preload`
 * may return any Effect-compatible input; Effect values compose with the
 * request runtime during SSR preload.
 *
 * @example
 * ```ts
 * const RouteBuilder = defineFileRoute("/projects/:id");
 *
 * export const Route = RouteBuilder.preload({
 *   params: ProjectRouteParams,
 *   search: ProjectRouteSearch,
 *   resources: ({ resource }) => [
 *     resource(ProjectById, ({ params }) => params.id)
 *   ],
 *   collections: [ProjectSummaries]
 * }).route({
 *   component: ProjectPage
 * });
 * ```
 */
export const defineFileRoute = <const Path extends string>(path: Path) =>
  makeDefineFileRouteBuilder(path);

/** Defines a file-route layout module. */
export const defineFileRouteLayout = <const Options>(
  options: Options,
): FileRouteLayoutDefinition<Options> => ({
  _tag: "FileRouteLayout",
  options,
});

/** Defines a file-route error boundary module. */
export const defineFileRouteErrorBoundary = <const Options>(
  options: Options,
): FileRouteErrorBoundaryDefinition<Options> => ({
  _tag: "FileRouteErrorBoundary",
  options,
});

/** Defines metadata attached to a file-route module. */
export const defineFileRouteMetadata = <const Options>(
  options: Options,
): FileRouteMetadataDefinition<Options> => ({
  _tag: "FileRouteMetadata",
  options,
});
