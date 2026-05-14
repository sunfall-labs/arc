import { Data, Effect } from "effect";
import { mountDevtoolsPanelsEffect } from "@effect-ui/devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import "./styles.css";

class DevtoolsRootMissing extends Data.TaggedError("DevtoolsRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

const root = document.getElementById("devtools-root");

if (!root) {
  throw new DevtoolsRootMissing({
    id: "devtools-root",
    guidance: "Add a devtools root element with id=\"devtools-root\" to the document shell."
  });
}

void Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      yield* mountDevtoolsPanelsEffect({
        root,
        panels: sampleDevtoolsPanels(),
        selectedPanelId: "requests",
        title: "Effect UI Devtools Panel"
      });
      yield* Effect.never;
    })
  )
);
