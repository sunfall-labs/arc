import { Effect, Fiber, type Layer, type Scope } from "effect";
import {
  installDevtoolsBridge,
  sunfallArcDevtoolsBridgeGlobal,
  type DevtoolsBridgeInstall,
  type DevtoolsBridgePayload,
  type DevtoolsBridgeProvider,
  type DevtoolsBridgeTarget,
} from "./bridge.js";
import { describeDevtoolsCausalGraph } from "./causal-graph.js";
import type {
  DevtoolsCausalGraph,
  DevtoolsInvalidationPlan,
  DevtoolsPanel,
  DevtoolsPanelBoot,
  DevtoolsPanelBootOptions,
  DevtoolsPanelMount,
  DevtoolsPanelMountOptions,
  DevtoolsPanels,
  DevtoolsPanelsInput,
  DevtoolsPanelUiInput,
  DevtoolsRecordActionStateOptions,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializableValue,
  DevtoolsSerializationPolicy,
  DevtoolsSnapshot,
  DevtoolsSpan,
  DevtoolsStore,
  DevtoolsStoreOptions,
  DevtoolsSummary,
  DevtoolsSummaryInput,
  DevtoolsSummaryRequest,
  DevtoolsTimelineCommit,
} from "./devtools-contract.js";
import {
  resolveDevtoolsPanelsInput,
  resolveSunfallArcDevtoolsBridgePayload,
  type DevtoolsBridgePayloadContractResolution,
} from "./panel-contract.js";
import {
  mountDevtoolsPanelsEffectWithResolver,
  renderDevtoolsPanelsHtmlWithResolver,
} from "./panel-renderer.js";
import { describeDevtoolsPanels } from "./panels.js";
import { toDevtoolsSerializableValue } from "./serialization.js";
import { devtoolsTracerLayer, makeDevtoolsStore } from "./store.js";
import { describeDevtoolsSummary } from "./summary.js";

const resolvePanels = (input: DevtoolsPanelUiInput): DevtoolsPanels =>
  resolveDevtoolsPanelsInput(input, describeDevtoolsPanels);

const mountPanelsScoped = (
  options: DevtoolsPanelMountOptions,
): Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =>
  mountDevtoolsPanelsEffectWithResolver(options, resolvePanels);

const interruptPanelBoot = (fiber: Fiber.Fiber<void, never>): Effect.Effect<void> =>
  Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void));

const wirePanelLifecycleCleanup = (
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

const bootPanelsHost = (options: DevtoolsPanelBootOptions): DevtoolsPanelBoot => {
  const { afterMount, lifecycleWindow, ...mountOptions } = options;
  let interruptBootFiber: () => Effect.Effect<void> = () => Effect.void;
  const releaseLifecycleListeners =
    lifecycleWindow === undefined
      ? () => undefined
      : wirePanelLifecycleCleanup(() => {
          void Effect.runFork(interruptBootFiber());
        }, lifecycleWindow);
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const mount = yield* mountPanelsScoped(mountOptions);
        if (afterMount) {
          yield* afterMount(mount);
        }
        yield* Effect.never;
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => releaseLifecycleListeners()))),
  );
  interruptBootFiber = () => interruptPanelBoot(fiber);
  return {
    fiber,
    interrupt: () => {
      releaseLifecycleListeners();
      void Effect.runFork(interruptBootFiber());
    },
  };
};

/**
 * JSON-safe inspection for Sunfall Arc apps: a bounded Store of runtime facts,
 * pure Summary, Causal Graph, and Panel projections, a deterministic panel
 * renderer, and an inspected-window bridge for browser extensions.
 */
