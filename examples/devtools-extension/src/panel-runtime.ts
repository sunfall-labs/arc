import { Effect, type Scope } from "effect";
import {
  type DevtoolsPanel,
  type DevtoolsPanelMount,
  type DevtoolsPanels,
  describeDevtoolsPanels,
  toDevtoolsSerializableValue,
} from "@effect-ui/devtools";
import {
  DevtoolsExtensionTransportError,
  readInspectedWindowDevtoolsPayloadEffect,
  type ChromeInspectedWindowApi,
  type InspectedWindowEvalOptions,
} from "./transport.js";

export const panelTitle = "Effect UI Devtools Extension";

const errorDescription = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    try {
      const description = (error as { readonly description?: unknown }).description;
      if (typeof description === "string" && description.length > 0) {
        return description;
      }
    } catch {
      return "Unknown inspected-window eval failure.";
    }
  }
  return "Unknown inspected-window eval failure.";
};

const transportErrorItem = (error: DevtoolsExtensionTransportError) => ({
  id: "extension-transport-error",
  label: "Inspected-window bridge unavailable",
  severity: "error" as const,
  detail: error.guidance,
  data: {
    operation: error.operation,
    reason: error.reason ?? null,
    description: errorDescription(error.error),
    error: toDevtoolsSerializableValue(error.error),
  },
});

const withTransportError = (
  panel: DevtoolsPanel,
  error: DevtoolsExtensionTransportError,
): DevtoolsPanel =>
  panel.id === "diagnostics"
    ? {
        ...panel,
        severity: "error",
        summary: "Inspected-window bridge error",
        items: [transportErrorItem(error), ...panel.items],
      }
    : panel;

export const devtoolsExtensionTransportErrorPanels = (
  error: DevtoolsExtensionTransportError,
): DevtoolsPanels => {
  const fallback = describeDevtoolsPanels();
  return {
    ...fallback,
    panels: fallback.panels.map((panel) => withTransportError(panel, error)),
  };
};

export const updateFromInspectedWindowEffect = (
  mount: DevtoolsPanelMount,
  api: ChromeInspectedWindowApi | undefined,
  options: InspectedWindowEvalOptions = {},
): Effect.Effect<void> =>
  readInspectedWindowDevtoolsPayloadEffect(api, undefined, options).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.sync(() => {
          mount.update({
            panels: devtoolsExtensionTransportErrorPanels(error),
            selectedPanelId: "diagnostics",
            title: panelTitle,
          });
        }),
      onSuccess: (payload) =>
        payload === undefined
          ? Effect.void
          : Effect.sync(() => {
              mount.update({
                panels: payload.panels,
                ...(payload.selectedPanelId === undefined
                  ? {}
                  : { selectedPanelId: payload.selectedPanelId }),
                title: payload.title ?? panelTitle,
              });
            }),
    }),
  );

export type DevtoolsExtensionPollInterval = Parameters<typeof Effect.sleep>[0];

export type DevtoolsExtensionPollingOptions = InspectedWindowEvalOptions & {
  readonly pollInterval?: DevtoolsExtensionPollInterval;
};

export const pollInspectedWindowEffect = (
  mount: DevtoolsPanelMount,
  api: ChromeInspectedWindowApi | undefined,
  options: DevtoolsExtensionPollingOptions = {},
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { pollInterval = "1 second", ...evalOptions } = options;
    const pollOnce = updateFromInspectedWindowEffect(mount, api, evalOptions);
    yield* pollOnce;
    yield* Effect.sleep(pollInterval).pipe(
      Effect.andThen(pollOnce),
      Effect.forever,
      Effect.forkScoped,
    );
  });
