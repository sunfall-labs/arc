import { readFileSync } from "node:fs";
import { Effect, Fiber } from "effect";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { Devtools } from "@sunfall/arc-devtools";
import {
  sunfallArcDevtoolsPanelPage,
  sunfallArcDevtoolsPanelTitle,
  registerSunfallArcDevtoolsPanel,
} from "./devtools.js";
import { sampleDevtoolsPanels } from "./sample.js";

const validBridgePayload = (value: unknown) => {
  const resolution = Devtools.resolveBridgePayload(value);
  return resolution._tag === "Valid" ? resolution.payload : undefined;
};
import {
  devtoolsExtensionTransportErrorPanels,
  pollInspectedWindowEffect,
  updateFromInspectedWindowEffect,
} from "./panel-runtime.js";
import {
  DevtoolsExtensionTransportError,
  sunfallArcDevtoolsBridgeExpression,
  readInspectedWindowDevtoolsPayloadEffect,
  type ChromeInspectedWindowApi,
} from "./transport.js";

describe("devtools extension example", () => {
  it("declares a browser devtools extension manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
    );

    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: "Sunfall Arc Devtools",
      devtools_page: "devtools.html",
    });
  });

  it("registers the Sunfall Arc devtools panel with the extension host", () => {
    const created: ReadonlyArray<unknown>[] = [];
    const registered = registerSunfallArcDevtoolsPanel({
      devtools: {
        panels: {
          create: (...args) => {
            created.push(args);
          },
        },
      },
    });

    expect(registered).toBe(true);
    expect(created).toEqual([[sunfallArcDevtoolsPanelTitle, "", sunfallArcDevtoolsPanelPage]]);
    expect(registerSunfallArcDevtoolsPanel({})).toBe(false);
  });

  it("renders the extension panel from public devtools facts", () => {
    const html = Devtools.renderPanelsHtml({
      panels: sampleDevtoolsPanels(),
      selectedPanelId: "requests",
      title: "Sunfall Arc Devtools Extension",
    });

    expect(html).toContain("Sunfall Arc Devtools Extension");
    expect(html).toContain("GET /projects/atlas");
    expect(html).toContain("Project.byId:atlas");
  });

  it("boots the actual extension panel entrypoint with a DOM root and fake chrome", async () => {
    const window = new Window({ url: "chrome-extension://sunfall-arc/panel.html" });
    const root = window.document.createElement("div");
    root.id = "devtools-root";
    window.document.body.append(root);

    const panels = sampleDevtoolsPanels();
    const evaluatedExpressions: Array<string> = [];
    const chromeApi: ChromeInspectedWindowApi = {
      devtools: {
        inspectedWindow: {
          eval: (expression, callback) => {
            evaluatedExpressions.push(expression);
            callback({
              panels,
              selectedPanelId: "resources",
              title: "Smoke Sunfall Arc",
            });
          },
        },
      },
    };

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousHTMLElement = globalThis.HTMLElement;
    const previousChrome = Reflect.get(globalThis, "chrome");
    Reflect.set(globalThis, "window", window);
    Reflect.set(globalThis, "document", window.document);
    Reflect.set(globalThis, "HTMLElement", window.HTMLElement);
    Reflect.set(globalThis, "chrome", chromeApi);

    try {
      const entrypoint = await import("./panel.js");

      expect(evaluatedExpressions[0]).toBe(sunfallArcDevtoolsBridgeExpression);
      expect(root.innerHTML).toContain("Smoke Sunfall Arc");
      expect(root.innerHTML).toContain("Project.byId:atlas");
      expect(
        root.querySelector('[data-sunfall-arc-devtools-panel-target="resources"]'),
      ).not.toBeNull();
      await Effect.runPromise(Fiber.interrupt(entrypoint.devtoolsExtensionPanelBootFiber));
      expect(root.innerHTML).toBe("");
    } finally {
      Reflect.set(globalThis, "window", previousWindow);
      Reflect.set(globalThis, "document", previousDocument);
      Reflect.set(globalThis, "HTMLElement", previousHTMLElement);
      if (previousChrome === undefined) {
        Reflect.deleteProperty(globalThis, "chrome");
      } else {
        Reflect.set(globalThis, "chrome", previousChrome);
      }
      window.close();
    }
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
              title: "Live Sunfall Arc",
            });
          },
        },
      },
    };

    const payload = await Effect.runPromise(readInspectedWindowDevtoolsPayloadEffect(api));

    expect(evaluatedExpressions).toEqual([sunfallArcDevtoolsBridgeExpression]);
    expect(payload).toEqual({
      panels,
      selectedPanelId: "resources",
      title: "Live Sunfall Arc",
    });
    expect(validBridgePayload(null)).toBeUndefined();
    expect(validBridgePayload({ panels: { version: 2, panels: [] } })).toBeUndefined();
    expect(
      validBridgePayload({
        panels: {
          version: 1,
          panels: [
            {
              id: "not-a-panel",
              title: "Bad",
              summary: "Bad",
              severity: "ok",
              metrics: [],
              items: [],
            },
          ],
        },
      }),
    ).toBeUndefined();
    const duplicateItemPanels = {
      ...panels,
      panels: panels.panels.map((panel) =>
        panel.id === "requests"
          ? {
              ...panel,
              items: [panel.items[0]!, { ...panel.items[0]!, label: "Duplicate request" }],
            }
          : panel,
      ),
    };
    expect(validBridgePayload({ panels: duplicateItemPanels })).toBeUndefined();
    expect(
      validBridgePayload({
        panels,
        selectedPanelId: "not-a-panel",
      }),
    ).toEqual({ panels });
  });

  it("normalizes bridge payloads generated from huge resource arrays", () => {
    const panels = Devtools.describePanels({
      snapshot: {
        resources: Array.from({ length: 1_001 }, (_value, index) => ({
          key: `Extension.resource:${index}`,
          state: "Success",
        })),
        actions: [],
        invalidations: [],
        routePlans: [],
      },
    });
    const payload = validBridgePayload({
      panels,
      selectedPanelId: "resources",
      title: "Live Sunfall Arc",
    });

    const resourcesPanel = payload?.panels.panels.find((panel) => panel.id === "resources");
    expect(payload?.selectedPanelId).toBe("resources");
    expect(resourcesPanel?.items).toHaveLength(1_000);
    expect(resourcesPanel?.items[999]).toMatchObject({
      id: "__sunfall-arc-devtools-overflow:resources",
      label: "2 panel items hidden",
      severity: "info",
      data: {
        total: 1_001,
        shown: 999,
        hidden: 2,
      },
    });
  });

  it("does not override panel selection when live payloads omit selectedPanelId", async () => {
    const panels = sampleDevtoolsPanels();
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };

    await Effect.runPromise(
      updateFromInspectedWindowEffect(mount, {
        devtools: {
          inspectedWindow: {
            eval: (_expression, callback) => {
              callback({
                panels,
                title: "Live Sunfall Arc",
              });
            },
          },
        },
      }),
    );

    expect(updates).toEqual([
      {
        panels,
        title: "Live Sunfall Arc",
      },
    ]);
    expect(Object.prototype.hasOwnProperty.call(updates[0] ?? {}, "selectedPanelId")).toBe(false);
  });

  it("polls inspected-window payloads once immediately and sleeps before the next read", async () => {
    const panels = sampleDevtoolsPanels();
    const evaluatedExpressions: Array<string> = [];
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };
    const api: ChromeInspectedWindowApi = {
      devtools: {
        inspectedWindow: {
          eval: (expression, callback) => {
            evaluatedExpressions.push(expression);
            callback({
              panels,
              selectedPanelId: "resources",
              title: "Live Sunfall Arc",
            });
          },
        },
      },
    };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* pollInspectedWindowEffect(mount, api, { pollInterval: "40 millis" });
          yield* Effect.sleep("10 millis");
          yield* Effect.sync(() => {
            expect(evaluatedExpressions).toEqual([sunfallArcDevtoolsBridgeExpression]);
            expect(updates).toHaveLength(1);
          });
          yield* Effect.sleep("60 millis");
          yield* Effect.sync(() => {
            expect(evaluatedExpressions.length).toBeGreaterThanOrEqual(2);
            expect(updates.length).toBeGreaterThanOrEqual(2);
          });
        }),
      ),
    );
  });

  it("bounds inspected-window bridge strings before updating live panels", async () => {
    const panels = sampleDevtoolsPanels();
    const longString = "x".repeat(1_050);
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };

    await Effect.runPromise(
      updateFromInspectedWindowEffect(mount, {
        devtools: {
          inspectedWindow: {
            eval: (_expression, callback) => {
              callback({
                panels: {
                  version: 1,
                  panels: panels.panels.map((panel) =>
                    panel.id === "resources"
                      ? {
                          ...panel,
                          title: longString,
                          summary: longString,
                          metrics: [{ label: longString, value: longString }],
                          items: [
                            {
                              id: "resource:long",
                              label: longString,
                              severity: "ok",
                              detail: longString,
                              data: { value: longString },
                            },
                          ],
                        }
                      : panel,
                  ),
                },
                selectedPanelId: "resources",
                title: longString,
              });
            },
          },
        },
      }),
    );

    const boundedLongString = longString.slice(0, 1_000);
    const resourcesPanel = updates[0]?.panels?.panels.find((panel) => panel.id === "resources");
    expect(updates[0]?.title).toBe(boundedLongString);
    expect(resourcesPanel).toMatchObject({
      title: boundedLongString,
      summary: boundedLongString,
      metrics: [
        {
          label: boundedLongString,
          value: boundedLongString,
        },
      ],
      items: [
        expect.objectContaining({
          label: boundedLongString,
          detail: boundedLongString,
          data: {
            value: boundedLongString,
          },
        }),
      ],
    });
  });

  it("returns no live payload when the inspected-window bridge is unavailable", async () => {
    await expect(
      Effect.runPromise(readInspectedWindowDevtoolsPayloadEffect(undefined)),
    ).resolves.toBeUndefined();
  });

  it("reports diagnostics without sample facts when a live bridge later disappears", async () => {
    const livePanels = sampleDevtoolsPanels();
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    let reads = 0;
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };
    const api: ChromeInspectedWindowApi = {
      devtools: {
        inspectedWindow: {
          eval: (_expression, callback) => {
            reads++;
            callback(
              reads === 1
                ? {
                    panels: livePanels,
                    selectedPanelId: "resources",
                    title: "Live Sunfall Arc",
                  }
                : null,
            );
          },
        },
      },
    };

    await Effect.runPromise(updateFromInspectedWindowEffect(mount, api));
    await Effect.runPromise(updateFromInspectedWindowEffect(mount, api));

    expect(updates[0]).toMatchObject({
      panels: livePanels,
      selectedPanelId: "resources",
      title: "Live Sunfall Arc",
    });
    expect(updates[1]).toMatchObject({
      selectedPanelId: "diagnostics",
      title: "Sunfall Arc Devtools Extension",
    });
    const update = updates[1];
    if (update?.panels === undefined) {
      expect.fail("Expected the panel update to include missing-bridge diagnostics.");
    }
    const html = Devtools.renderPanelsHtml({
      panels: update.panels,
      selectedPanelId: update.selectedPanelId ?? "diagnostics",
      title: update.title ?? "Sunfall Arc Devtools Extension",
    });
    expect(html).toContain("Inspected-window bridge unavailable");
    expect(html).toContain("__SUNFALL_ARC_DEVTOOLS__");
    expect(html).not.toContain("GET /projects/atlas");
    expect(html).not.toContain("Project.byId:atlas");
  });

  it("reports malformed inspected-window bridge payloads as transport errors", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        readInspectedWindowDevtoolsPayloadEffect({
          devtools: {
            inspectedWindow: {
              eval: (_expression, callback) => {
                callback({ panels: { version: 2, panels: [] } });
              },
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevtoolsExtensionTransportError);
    expect(error).toMatchObject({
      _tag: "DevtoolsExtensionTransportError",
      operation: "read-inspected-window",
      reason: "InvalidPayload",
      error: {
        contract: {
          _tag: "DevtoolsPanelContractError",
          reason: "InvalidVersion",
          path: "version",
        },
        payload: {
          panels: {
            version: 2,
          },
        },
      },
      guidance: expect.stringContaining("Devtools.Panels bridge contract"),
    });
  });

  it("reports asynchronous cyclic inspected-window bridge payloads as typed errors", async () => {
    const panels = sampleDevtoolsPanels();
    const cyclicData: Record<string, unknown> = {};
    cyclicData.self = cyclicData;
    const error = await Effect.runPromise(
      Effect.flip(
        readInspectedWindowDevtoolsPayloadEffect({
          devtools: {
            inspectedWindow: {
              eval: (_expression, callback) => {
                queueMicrotask(() => {
                  callback({
                    panels: {
                      version: 1,
                      panels: panels.panels.map((panel) =>
                        panel.id === "requests"
                          ? {
                              ...panel,
                              items: [
                                {
                                  id: "request:cycle",
                                  label: "Cycle",
                                  severity: "ok",
                                  data: cyclicData,
                                },
                              ],
                            }
                          : panel,
                      ),
                    },
                  });
                });
              },
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevtoolsExtensionTransportError);
    expect(error).toMatchObject({
      _tag: "DevtoolsExtensionTransportError",
      operation: "read-inspected-window",
      reason: "InvalidPayload",
      guidance: expect.stringContaining("Devtools.Panels bridge contract"),
    });
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
                  description: "bridge unavailable",
                });
              },
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevtoolsExtensionTransportError);
    expect(error).toMatchObject({
      _tag: "DevtoolsExtensionTransportError",
      operation: "read-inspected-window",
      reason: "EvaluationFailure",
      error: {
        description: "bridge unavailable",
      },
      guidance: expect.stringContaining("__SUNFALL_ARC_DEVTOOLS__"),
    });
  });

  it("renders inspected-window transport failures in the diagnostics panel", async () => {
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };

    await Effect.runPromise(
      updateFromInspectedWindowEffect(mount, {
        devtools: {
          inspectedWindow: {
            eval: (_expression, callback) => {
              callback(undefined, {
                isException: true,
                description: "bridge unavailable",
              });
            },
          },
        },
      }),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      selectedPanelId: "diagnostics",
      title: "Sunfall Arc Devtools Extension",
    });
    const update = updates[0];
    if (update?.panels === undefined) {
      expect.fail("Expected the panel update to include transport-error panels.");
    }
    const html = Devtools.renderPanelsHtml({
      panels: update.panels,
      selectedPanelId: update.selectedPanelId ?? "diagnostics",
      title: update.title ?? "Sunfall Arc Devtools Extension",
    });

    expect(html).toContain("Inspected-window bridge unavailable");
    expect(html).toContain("bridge unavailable");
    expect(html).toContain("__SUNFALL_ARC_DEVTOOLS__");
    expect(html).not.toContain("GET /projects/atlas");
    expect(html).not.toContain("Project.byId:atlas");
  });

  it("projects transport errors as valid panel data", () => {
    const panels = devtoolsExtensionTransportErrorPanels(
      new DevtoolsExtensionTransportError({
        operation: "read-inspected-window",
        error: { description: "not installed" },
        guidance: "Install the bridge.",
      }),
    );

    expect(panels.panels.find((panel) => panel.id === "diagnostics")).toMatchObject({
      severity: "error",
      summary: "Inspected-window bridge error",
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "extension-transport-error",
          severity: "error",
          data: expect.objectContaining({
            operation: "read-inspected-window",
            description: "not installed",
            error: {
              description: "not installed",
            },
          }),
        }),
      ]),
    });
  });

  it("guards inspected-window error descriptions while building diagnostics panels", () => {
    const error = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === "description") {
            throw "description trap failed";
          }
          return undefined;
        },
      },
    );
    const panels = devtoolsExtensionTransportErrorPanels(
      new DevtoolsExtensionTransportError({
        operation: "read-inspected-window",
        error,
        guidance: "Install the bridge.",
      }),
    );

    expect(panels.panels.find((panel) => panel.id === "diagnostics")).toMatchObject({
      items: [
        expect.objectContaining({
          id: "extension-transport-error",
          data: expect.objectContaining({
            description: "Unknown inspected-window eval failure.",
          }),
        }),
      ],
    });
  });

  it("keeps malformed inspected-window payload details in diagnostics data", () => {
    const panels = devtoolsExtensionTransportErrorPanels(
      new DevtoolsExtensionTransportError({
        operation: "read-inspected-window",
        error: { panels: { version: 2, panels: [] } },
        guidance: "Install the bridge.",
      }),
    );

    expect(panels.panels.find((panel) => panel.id === "diagnostics")).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: "extension-transport-error",
          data: expect.objectContaining({
            operation: "read-inspected-window",
            description: "Unknown inspected-window eval failure.",
            error: {
              panels: {
                version: 2,
                panels: [],
              },
            },
          }),
        }),
      ]),
    });
  });

  it("times out inspected-window evals that never call back and renders diagnostics", async () => {
    const updates: Array<Devtools.PanelUiInput | undefined> = [];
    const mount: Devtools.PanelMount = {
      root: {} as HTMLElement,
      update: (input?: Devtools.PanelUiInput) => {
        updates.push(input);
      },
      unmount: () => undefined,
    };

    await Effect.runPromise(
      updateFromInspectedWindowEffect(
        mount,
        {
          devtools: {
            inspectedWindow: {
              eval: () => {
                // Simulates a broken inspected-window adapter that never invokes Chrome's callback.
              },
            },
          },
        },
        { timeoutMillis: 5 },
      ),
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      selectedPanelId: "diagnostics",
      title: "Sunfall Arc Devtools Extension",
    });
    const update = updates[0];
    if (update?.panels === undefined) {
      expect.fail("Expected the timeout update to include diagnostics panels.");
    }
    const html = Devtools.renderPanelsHtml({
      panels: update.panels,
      selectedPanelId: update.selectedPanelId ?? "diagnostics",
      title: update.title ?? "Sunfall Arc Devtools Extension",
    });

    expect(html).toContain("Inspected-window bridge unavailable");
    expect(html).toContain("Timeout");
    expect(html).toContain("did not call back within 5ms");
    expect(html).not.toContain("GET /projects/atlas");
  });

  it("reports synchronous inspected-window eval throws as typed errors", async () => {
    const thrown = { message: "eval unavailable" };
    const error = await Effect.runPromise(
      Effect.flip(
        readInspectedWindowDevtoolsPayloadEffect({
          devtools: {
            inspectedWindow: {
              eval: () => {
                throw thrown;
              },
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevtoolsExtensionTransportError);
    expect(error).toMatchObject({
      _tag: "DevtoolsExtensionTransportError",
      operation: "read-inspected-window",
      reason: "EvaluationFailure",
      error: thrown,
      guidance: expect.stringContaining("__SUNFALL_ARC_DEVTOOLS__"),
    });
  });
});
