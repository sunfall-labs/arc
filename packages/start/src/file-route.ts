import { route, type EnsureEffectInput, type RouteOptionsInput } from "@effect-ui/core";

type CheckedFileRoutePreload<Options> = Options extends {
  readonly preload: (...args: infer Args) => infer Out;
}
  ? { readonly preload: (...args: Args) => EnsureEffectInput<Out> }
  : {};

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
 * export const Route = defineFileRoute("/projects/:id")({
 *   preload: ({ params }) => ProjectResource(params.id),
 *   component: ProjectPage
 * });
 * ```
 */
export const defineFileRoute =
  <const Path extends string>(path: Path) =>
  <const Options extends RouteOptionsInput>(
    options: Options & CheckedFileRoutePreload<Options>
  ) =>
    route<Path, Options>(path, options);

/** Defines a file-route layout module. */
export const defineFileRouteLayout = <const Options>(
  options: Options
): FileRouteLayoutDefinition<Options> => ({
  _tag: "FileRouteLayout",
  options
});

/** Defines a file-route error boundary module. */
export const defineFileRouteErrorBoundary = <const Options>(
  options: Options
): FileRouteErrorBoundaryDefinition<Options> => ({
  _tag: "FileRouteErrorBoundary",
  options
});

/** Defines metadata attached to a file-route module. */
export const defineFileRouteMetadata = <const Options>(
  options: Options
): FileRouteMetadataDefinition<Options> => ({
  _tag: "FileRouteMetadata",
  options
});
