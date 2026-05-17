import { Data } from "effect";
import { bootDevtoolsPanels, interruptDevtoolsPanelBoot } from "@sunfall/arc-devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import "./styles.css";

class DevtoolsRootMissing extends Data.TaggedError("DevtoolsRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

export const bootDevtoolsPanel = (root: HTMLElement) =>
  bootDevtoolsPanels({
    root,
    panels: sampleDevtoolsPanels(),
    selectedPanelId: "requests",
    title: "Sunfall Arc Devtools Panel",
  }).fiber;

const root = document.getElementById("devtools-root");

if (!root) {
  throw new DevtoolsRootMissing({
    id: "devtools-root",
    guidance: 'Add a devtools root element with id="devtools-root" to the document shell.',
  });
}

export const devtoolsPanelBoot = bootDevtoolsPanels({
  root,
  panels: sampleDevtoolsPanels(),
  selectedPanelId: "requests",
  title: "Sunfall Arc Devtools Panel",
  lifecycleWindow: window,
});
export const devtoolsPanelBootFiber = devtoolsPanelBoot.fiber;
export { interruptDevtoolsPanelBoot };
