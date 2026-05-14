import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative as relativePath, resolve as resolvePath } from "node:path";
import { createGeneratedFileRouteDefinitionsModule } from "./file-route-modules.js";
import {
  absoluteFileRouteDirectory,
  defaultFileRouteDirectory,
  defaultFileRouteGeneratedFile,
  type EffectUiStartOptions,
  type FileRouteGenerationOptions
} from "./start-manifest-wall.js";
import type { FileRouteManifest } from "./file-routes.js";

/** Plan for a generated route definitions file write. */
export interface FileRouteDefinitionsFileWritePlan {
  readonly outputFile: string;
  readonly absolutePath: string;
  readonly generatedFile: string;
  readonly source: string;
}

/** Result from writing the generated route definitions module. */
export interface FileRouteDefinitionsFileWriteResult {
  readonly outputFile: string;
  readonly absolutePath: string;
  readonly written: boolean;
  readonly source: string;
}

const normalizeGeneratedRouteDefinitionsPath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

export const shouldWriteFileRouteDefinitionsFile = (
  root: string,
  activeOptions: EffectUiStartOptions,
  initialOptions: EffectUiStartOptions
): boolean => {
  if (activeOptions.fileRouteGeneration?.outputFile === false) {
    return false;
  }

  if (initialOptions.fileRoutes !== undefined || initialOptions.fileRouteManifest !== undefined) {
    return true;
  }

  const routeDirectory = activeOptions.fileRouteOptions?.routeDirectory ?? defaultFileRouteDirectory;
  return existsSync(absoluteFileRouteDirectory(root, routeDirectory));
};

export const planFileRouteDefinitionsFileWrite = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): FileRouteDefinitionsFileWritePlan | undefined => {
  if (options.outputFile === false) {
    return undefined;
  }

  const outputFile = options.outputFile ?? defaultFileRouteGeneratedFile;
  const absolutePath = isAbsolute(outputFile)
    ? outputFile
    : resolvePath(root, outputFile);
  const generatedFile = isAbsolute(outputFile)
    ? normalizeGeneratedRouteDefinitionsPath(relativePath(root, absolutePath))
    : outputFile;
  const source = createGeneratedFileRouteDefinitionsModule(manifest, {
    ...options,
    generatedFile
  });

  return {
    outputFile,
    absolutePath,
    generatedFile,
    source
  };
};

/**
 * Writes the generated route definitions file when content has changed.
 *
 * Returns `undefined` when generation is disabled and reports whether a file
 * write was necessary otherwise.
 */
export const writeFileRouteDefinitionsFile = (
  root: string,
  manifest: FileRouteManifest,
  options: FileRouteGenerationOptions = {}
): FileRouteDefinitionsFileWriteResult | undefined => {
  const plan = planFileRouteDefinitionsFileWrite(root, manifest, options);
  if (plan === undefined) {
    return undefined;
  }

  if (existsSync(plan.absolutePath) && readFileSync(plan.absolutePath, "utf8") === plan.source) {
    return {
      outputFile: plan.outputFile,
      absolutePath: plan.absolutePath,
      source: plan.source,
      written: false
    };
  }

  mkdirSync(dirname(plan.absolutePath), { recursive: true });
  writeFileSync(plan.absolutePath, plan.source);

  return {
    outputFile: plan.outputFile,
    absolutePath: plan.absolutePath,
    source: plan.source,
    written: true
  };
};
