import {
  type CheckedRouteOptions,
  type RouteDefinitionFromOptions,
  type RouteOptionsInput,
  Route,
} from "@sunfall/arc-core";

/**
 * File-backed route definitions.
 *
 * A file route module exports its definition as `Route`, so it cannot also
 * import Core's `Route` namespace; `FileRoute.define` is its definition
 * constructor.
 */
export namespace FileRoute {
  /** Route factory returned by `FileRoute.define(path)`. */
  export type Factory<Path extends string> = <const Options extends RouteOptionsInput>(
    options: CheckedRouteOptions<Options>,
  ) => RouteDefinitionFromOptions<Path, Options>;

  /**
   * Defines a file-backed route with the same typed options as
   * `Route.define(path, options)`.
   *
   * Start checks `path` against the route module's discovered file path, so the
   * literal stays the single source of truth for params typing. Declare static
   * preload hints with `preloadResources` / `preloadCollections` and do the
   * runtime work in `preload`.
   *
   * @example
   * ```ts
   * export const Route = FileRoute.define("/projects/:id")({
   *   params: ProjectRouteParams,
   *   preloadResources: [ProjectById],
   *   preloadCollections: [ProjectSummaries],
   *   preload: ({ params }) => Resource.preload(ProjectById(params.id)),
   * });
   * ```
   */
  export const define =
    <const Path extends string>(path: Path): Factory<Path> =>
    <const Options extends RouteOptionsInput>(options: CheckedRouteOptions<Options>) =>
      Route.define<Path, Options>(path, options);
}
