import { Effect } from "effect";
import type { FileRouteManifestError } from "./file-routes.js";
import {
  createFileRouteDefinitionsModule,
  type FileRouteDefinitionsModuleError,
} from "./file-route-modules.js";
import { makeStartFileRouteManifest, type SunfallArcStartOptions } from "./start-manifest-wall.js";

/** Vite virtual module id for the generated file route manifest. */
export const fileRouteManifestVirtualModuleId = "virtual:sunfall-arc/file-routes";
/** Vite virtual module id for generated file route definitions. */
export const fileRouteDefinitionsVirtualModuleId = "virtual:sunfall-arc/routes";

const resolvedFileRouteManifestVirtualModuleId = `\0${fileRouteManifestVirtualModuleId}`;
const resolvedFileRouteDefinitionsVirtualModuleId = `\0${fileRouteDefinitionsVirtualModuleId}`;

export type StartVirtualModuleLoadError = FileRouteManifestError | FileRouteDefinitionsModuleError;

export const resolveStartVirtualModuleId = (id: string): string | null =>
  id === fileRouteManifestVirtualModuleId
    ? resolvedFileRouteManifestVirtualModuleId
    : id === fileRouteDefinitionsVirtualModuleId
      ? resolvedFileRouteDefinitionsVirtualModuleId
      : null;

export const loadStartVirtualModule = (
  id: string,
  options: SunfallArcStartOptions = {},
): Effect.Effect<string | null, StartVirtualModuleLoadError> => {
  switch (id) {
    case resolvedFileRouteManifestVirtualModuleId:
      return Effect.map(makeStartFileRouteManifest(options), (manifest) =>
        [
          `export const manifest = ${JSON.stringify(manifest)};`,
          "export const entries = manifest.entries;",
          "export const modules = manifest.modules;",
          "export default manifest;",
        ].join("\n"),
      );
    case resolvedFileRouteDefinitionsVirtualModuleId:
      return Effect.flatMap(makeStartFileRouteManifest(options), (manifest) =>
        createFileRouteDefinitionsModule(manifest, { importMode: "rootAbsolute" }),
      );
    default:
      return Effect.succeed(null);
  }
};
