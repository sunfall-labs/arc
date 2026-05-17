import tsrxSolid from "@tsrx/vite-plugin-solid";
import solid from "vite-plugin-solid";
import type { PluginOption } from "vite";

/** Options for the Sunfall Arc TSRX/Solid Vite preset. */
export interface SunfallArcTsrxOptions {
  /** Options passed through to `@tsrx/vite-plugin-solid`. */
  readonly tsrx?: Parameters<typeof tsrxSolid>[0];
  /** Options passed through to `vite-plugin-solid`. */
  readonly solid?: Parameters<typeof solid>[0];
  /** Vite dev-server dependency pre-bundling defaults used by the preset. */
  readonly optimizeDeps?: {
    /** Disable Vite dev-server dependency discovery. Defaults to `true` for TSRX projects. */
    readonly noDiscovery?: boolean;
  };
}

/**
 * Creates the standard Sunfall Arc TSRX/Solid Vite plugin chain.
 *
 * The preset installs a dev-server dependency-discovery policy plugin, then
 * TSRX's Solid transform, then `vite-plugin-solid` in the order expected by
 * starters.
 */
export const sunfallArcTsrx = (options: SunfallArcTsrxOptions = {}): PluginOption[] => {
  const noDiscovery = options.optimizeDeps?.noDiscovery ?? true;

  return [
    {
      name: "sunfall-arc-tsrx-deps",
      apply: "serve",
      config() {
        return noDiscovery
          ? {
              optimizeDeps: {
                noDiscovery: true,
              },
            }
          : {};
      },
    },
    tsrxSolid(options.tsrx),
    solid(options.solid),
  ];
};

/** Default export for `plugins: sunfallArcTsrx()` style Vite configs. */
export default sunfallArcTsrx;
