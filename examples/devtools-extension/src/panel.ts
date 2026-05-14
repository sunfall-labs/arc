import { Data, Effect } from "effect";
import { mountDevtoolsPanelsEffect } from "@effect-ui/devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import "./styles.css";

class DevtoolsExtensionRootMissing extends Data.TaggedError(
  "DevtoolsExtensionRootMissing",
)<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("devtools-root");

if (!root) {
  throw new DevtoolsExtensionRootMissing({
    id: "devtools-root",
    guidance: "Add a devtools root element with id=\"devtools-root\" to the extension panel."
  });
}

void Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* mountDevtoolsPanelsEffect({
        root,
        panels: sampleDevtoolsPanels(),
        selectedPanelId: "requests",
        title: "Effect UI Devtools Extension"
      });
      yield* Effect.never;
    })
  )
);
