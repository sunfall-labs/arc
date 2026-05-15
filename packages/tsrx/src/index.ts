import tsrxSolid from "@tsrx/vite-plugin-solid";
import solid from "vite-plugin-solid";
import type { PluginOption } from "vite";

/** Options for the Effect UI TSRX/Solid Vite preset. */
export interface EffectUiTsrxOptions {
  /** Options passed through to `@tsrx/vite-plugin-solid`. */
  readonly tsrx?: Parameters<typeof tsrxSolid>[0];
  /** Options passed through to `vite-plugin-solid`. */
  readonly solid?: Parameters<typeof solid>[0];
  /** Vite dependency pre-bundling defaults used by the preset. */
  readonly optimizeDeps?: {
    /** Disable Vite dependency discovery. Defaults to `true` for TSRX projects. */
    readonly noDiscovery?: boolean;
  };
}

/**
 * Creates the standard Effect UI TSRX/Solid Vite plugin chain.
 *
 * The preset installs a small dependency-discovery policy plugin, then TSRX's
 * Solid transform, then `vite-plugin-solid` in the order expected by starters.
 */
export const effectUiTsrx = (options: EffectUiTsrxOptions = {}): PluginOption[] => {
  const noDiscovery = options.optimizeDeps?.noDiscovery ?? true;

  return [
    {
      name: "effect-ui-tsrx-deps",
      config() {
        return noDiscovery
          ? {
              optimizeDeps: {
                noDiscovery: true
              }
            }
          : {};
      }
    },
    tsrxSolid(options.tsrx),
    solid(options.solid)
  ];
};

/** Default export for `plugins: effectUiTsrx()` style Vite configs. */
export default effectUiTsrx;
