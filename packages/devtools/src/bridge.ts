import { Effect, type Scope } from "effect";
import type { DevtoolsPanelId, DevtoolsPanels } from "./devtools-contract.js";

/**
 * Global property name used by app-side Devtools bridge installers.
 *
 * Browser extensions and embedded shells can read this value from the inspected
 * window to obtain the latest panel payload without coupling to app internals.
 */
export const sunfallArcDevtoolsBridgeGlobal = "__SUNFALL_ARC_DEVTOOLS__" as const;

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
export type DevtoolsBridgeProvider = DevtoolsBridgePayload | (() => DevtoolsBridgePayload);

/** Object that can hold the scoped Devtools bridge global. Defaults to `globalThis`. */
export interface DevtoolsBridgeTarget {
  [sunfallArcDevtoolsBridgeGlobal]?: DevtoolsBridgeProvider | undefined;
}

/** Installed bridge handle. `uninstall` restores any previous provider. */
export interface DevtoolsBridgeInstall {
  readonly target: DevtoolsBridgeTarget;
  readonly uninstall: () => void;
}

interface DevtoolsBridgeInstallEntry {
  readonly provider: DevtoolsBridgeProvider;
}

interface DevtoolsBridgeTargetState {
  readonly hadPrevious: boolean;
  readonly previous: DevtoolsBridgeProvider | undefined;
  readonly installs: Array<DevtoolsBridgeInstallEntry>;
}

const bridgeTargetStates = new WeakMap<DevtoolsBridgeTarget, DevtoolsBridgeTargetState>();

const restoreDevtoolsBridgeTarget = (
  target: DevtoolsBridgeTarget,
  state: DevtoolsBridgeTargetState,
): void => {
  const current = state.installs[state.installs.length - 1];
  if (current !== undefined) {
    target[sunfallArcDevtoolsBridgeGlobal] = current.provider;
    return;
  }

  bridgeTargetStates.delete(target);
  if (state.hadPrevious) {
    target[sunfallArcDevtoolsBridgeGlobal] = state.previous;
  } else {
    delete target[sunfallArcDevtoolsBridgeGlobal];
  }
};

/** Installs an app-side Devtools provider without coupling the app to an extension UI. */
export const installDevtoolsBridge = (
  provider: DevtoolsBridgeProvider,
  target: DevtoolsBridgeTarget = globalThis as DevtoolsBridgeTarget,
): DevtoolsBridgeInstall => {
  const state = bridgeTargetStates.get(target) ?? {
    hadPrevious: Object.prototype.hasOwnProperty.call(target, sunfallArcDevtoolsBridgeGlobal),
    previous: target[sunfallArcDevtoolsBridgeGlobal],
    installs: [],
  };
  if (!bridgeTargetStates.has(target)) {
    bridgeTargetStates.set(target, state);
  }

  const entry: DevtoolsBridgeInstallEntry = { provider };
  let installed = true;
  state.installs.push(entry);
  target[sunfallArcDevtoolsBridgeGlobal] = provider;

  return {
    target,
    uninstall: () => {
      if (!installed) {
        return;
      }
      installed = false;
      const index = state.installs.indexOf(entry);
      if (index >= 0) {
        state.installs.splice(index, 1);
      }
      restoreDevtoolsBridgeTarget(target, state);
    },
  };
};

/** Scoped Effect helper for installing and automatically uninstalling the bridge. */
export const installDevtoolsBridgeEffect = (
  provider: DevtoolsBridgeProvider,
  target?: DevtoolsBridgeTarget,
): Effect.Effect<DevtoolsBridgeInstall, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => installDevtoolsBridge(provider, target)),
    (bridge) =>
      Effect.sync(() => {
        bridge.uninstall();
      }),
  );
