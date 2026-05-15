import { Effect, type Scope } from "effect";
import type { DevtoolsPanelId, DevtoolsPanels } from "./devtools-contract.js";

/**
 * Global property name used by app-side Devtools bridge installers.
 *
 * Browser extensions and embedded shells can read this value from the inspected
 * window to obtain the latest panel payload without coupling to app internals.
 */
export const effectUiDevtoolsBridgeGlobal = "__EFFECT_UI_DEVTOOLS__" as const;

/** Payload exposed by an inspected app to a browser-extension or app-side Devtools shell. */
export interface DevtoolsBridgePayload {
  readonly panels: DevtoolsPanels;
  readonly selectedPanelId?: DevtoolsPanelId;
  readonly title?: string;
}

/**
 * Bridge payload provider installed on the inspected window.
 *
 * Use a plain payload for static snapshots, or a callback when the extension
 * should pull fresh panel data each time it inspects the bridge.
 */
export type DevtoolsBridgeProvider =
  | DevtoolsBridgePayload
  | (() => DevtoolsBridgePayload);

/** Object that can hold the scoped Devtools bridge global. Defaults to `globalThis`. */
export interface DevtoolsBridgeTarget {
  [effectUiDevtoolsBridgeGlobal]?: DevtoolsBridgeProvider | undefined;
}

/** Installed bridge handle. `uninstall` restores any previous provider. */
export interface DevtoolsBridgeInstall {
  readonly target: DevtoolsBridgeTarget;
  readonly uninstall: () => void;
}

/** Installs an app-side Devtools provider without coupling the app to an extension UI. */
export const installDevtoolsBridge = (
  provider: DevtoolsBridgeProvider,
  target: DevtoolsBridgeTarget = globalThis as DevtoolsBridgeTarget
): DevtoolsBridgeInstall => {
  const hadPrevious = Object.prototype.hasOwnProperty.call(
    target,
    effectUiDevtoolsBridgeGlobal
  );
  const previous = target[effectUiDevtoolsBridgeGlobal];
  let installed = true;
  target[effectUiDevtoolsBridgeGlobal] = provider;

  return {
    target,
    uninstall: () => {
      if (!installed) {
        return;
      }
      installed = false;
      if (hadPrevious) {
        target[effectUiDevtoolsBridgeGlobal] = previous;
      } else {
        delete target[effectUiDevtoolsBridgeGlobal];
      }
    }
  };
};

/** Scoped Effect helper for installing and automatically uninstalling the bridge. */
export const installDevtoolsBridgeEffect = (
  provider: DevtoolsBridgeProvider,
  target?: DevtoolsBridgeTarget
): Effect.Effect<DevtoolsBridgeInstall, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => installDevtoolsBridge(provider, target)),
    (bridge) => Effect.sync(() => {
      bridge.uninstall();
    })
  );
