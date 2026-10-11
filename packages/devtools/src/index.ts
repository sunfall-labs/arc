import { Effect, Fiber, type Scope } from "effect";
import {
  mountDevtoolsPanelsEffectWithResolver,
  renderDevtoolsPanelsHtmlWithResolver,
} from "./panel-renderer.js";
import { describeDevtoolsPanels as describeDevtoolsPanelsInternal } from "./panels.js";
import { resolveDevtoolsPanelsInput } from "./panel-contract.js";
import { makeDevtoolsStore as makeDevtoolsStoreInternal } from "./store.js";
import type {
  DevtoolsPanelBoot,
  DevtoolsPanelBootOptions,
  DevtoolsPanelMount,
  DevtoolsPanelMountOptions,
  DevtoolsPanels,
  DevtoolsPanelsInput,
  DevtoolsPanelUiInput,
  DevtoolsStore,
  DevtoolsStoreOptions,
} from "./devtools-contract.js";

export * from "./bridge.js";
export * from "./devtools-contract.js";
export {
  DevtoolsUnknownInvalidationTarget,
  describeInvalidationPlan,
  describeRoutePlan,
  toDevtoolsSerializableValue,
} from "./serialization.js";
export { describeDevtoolsCausalGraph, describeDevtoolsSummary } from "./summary.js";
export {
  devtoolsPanelIds,
  devtoolsPanelSeverities,
  isDevtoolsSerializableValue,
  resolveSunfallArcDevtoolsBridgePayload,
  DevtoolsPanelContractError,
} from "./panel-contract.js";
export type {
  DevtoolsBridgePayloadContractResolution,
  DevtoolsPanelContractErrorReason,
} from "./panel-contract.js";

/** Projects snapshots, diagnostics, and runtime facts into stable panel data. */
export const describeDevtoolsPanels = (input: DevtoolsPanelsInput = {}): DevtoolsPanels =>
  describeDevtoolsPanelsInternal(input);

const resolveDevtoolsPanels = (input: DevtoolsPanelUiInput): DevtoolsPanels =>
  resolveDevtoolsPanelsInput(input, describeDevtoolsPanels);

/** Renders the stable panel contract to deterministic embeddable HTML. */
export const renderDevtoolsPanelsHtml = (input: DevtoolsPanelUiInput = {}): string =>
  renderDevtoolsPanelsHtmlWithResolver(input, resolveDevtoolsPanels);

/**
 * Mounts the panel renderer into a host DOM root inside a Scope; the renderer
 * unmounts when the Scope closes. Use `bootDevtoolsPanels` from non-Effect hosts.
 */
export const mountDevtoolsPanelsEffect = (
  options: DevtoolsPanelMountOptions,
): Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =>
  mountDevtoolsPanelsEffectWithResolver(options, resolveDevtoolsPanels);

const interruptDevtoolsPanelBoot = (fiber: Fiber.Fiber<void, never>): Effect.Effect<void> =>
  Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void));

const wireDevtoolsPanelLifecycleCleanup = (
  interrupt: () => void,
  lifecycleWindow: Pick<Window, "addEventListener" | "removeEventListener">,
): (() => void) => {
  let released = false;
  function release(): void {
    if (released) {
      return;
    }
    released = true;
    lifecycleWindow.removeEventListener("pagehide", interruptFromLifecycle);
    lifecycleWindow.removeEventListener("beforeunload", interruptFromLifecycle);
  }
  function interruptFromLifecycle(): void {
    release();
    interrupt();
  }

  lifecycleWindow.addEventListener("pagehide", interruptFromLifecycle);
  lifecycleWindow.addEventListener("beforeunload", interruptFromLifecycle);
  return release;
};

/**
 * Host facade over `mountDevtoolsPanelsEffect`: boots a live Devtools panel in
 * its own fiber and optionally wires browser lifecycle cleanup. Stop it with
 * `boot.interrupt()` or `boot.interruptEffect`.
 */
export const bootDevtoolsPanels = (options: DevtoolsPanelBootOptions): DevtoolsPanelBoot => {
  const { afterMount, lifecycleWindow, ...mountOptions } = options;
  let interruptBootFiber: () => Effect.Effect<void> = () => Effect.void;
  const releaseLifecycleListeners =
    lifecycleWindow === undefined
      ? () => undefined
      : wireDevtoolsPanelLifecycleCleanup(() => {
          void Effect.runFork(interruptBootFiber());
        }, lifecycleWindow);
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const mount = yield* mountDevtoolsPanelsEffect(mountOptions);
        if (afterMount) {
          yield* afterMount(mount);
        }
        yield* Effect.never;
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => releaseLifecycleListeners()))),
  );
  interruptBootFiber = () => interruptDevtoolsPanelBoot(fiber);
  const interruptEffect = Effect.gen(function* () {
    releaseLifecycleListeners();
    yield* interruptBootFiber();
  });
  const boot: DevtoolsPanelBoot = {
    fiber,
    interruptEffect,
    interrupt: () => {
      releaseLifecycleListeners();
      void Effect.runFork(interruptBootFiber());
    },
  };

  return boot;
};

/** Creates a bounded, detached Devtools Store for snapshots, traces, panels, and causal graphs. */
export const makeDevtoolsStore = (options: DevtoolsStoreOptions = {}): DevtoolsStore =>
  makeDevtoolsStoreInternal(options);
