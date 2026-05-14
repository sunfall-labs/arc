import tsrxSolid from "@tsrx/vite-plugin-solid";
import solid from "vite-plugin-solid";
import type { PluginOption } from "vite";

export interface EffectUiTsrxOptions {
  readonly tsrx?: Parameters<typeof tsrxSolid>[0];
  readonly solid?: Parameters<typeof solid>[0];
  readonly optimizeDeps?: {
    readonly noDiscovery?: boolean;
  };
}

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

export default effectUiTsrx;
