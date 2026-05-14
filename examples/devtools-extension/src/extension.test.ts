import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderDevtoolsPanelsHtml } from "@effect-ui/devtools";
import {
  effectUiDevtoolsPanelPage,
  effectUiDevtoolsPanelTitle,
  registerEffectUiDevtoolsPanel
} from "./devtools.js";
import { sampleDevtoolsPanels } from "./sample.js";

describe("devtools extension example", () => {
  it("declares a browser devtools extension manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")
    );

    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: "Effect UI Devtools",
      devtools_page: "devtools.html"
    });
  });

  it("registers the Effect UI devtools panel with the extension host", () => {
    const created: ReadonlyArray<unknown>[] = [];
    const registered = registerEffectUiDevtoolsPanel({
      devtools: {
        panels: {
          create: (...args) => {
            created.push(args);
          }
        }
      }
    });

    expect(registered).toBe(true);
    expect(created).toEqual([[effectUiDevtoolsPanelTitle, "", effectUiDevtoolsPanelPage]]);
    expect(registerEffectUiDevtoolsPanel({})).toBe(false);
  });

  it("renders the extension panel from public devtools facts", () => {
    const html = renderDevtoolsPanelsHtml({
      panels: sampleDevtoolsPanels(),
      selectedPanelId: "requests",
      title: "Effect UI Devtools Extension"
    });

    expect(html).toContain("Effect UI Devtools Extension");
    expect(html).toContain("GET /projects/atlas");
    expect(html).toContain("Project.byId:atlas");
  });
});