export namespace Devtools {
  /** Bounded, detached recorder for snapshots, spans, Timeline commits, panels, and causal graphs. */
  export type Store = DevtoolsStore;
  /** Retention limits and serialization policy for `Devtools.makeStore`. */
  export type StoreOptions = DevtoolsStoreOptions;
  /** Input, live invalidation plan, or serialized invalidation plan for `store.recordActionState`. */
  export type RecordActionStateOptions = DevtoolsRecordActionStateOptions;
  /** Raw recorded facts: resources, actions, invalidations, route plans, spans, events. */
  export type Snapshot = DevtoolsSnapshot;
  /** One recorded runtime fact, tagged by its source. */
  export type RuntimeEvent = DevtoolsRuntimeEvent;
  /** A Timeline entry copied through the serialization policy, labelled by its cause. */
  export type TimelineCommit = DevtoolsTimelineCommit;
  /** JSON-safe route navigation plan. */
  export type RoutePlan = DevtoolsRoutePlan;
  /** JSON-safe invalidation plan; Start's `StartAction.InvalidationPlan` is assignable to it. */
  export type InvalidationPlan = DevtoolsInvalidationPlan;
  /** JSON-safe copy of one ended Effect span; Start request spans feed the Requests panel. */
  export type Span = DevtoolsSpan;
  /** One Start request row projected from its request span. */
  export type SummaryRequest = DevtoolsSummaryRequest;
  /** JSON-safe tagged value produced by `Devtools.toSerializable`. */
  export type SerializableValue = DevtoolsSerializableValue;
  /** Depth, entry, string, and redaction limits for copying inspected values. */
  export type SerializationPolicy = DevtoolsSerializationPolicy;
  /** Normalized inspector data projected from a snapshot. */
  export type Summary = DevtoolsSummary;
  /** Snapshot plus explicit fact overrides for the pure projections. */
  export type SummaryInput = DevtoolsSummaryInput;
  /** Deterministic causal nodes and edges over recorded facts. */
  export type CausalGraph = DevtoolsCausalGraph;
  /** The ordered, JSON-safe panel catalog that renderers and extensions consume. */
  export type Panels = DevtoolsPanels;
  /** One panel in the catalog. */
  export type Panel = DevtoolsPanel;
  /** Input for `Devtools.describePanels`. */
  export type PanelsInput = DevtoolsPanelsInput;
  /** Panels (or their inputs) plus selection and item-window options for rendering. */
  export type PanelUiInput = DevtoolsPanelUiInput;
  /** Host root plus render input for `Devtools.mountPanels`. */
  export type PanelMountOptions = DevtoolsPanelMountOptions;
  /** Mounted panel handle; `update` re-renders it. */
  export type PanelMount = DevtoolsPanelMount;
  /** Mount options plus an `afterMount` hook and lifecycle window for `Devtools.bootPanels`. */
  export type PanelBootOptions = DevtoolsPanelBootOptions;
  /** Running panel boot; stop it with `interrupt()`. */
  export type PanelBoot = DevtoolsPanelBoot;
  /** Payload an inspected app exposes to an extension or shell. */
  export type BridgePayload = DevtoolsBridgePayload;
  /** A bridge payload, or a function returning a fresh one on each read. */
  export type BridgeProvider = DevtoolsBridgeProvider;
  /** Object that holds the bridge global. Defaults to `globalThis`. */
  export type BridgeTarget = DevtoolsBridgeTarget;
  /** Installed bridge handle; `uninstall` restores any previous provider. */
  export type BridgeInstall = DevtoolsBridgeInstall;
  /** Valid payload, or a typed contract error with diagnostics panels. */
  export type BridgePayloadResolution = DevtoolsBridgePayloadContractResolution;

  /** Creates a bounded, detached Devtools Store for snapshots, spans, panels, and causal graphs. */
  export const makeStore = (options: DevtoolsStoreOptions = {}): DevtoolsStore =>
    makeDevtoolsStore(options);

  /**
   * Tracer Layer that records every ended Effect span into the store while
   * still forwarding spans to the current tracer (OpenTelemetry etc.). Provide
   * it to Start's `server` Layer to feed the Requests panel.
   */
  export const layerTracer: (store: DevtoolsStore) => Layer.Layer<never> = devtoolsTracerLayer;

  /** Projects a snapshot into route, request, invalidation, runtime, and resource inspectors. */
  export const describeSummary = (input: DevtoolsSummaryInput = {}): DevtoolsSummary =>
    describeDevtoolsSummary(input);

  /** Projects a snapshot into deterministic causal nodes and edges. */
  export const describeCausalGraph = (input: DevtoolsSummaryInput = {}): DevtoolsCausalGraph =>
    describeDevtoolsCausalGraph(input);

  /** Projects snapshots, diagnostics, and runtime facts into stable panel data. */
  export const describePanels = (input: DevtoolsPanelsInput = {}): DevtoolsPanels =>
    describeDevtoolsPanels(input);

  /** Renders the panel contract to deterministic, escaped, embeddable HTML. */
  export const renderPanelsHtml = (input: DevtoolsPanelUiInput = {}): string =>
    renderDevtoolsPanelsHtmlWithResolver(input, resolvePanels);

  /**
   * Mounts the panel renderer into a host DOM root inside a Scope; the renderer
   * unmounts when the Scope closes. Use `Devtools.bootPanels` from non-Effect hosts.
   */
  export const mountPanels: (
    options: DevtoolsPanelMountOptions,
  ) => Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> = mountPanelsScoped;

  /**
   * Host facade over `Devtools.mountPanels` for hosts without an Effect entry
   * point: boots a live panel in its own fiber and optionally wires browser
   * lifecycle cleanup. Stop it with `boot.interrupt()`.
   */
  export const bootPanels: (options: DevtoolsPanelBootOptions) => DevtoolsPanelBoot =
    bootPanelsHost;

  /**
   * Global property name the bridge installs on the inspected window. Extensions
   * read it to obtain the latest panel payload without coupling to app internals.
   */
  export const bridgeGlobal = sunfallArcDevtoolsBridgeGlobal;

  /**
   * Installs an app-side bridge provider without coupling the app to an
   * extension UI, uninstalling it when the Scope closes (or on `uninstall()`).
   */
  export const installBridge: (
    provider: DevtoolsBridgeProvider,
    target?: DevtoolsBridgeTarget,
  ) => Effect.Effect<DevtoolsBridgeInstall, never, Scope.Scope> = installDevtoolsBridge;

  /** Resolves an untrusted inspected-window value with typed panel-contract diagnostics on failure. */
  export const resolveBridgePayload: (value: unknown) => DevtoolsBridgePayloadContractResolution =
    resolveSunfallArcDevtoolsBridgePayload;

  /** Converts an arbitrary inspected value into a bounded, redacted, JSON-safe tagged value. */
  export const toSerializable: (
    value: unknown,
    policy?: DevtoolsSerializationPolicy,
  ) => DevtoolsSerializableValue = toDevtoolsSerializableValue;
}
