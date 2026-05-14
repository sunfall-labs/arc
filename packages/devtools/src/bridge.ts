import { Effect, type Scope } from "effect";
import type { DevtoolsPanelId, DevtoolsPanels } from "./index.js";

export const effectUiDevtoolsBridgeGlobal = "__EFFECT_UI_DEVTOOLS__" as const;

export interface DevtoolsBridgePayload {
  readonly panels: DevtoolsPanels;
  readonly selectedPanelId?: DevtoolsPanelId;
  readonly title?: string;
}

export type DevtoolsBridgeProvider =
  | DevtoolsBridgePayload
  | (() => DevtoolsBridgePayload);

export interface DevtoolsBridgeTarget {
  [effectUiDevtoolsBridgeGlobal]?: DevtoolsBridgeProvider | undefined;
}

export interface DevtoolsBridgeInstall {
  readonly target: DevtoolsBridgeTarget;
  readonly uninstall: () => void;
}

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
