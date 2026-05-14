import { describe, expect, it } from "vitest";
import { app } from "./app-definition.js";
import { handleRequest } from "./server.js";

describe("basic starter", () => {
  it("renders the SSR shell and route-owned Resource preload", async () => {
    const response = await app.runtime.runPromise(
      handleRequest(new Request("https://starter.test/"))
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-effect-ui-starter")).toBe("basic");
    expect(html).toContain("Hello, Effect UI.");
    expect(html).toContain("__EFFECT_UI_HYDRATION__");
  });
});
