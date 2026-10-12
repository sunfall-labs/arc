import { Data } from "effect";
import { Devtools } from "@sunfall/arc-devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import "./styles.css";

class DevtoolsRootMissing extends Data.TaggedError("DevtoolsRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

export const bootDevtoolsPanel = (root: HTMLElement) =>
  Devtools.bootPanels({
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

export const devtoolsPanelBoot = Devtools.bootPanels({
  root,
  panels: sampleDevtoolsPanels(),
  selectedPanelId: "requests",
  title: "Sunfall Arc Devtools Panel",
  lifecycleWindow: window,
});
export const devtoolsPanelBootFiber = devtoolsPanelBoot.fiber;
