import { Effect, Fiber } from "effect";
import { renderDevtoolsPanelsHtml } from "@effect-ui/devtools";
import { Window } from "happy-dom";
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

  it("boots the actual panel entrypoint with a DOM root", async () => {
    const window = new Window({ url: "https://effect-ui.local/devtools-panel" });
    const root = window.document.createElement("div");
    root.id = "devtools-root";
    window.document.body.append(root);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousHTMLElement = globalThis.HTMLElement;
    Reflect.set(globalThis, "window", window);
    Reflect.set(globalThis, "document", window.document);
    Reflect.set(globalThis, "HTMLElement", window.HTMLElement);

    try {
      const entrypoint = await import("./main.js");

      expect(root.innerHTML).toContain("Effect UI Devtools Panel");
      expect(root.innerHTML).toContain("GET /projects/atlas");
      expect(root.querySelector("[data-effect-ui-devtools-panel-target=\"requests\"]")).not.toBeNull();
      await Effect.runPromise(Fiber.interrupt(entrypoint.devtoolsPanelBootFiber));
      expect(root.innerHTML).toBe("");
    } finally {
      Reflect.set(globalThis, "window", previousWindow);
      Reflect.set(globalThis, "document", previousDocument);
      Reflect.set(globalThis, "HTMLElement", previousHTMLElement);
      window.close();
    }
  });
});
