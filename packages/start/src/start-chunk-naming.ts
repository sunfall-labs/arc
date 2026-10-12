import { isAbsolute, relative } from "node:path";
import type { UserConfig } from "vite";

/**
 * Chunk naming for Start builds. Code that the entry loads and that does not
 * belong to the app (Arc, Effect, Solid, and the other packages it imports)
 * would otherwise land in a shared chunk that Rolldown names after whichever
 * app module it happened to pick (`_key-*.js` for `routes/projects/$key`).
 * Start groups it into one `vendor` chunk instead. Packages that only lazy
 * routes import stay in those routes' chunks.
 */

/** Name of the chunk that holds the entry's dependencies. */
export const startVendorChunkName = "vendor";

/** Name of the chunk that holds app modules the entry and lazy routes share. */
export const startSharedAppChunkName = "app";

/**
 * A module that is not the app's own source: inside a `node_modules`
 * directory, or outside the Vite root (a workspace package resolved to its
 * source). Virtual modules (`\0...`) belong to the app.
 */
export const isStartDependencyModule = (root: string, id: string): boolean => {
  const path = id.split("\\").join("/");
  if (path.includes("/node_modules/")) {
    return true;
  }
  if (!isAbsolute(id)) {
    return false;
  }
  const fromRoot = relative(root, id);
  return fromRoot.startsWith("..") || isAbsolute(fromRoot);
};

/** Vite `build` config naming the entry's dependency chunk `vendor`. */
export const startChunkNamingConfig = (root: string): NonNullable<UserConfig["build"]> => ({
  rolldownOptions: {
    output: {
      codeSplitting: {
        groups: [
          {
            name: startVendorChunkName,
            test: (id: string) => isStartDependencyModule(root, id),
            tags: ["$initial"],
          },
          {
            name: startSharedAppChunkName,
            test: (id: string) => !id.startsWith("\0") && !isStartDependencyModule(root, id),
            tags: ["$initial"],
            minShareCount: 2,
          },
        ],
      },
    },
  },
});
