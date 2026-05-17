import { Data, Effect } from "effect";
import {
  effectUiDevtoolsBridgeGlobal,
  resolveEffectUiDevtoolsBridgePayload,
  type DevtoolsBridgePayload,
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
        callback: (result: unknown, exceptionInfo?: ChromeDevtoolsEvalException) => void,
      ) => void;
    };
  };
}

export class DevtoolsExtensionTransportError extends Data.TaggedError(
  "DevtoolsExtensionTransportError",
)<{
  readonly operation: "read-inspected-window";
  readonly reason?: "MissingBridge" | "EvaluationFailure" | "InvalidPayload" | "Timeout";
  readonly error: unknown;
  readonly guidance: string;
}> {}

export interface InspectedWindowEvalOptions {
  readonly timeoutMillis?: number;
}

const defaultInspectedWindowEvalTimeoutMillis = 1_000;

const normalizeTimeoutMillis = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0
    ? defaultInspectedWindowEvalTimeoutMillis
    : Math.floor(value);

export const effectUiDevtoolsBridgeExpression = [
  "(() => {",
  `  const bridge = globalThis.${effectUiDevtoolsBridgeGlobal};`,
  '  return typeof bridge === "function" ? bridge() : bridge ?? null;',
  "})()",
].join("\n");

export const readInspectedWindowDevtoolsPayloadEffect = (
  api: ChromeInspectedWindowApi | undefined,
  expression = effectUiDevtoolsBridgeExpression,
  options: InspectedWindowEvalOptions = {},
): Effect.Effect<DevtoolsBridgePayload | undefined, DevtoolsExtensionTransportError> => {
  const evaluate = api?.devtools?.inspectedWindow?.eval;
  if (!evaluate) {
    return Effect.succeed(undefined);
  }

  const timeoutMillis = normalizeTimeoutMillis(options.timeoutMillis);
  return Effect.callback((resume, signal) => {
    let completed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      completed = true;
      signal.removeEventListener("abort", abort);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };
    const complete = (
      effect: Effect.Effect<DevtoolsBridgePayload, DevtoolsExtensionTransportError>,
    ) => {
      if (completed) {
        return;
      }
      cleanup();
      resume(effect);
    };
    const abort = () => {
      cleanup();
    };

    timeoutId = setTimeout(() => {
      complete(
        Effect.fail(
          new DevtoolsExtensionTransportError({
            operation: "read-inspected-window",
            reason: "Timeout",
            error: { timeoutMillis },
            guidance: `The inspected-window eval for globalThis.${effectUiDevtoolsBridgeGlobal} did not call back within ${timeoutMillis}ms.`,
          }),
        ),
      );
    }, timeoutMillis);
    signal.addEventListener("abort", abort, { once: true });

    try {
      evaluate(expression, (result, exceptionInfo) => {
        try {
          if (exceptionInfo?.isException) {
            complete(
              Effect.fail(
                new DevtoolsExtensionTransportError({
                  operation: "read-inspected-window",
                  reason: "EvaluationFailure",
                  error: exceptionInfo,
                  guidance: `Expose globalThis.${effectUiDevtoolsBridgeGlobal} as a DevtoolsPanels payload or provider function.`,
                }),
              ),
            );
            return;
          }

          if (result === null || result === undefined) {
            complete(
              Effect.fail(
                new DevtoolsExtensionTransportError({
                  operation: "read-inspected-window",
                  reason: "MissingBridge",
                  error: result,
                  guidance: `Expose globalThis.${effectUiDevtoolsBridgeGlobal} as a DevtoolsPanels payload or provider function.`,
                }),
              ),
            );
            return;
          }

          const resolution = resolveEffectUiDevtoolsBridgePayload(result);
          if (resolution._tag === "Invalid") {
            complete(
              Effect.fail(
                new DevtoolsExtensionTransportError({
                  operation: "read-inspected-window",
                  reason: "InvalidPayload",
                  error: {
                    contract: resolution.error,
                    payload: result,
                  },
                  guidance: `globalThis.${effectUiDevtoolsBridgeGlobal} returned a value that does not satisfy the DevtoolsPanels bridge contract.`,
                }),
              ),
            );
            return;
          }

          complete(Effect.succeed(resolution.payload));
        } catch (error) {
          complete(
            Effect.fail(
              new DevtoolsExtensionTransportError({
                operation: "read-inspected-window",
                reason: "EvaluationFailure",
                error,
                guidance: `Expose globalThis.${effectUiDevtoolsBridgeGlobal} as a DevtoolsPanels payload or provider function.`,
              }),
            ),
          );
        }
      });
    } catch (error) {
      complete(
        Effect.fail(
          new DevtoolsExtensionTransportError({
            operation: "read-inspected-window",
            reason: "EvaluationFailure",
            error,
            guidance: `Expose globalThis.${effectUiDevtoolsBridgeGlobal} as a DevtoolsPanels payload or provider function.`,
          }),
        ),
      );
    }
    return Effect.sync(() => {
      cleanup();
    });
  });
};
