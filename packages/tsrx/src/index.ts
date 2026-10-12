import tsrxSolid from "@tsrx/vite-plugin-solid";
import solid from "@solidjs/vite-plugin";
import type { PluginOption } from "vite";

/** Options for the Sunfall Arc TSRX/Solid Vite preset. */
export interface SunfallArcTsrxOptions {
  /** Options passed through to `@tsrx/vite-plugin-solid`. */
  readonly tsrx?: Parameters<typeof tsrxSolid>[0];
  /** Options passed through to `@solidjs/vite-plugin`. */
  readonly solid?: Parameters<typeof solid>[0];
  /** Vite dev-server dependency pre-bundling defaults used by the preset. */
  readonly optimizeDeps?: {
    /** Disable Vite dev-server dependency discovery. Defaults to `true` for TSRX projects. */
    readonly noDiscovery?: boolean;
  };
}

/**
 * Solid's reactive core, pre-bundled through `solid-js` so the dev server
 * serves one runtime. `@solidjs/vite-plugin` pre-bundles `solid-js` and
 * `@solidjs/web` with `@solidjs/signals` inlined; Arc core imports
 * `@solidjs/signals` directly (it needs the client graph's `getObserver`, which
 * Solid's server build does not share). Without this entry Vite serves that
 * import as a separate raw module, so Arc signals would observe a second,
 * idle reactive runtime and never track in Solid computations. The nested
 * `solid-js > ...` form resolves through `solid-js` (pnpm does not hoist
 * signals to the app root) and joins the same optimizer pass, so the shared
 * core lands in one chunk that every importer resolves to.
 */
const solidReactiveCoreDependency = "solid-js > @solidjs/signals";

/**
 * Creates the standard Sunfall Arc TSRX/Solid Vite plugin chain.
 *
 * The preset installs a dev-server dependency-discovery policy plugin and a
 * test-environment default, then TSRX's Solid transform, then
 * `@solidjs/vite-plugin` in the order expected by starters.
 *
 * Under Vitest, projects that do not choose an environment default to `node`,
 * so `@solidjs/vite-plugin` takes its server posture (Solid's server build) for
 * SSR and domain tests. DOM component test projects opt in explicitly with
 * `test: { environment: "happy-dom" }`.
 */
export const sunfallArcTsrx = (options: SunfallArcTsrxOptions = {}): PluginOption[] => {
  const noDiscovery = options.optimizeDeps?.noDiscovery ?? true;

  return [
    {
      name: "sunfall-arc-tsrx-deps",
      apply: "serve",
      config() {
        return {
          optimizeDeps: {
            include: [solidReactiveCoreDependency],
            ...(noDiscovery ? { noDiscovery: true } : {}),
          },
        };
      },
    },
    {
      name: "sunfall-arc-tsrx-test-environment",
      // Runs before `@solidjs/vite-plugin` (also `pre`) so it sees the default.
      enforce: "pre",
      config(config, env) {
        const test = (config as { readonly test?: { readonly environment?: string } }).test;
        return env.mode === "test" && test?.environment === undefined
          ? ({ test: { environment: "node" } } as Record<string, unknown>)
          : {};
      },
    },
    tsrxSolid(options.tsrx),
    solid(options.solid),
  ];
};
