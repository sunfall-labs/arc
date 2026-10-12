import { Effect } from "effect";
import {
  serializeFileRouteManifest,
  type FileRouteManifest,
  type FileRouteManifestError,
} from "./file-routes.js";
import {
  createFileRouteDefinitionsModule,
  isFileRouteDefinitionsModuleError,
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

export const resolveStartVirtualModuleId = (id: string): string | null => {
  switch (id) {
    case fileRouteManifestVirtualModuleId:
      return resolvedFileRouteManifestVirtualModuleId;
    case fileRouteDefinitionsVirtualModuleId:
      return resolvedFileRouteDefinitionsVirtualModuleId;
    default:
      return null;
  }
};

/** Creates the Vite virtual module source for the file-route manifest. */
export const createFileRouteManifestVirtualModule = (manifest: FileRouteManifest): string => {
  const serialized = serializeFileRouteManifest(manifest);
  return [
    `export const manifest = ${serialized};`,
    "export const entries = manifest.entries;",
    "export const modules = manifest.modules;",
    "export default manifest;",
  ].join("\n");
};

export const createFileRouteDefinitionsVirtualModule = (manifest: FileRouteManifest): string =>
  createFileRouteDefinitionsModule(manifest, { importMode: "rootAbsolute" });

const createFileRouteDefinitionsVirtualModuleEffect = (
  manifest: FileRouteManifest,
): Effect.Effect<string, FileRouteDefinitionsModuleError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(createFileRouteDefinitionsVirtualModule(manifest));
    } catch (cause) {
      if (isFileRouteDefinitionsModuleError(cause)) {
        return Effect.fail(cause);
      }
      throw cause;
    }
  });

export const loadStartVirtualModule = (
  id: string,
  options: SunfallArcStartOptions = {},
): Effect.Effect<string | null, StartVirtualModuleLoadError> => {
  switch (id) {
    case resolvedFileRouteManifestVirtualModuleId:
      return Effect.map(makeStartFileRouteManifest(options), createFileRouteManifestVirtualModule);
    case resolvedFileRouteDefinitionsVirtualModuleId:
      return Effect.flatMap(
        makeStartFileRouteManifest(options),
        createFileRouteDefinitionsVirtualModuleEffect,
      );
    default:
      return Effect.succeed(null);
  }
};
