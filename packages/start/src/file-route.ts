import { route, type EnsureEffectInput, type RouteOptionsInput } from "@effect-ui/core";

type CheckedFileRoutePreload<Options> = Options extends {
  readonly preload: (...args: infer Args) => infer Out;
}
  ? { readonly preload: (...args: Args) => EnsureEffectInput<Out> }
  : {};

export interface FileRouteLayoutDefinition<Options = unknown> {
  readonly _tag: "FileRouteLayout";
  readonly options: Options;
}

export interface FileRouteErrorBoundaryDefinition<Options = unknown> {
  readonly _tag: "FileRouteErrorBoundary";
  readonly options: Options;
}

export interface FileRouteMetadataDefinition<Options = unknown> {
  readonly _tag: "FileRouteMetadata";
  readonly options: Options;
}

export const defineFileRoute =
  <const Path extends string>(path: Path) =>
  <const Options extends RouteOptionsInput>(
    options: Options & CheckedFileRoutePreload<Options>
  ) =>
    route<Path, Options>(path, options);

export const defineFileRouteLayout = <const Options>(
  options: Options
): FileRouteLayoutDefinition<Options> => ({
  _tag: "FileRouteLayout",
  options
});

export const defineFileRouteErrorBoundary = <const Options>(
  options: Options
): FileRouteErrorBoundaryDefinition<Options> => ({
  _tag: "FileRouteErrorBoundary",
  options
});

export const defineFileRouteMetadata = <const Options>(
  options: Options
): FileRouteMetadataDefinition<Options> => ({
  _tag: "FileRouteMetadata",
  options
});
