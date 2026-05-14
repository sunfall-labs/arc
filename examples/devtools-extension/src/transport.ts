import { Data, Effect } from "effect";
import type { DevtoolsPanelId, DevtoolsPanels } from "@effect-ui/devtools";

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

export interface EffectUiDevtoolsBridgePayload {
  readonly panels: DevtoolsPanels;
  readonly selectedPanelId?: DevtoolsPanelId;
  readonly title?: string;
}

export class DevtoolsExtensionTransportError extends Data.TaggedError(
  "DevtoolsExtensionTransportError"
)<{
  readonly operation: "read-inspected-window";
  readonly error: unknown;
  readonly guidance: string;
}> {}

export const effectUiDevtoolsBridgeGlobal = "__EFFECT_UI_DEVTOOLS__";

export const effectUiDevtoolsBridgeExpression = [
  "(() => {",
  `  const bridge = globalThis.${effectUiDevtoolsBridgeGlobal};`,
  "  return typeof bridge === \"function\" ? bridge() : bridge ?? null;",
  "})()"
].join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const normalizeEffectUiDevtoolsBridgePayload = (
  value: unknown
): EffectUiDevtoolsBridgePayload | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const panels = value.panels;
  if (!isRecord(panels) || panels.version !== 1 || !Array.isArray(panels.panels)) {
    return undefined;
  }

  return {
    panels: panels as unknown as DevtoolsPanels,
    ...(typeof value.selectedPanelId === "string"
      ? { selectedPanelId: value.selectedPanelId as DevtoolsPanelId }
      : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {})
  };
};

export const readInspectedWindowDevtoolsPayloadEffect = (
  api: ChromeInspectedWindowApi | undefined,
  expression = effectUiDevtoolsBridgeExpression
): Effect.Effect<
  EffectUiDevtoolsBridgePayload | undefined,
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
