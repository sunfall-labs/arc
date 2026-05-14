import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { renderDevtoolsPanelsHtml } from "@effect-ui/devtools";
import {
  effectUiDevtoolsPanelPage,
  effectUiDevtoolsPanelTitle,
  registerEffectUiDevtoolsPanel
} from "./devtools.js";
import { sampleDevtoolsPanels } from "./sample.js";
import {
  DevtoolsExtensionTransportError,
  effectUiDevtoolsBridgeExpression,
  normalizeEffectUiDevtoolsBridgePayload,
  readInspectedWindowDevtoolsPayloadEffect,
  type ChromeInspectedWindowApi
} from "./transport.js";

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

  it("reads live inspected-app panel payloads through the devtools bridge", async () => {
    const panels = sampleDevtoolsPanels();
    const evaluatedExpressions: Array<string> = [];
    const api: ChromeInspectedWindowApi = {
      devtools: {
        inspectedWindow: {
          eval: (expression, callback) => {
            evaluatedExpressions.push(expression);
            callback({
              panels,
              selectedPanelId: "resources",
              title: "Live Effect UI"
            });
          }
        }
      }
    };

    const payload = await Effect.runPromise(
      readInspectedWindowDevtoolsPayloadEffect(api)
    );

    expect(evaluatedExpressions).toEqual([effectUiDevtoolsBridgeExpression]);
    expect(payload).toEqual({
      panels,
      selectedPanelId: "resources",
      title: "Live Effect UI"
    });
    expect(normalizeEffectUiDevtoolsBridgePayload(null)).toBeUndefined();
    expect(normalizeEffectUiDevtoolsBridgePayload({ panels: { version: 2, panels: [] } })).toBeUndefined();
  });

  it("returns no live payload when the inspected-window bridge is unavailable", async () => {
    await expect(
      Effect.runPromise(readInspectedWindowDevtoolsPayloadEffect(undefined))
    ).resolves.toBeUndefined();
  });

  it("reports inspected-window bridge evaluation failures as typed errors", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        readInspectedWindowDevtoolsPayloadEffect({
          devtools: {
            inspectedWindow: {
              eval: (_expression, callback) => {
                callback(undefined, {
                  isException: true,
                  description: "bridge unavailable"
                });
              }
            }
          }
        })
      )
    );

    expect(error).toBeInstanceOf(DevtoolsExtensionTransportError);
    expect(error).toMatchObject({
      _tag: "DevtoolsExtensionTransportError",
      operation: "read-inspected-window",
      error: {
        description: "bridge unavailable"
      },
      guidance: expect.stringContaining("__EFFECT_UI_DEVTOOLS__")
    });
  });
});
