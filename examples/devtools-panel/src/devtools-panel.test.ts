import { renderDevtoolsPanelsHtml } from "@effect-ui/devtools";
import { describe, expect, it } from "vitest";
import { sampleDevtoolsPanels } from "./sample.js";

describe("devtools panel example", () => {
  it("renders the request panel from sample public facts", () => {
    const html = renderDevtoolsPanelsHtml({
      panels: sampleDevtoolsPanels(),
      selectedPanelId: "requests",
      title: "Effect UI Devtools Panel"
    });

    expect(html).toContain("Effect UI Devtools Panel");
    expect(html).toContain("GET /projects/atlas");
    expect(html).toContain("Project.byId:atlas");
    expect(html).toContain("data-selected-panel=\"requests\"");
  });
});
