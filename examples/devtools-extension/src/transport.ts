import { Data, Effect } from "effect";
import {
  effectUiDevtoolsBridgeGlobal,
  type DevtoolsBridgePayload,
  type DevtoolsPanel,
  type DevtoolsPanelId,
  type DevtoolsPanelItem,
  type DevtoolsPanelMetric,
  type DevtoolsPanels,
  type DevtoolsPanelSeverity,
  type DevtoolsSerializableValue
} from "@effect-ui/devtools";

export interface ChromeDevtoolsEvalException {
  readonly isException?: boolean;
  readonly value?: unknown;
  readonly description?: string;
}

export interface ChromeInspectedWindowApi {
  readonly devtools?: {
    readonly inspectedWindow?: {
      readonly eval: (
        expression: string,
        callback: (
          result: unknown,
          exceptionInfo?: ChromeDevtoolsEvalException
        ) => void
      ) => void;
    };
  };
}

export class DevtoolsExtensionTransportError extends Data.TaggedError(
  "DevtoolsExtensionTransportError"
)<{
  readonly operation: "read-inspected-window";
  readonly error: unknown;
  readonly guidance: string;
}> {}

export const effectUiDevtoolsBridgeExpression = [
  "(() => {",
  `  const bridge = globalThis.${effectUiDevtoolsBridgeGlobal};`,
  "  return typeof bridge === \"function\" ? bridge() : bridge ?? null;",
  "})()"
].join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const devtoolsPanelIds: ReadonlySet<string> = new Set<DevtoolsPanelId>([
  "app-graph",
  "routes",
  "resources",
  "actions",
  "collections",
  "requests",
  "diagnostics",
  "causal-graph"
]);

const devtoolsPanelSeverities: ReadonlySet<string> = new Set<DevtoolsPanelSeverity>([
  "ok",
  "info",
  "warning",
  "error"
]);

const isDevtoolsPanelId = (value: unknown): value is DevtoolsPanelId =>
  typeof value === "string" && devtoolsPanelIds.has(value);

const isDevtoolsPanelSeverity = (value: unknown): value is DevtoolsPanelSeverity =>
  typeof value === "string" && devtoolsPanelSeverities.has(value);

const isDevtoolsSerializableValue = (value: unknown): value is DevtoolsSerializableValue => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isDevtoolsSerializableValue);
  }

  return isRecord(value) && Object.values(value).every(isDevtoolsSerializableValue);
};

const isDevtoolsPanelMetric = (value: unknown): value is DevtoolsPanelMetric =>
  isRecord(value) &&
  typeof value.label === "string" &&
  (typeof value.value === "string" || typeof value.value === "number") &&
  (value.unit === undefined || typeof value.unit === "string");

const isDevtoolsPanelItem = (value: unknown): value is DevtoolsPanelItem =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  isDevtoolsPanelSeverity(value.severity) &&
  (value.detail === undefined || typeof value.detail === "string") &&
  (value.metrics === undefined || (Array.isArray(value.metrics) && value.metrics.every(isDevtoolsPanelMetric))) &&
  (value.data === undefined || isDevtoolsSerializableValue(value.data));

const isDevtoolsPanel = (value: unknown): value is DevtoolsPanel =>
  isRecord(value) &&
  isDevtoolsPanelId(value.id) &&
  typeof value.title === "string" &&
  typeof value.summary === "string" &&
  isDevtoolsPanelSeverity(value.severity) &&
  Array.isArray(value.metrics) &&
  value.metrics.every(isDevtoolsPanelMetric) &&
  Array.isArray(value.items) &&
  value.items.every(isDevtoolsPanelItem);

const isDevtoolsPanels = (value: unknown): value is DevtoolsPanels =>
  isRecord(value) &&
  value.version === 1 &&
  Array.isArray(value.panels) &&
  value.panels.every(isDevtoolsPanel);

export const normalizeEffectUiDevtoolsBridgePayload = (
  value: unknown
): DevtoolsBridgePayload | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const panels = value.panels;
  if (!isDevtoolsPanels(panels)) {
    return undefined;
  }

  return {
    panels,
    ...(isDevtoolsPanelId(value.selectedPanelId)
      ? { selectedPanelId: value.selectedPanelId }
      : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {})
  };
};

export const readInspectedWindowDevtoolsPayloadEffect = (
  api: ChromeInspectedWindowApi | undefined,
  expression = effectUiDevtoolsBridgeExpression
): Effect.Effect<
  DevtoolsBridgePayload | undefined,
  DevtoolsExtensionTransportError
> => {
  const evaluate = api?.devtools?.inspectedWindow?.eval;
  if (!evaluate) {
    return Effect.succeed(undefined);
  }

  return Effect.callback((resume) => {
    evaluate(expression, (result, exceptionInfo) => {
      if (exceptionInfo?.isException) {
        resume(
          Effect.fail(
            new DevtoolsExtensionTransportError({
              operation: "read-inspected-window",
              error: exceptionInfo,
              guidance: `Expose globalThis.${effectUiDevtoolsBridgeGlobal} as a DevtoolsPanels payload or provider function.`
            })
          )
        );
        return;
      }

      resume(Effect.succeed(normalizeEffectUiDevtoolsBridgePayload(result)));
    });
  });
};
