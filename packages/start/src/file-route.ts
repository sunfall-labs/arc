import {
  route,
  type CheckedRouteOptions,
  type RouteDefinitionFromOptions,
  type RouteOptionsInput,
} from "@sunfall/arc-core";

/** Route factory returned by `defineFileRoute(path)`. */
export type DefineFileRoute<Path extends string> = <const Options extends RouteOptionsInput>(
  options: CheckedRouteOptions<Options>,
) => RouteDefinitionFromOptions<Path, Options>;

/**
 * Defines a file-backed route with the same typed options as core `route`.
 *
 * Start checks `path` against the route module's discovered file path, so the
 * literal stays the single source of truth for params typing. Declare static
 * preload hints with `preloadResources` / `preloadCollections` and do the
 * runtime work in `preload`.
 *
 * @example
 * ```ts
 * export const Route = defineFileRoute("/projects/:id")({
 *   params: ProjectRouteParams,
 *   preloadResources: [ProjectById],
 *   preloadCollections: [ProjectSummaries],
 *   preload: ({ params }) => Resource.prefetchEffect(ProjectById(params.id)),
 * });
 * ```
 */
export const defineFileRoute =
  <const Path extends string>(path: Path): DefineFileRoute<Path> =>
  <const Options extends RouteOptionsInput>(options: CheckedRouteOptions<Options>) =>
    route<Path, Options>(path, options);
