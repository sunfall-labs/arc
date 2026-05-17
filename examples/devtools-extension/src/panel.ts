import { Data } from "effect";
import { bootDevtoolsPanels, interruptDevtoolsPanelBoot } from "@sunfall/arc-devtools";
import { sampleDevtoolsPanels } from "./sample.js";
import { type ChromeInspectedWindowApi } from "./transport.js";
import { panelTitle, pollInspectedWindowEffect } from "./panel-runtime.js";
import "./styles.css";

class DevtoolsExtensionRootMissing extends Data.TaggedError("DevtoolsExtensionRootMissing")<{
  readonly id: string;
  readonly guidance: string;
}> {}

declare const chrome: ChromeInspectedWindowApi | undefined;

export const bootDevtoolsExtensionPanel = (root: HTMLElement) =>
  bootDevtoolsPanels({
    root,
    panels: sampleDevtoolsPanels(),
    selectedPanelId: "requests",
    title: panelTitle,
    afterMount: (mount) => {
      const inspectedWindowApi = typeof chrome === "undefined" ? undefined : chrome;
      return pollInspectedWindowEffect(mount, inspectedWindowApi);
    },
  }).fiber;

const root = document.getElementById("devtools-root");

if (!root) {
  throw new DevtoolsExtensionRootMissing({
    id: "devtools-root",
    guidance: 'Add a devtools root element with id="devtools-root" to the extension panel.',
  });
}

export const devtoolsExtensionPanelBoot = bootDevtoolsPanels({
  root,
  panels: sampleDevtoolsPanels(),
  selectedPanelId: "requests",
  title: panelTitle,
  lifecycleWindow: window,
  afterMount: (mount) => {
    const inspectedWindowApi = typeof chrome === "undefined" ? undefined : chrome;
    return pollInspectedWindowEffect(mount, inspectedWindowApi);
  },
});
export const devtoolsExtensionPanelBootFiber = devtoolsExtensionPanelBoot.fiber;
export const interruptDevtoolsExtensionPanelBoot = interruptDevtoolsPanelBoot;
