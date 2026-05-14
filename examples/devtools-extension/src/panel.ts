import { Data, Effect } from "effect";
import { mountDevtoolsPanelsEffect, type DevtoolsPanelMount } from "@effect-ui/devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import {
  readInspectedWindowDevtoolsPayloadEffect,
  type ChromeInspectedWindowApi
} from "./transport.js";
import "./styles.css";

class DevtoolsExtensionRootMissing extends Data.TaggedError(
  "DevtoolsExtensionRootMissing",
)<{
  readonly id: string;
  readonly guidance: string;
}> {}

declare const chrome: ChromeInspectedWindowApi | undefined;

const panelTitle = "Effect UI Devtools Extension";
const root = document.getElementById("devtools-root");

if (!root) {
  throw new DevtoolsExtensionRootMissing({
    id: "devtools-root",
    guidance: "Add a devtools root element with id=\"devtools-root\" to the extension panel."
  });
}

const updateFromInspectedWindowEffect = (
  mount: DevtoolsPanelMount,
  api: ChromeInspectedWindowApi | undefined
): Effect.Effect<void> =>
  readInspectedWindowDevtoolsPayloadEffect(api).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.flatMap((payload) =>
      payload === undefined
        ? Effect.void
        : Effect.sync(() => {
            mount.update({
              panels: payload.panels,
              selectedPanelId: payload.selectedPanelId ?? "requests",
              title: payload.title ?? panelTitle
            });
          })
    )
  );

void Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const mount = yield* mountDevtoolsPanelsEffect({
        root,
        panels: sampleDevtoolsPanels(),
        selectedPanelId: "requests",
        title: panelTitle
      });
      const inspectedWindowApi = typeof chrome === "undefined" ? undefined : chrome;
      yield* updateFromInspectedWindowEffect(mount, inspectedWindowApi);
      yield* updateFromInspectedWindowEffect(mount, inspectedWindowApi).pipe(
        Effect.andThen(Effect.sleep("1 second")),
        Effect.forever,
        Effect.forkScoped
      );
      yield* Effect.never;
    })
  )
);
