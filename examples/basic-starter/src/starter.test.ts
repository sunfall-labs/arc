import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { app } from "./app-definition.js";
import { handleRequest } from "./server.js";

describe("basic starter", () => {
  it("renders the SSR shell and route-owned Resource preload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          app.runtime.provide(handleRequest(new Request("https://starter.test/")))
        );
        const html = yield* Effect.tryPromise(() => response.text());

        expect(response.status).toBe(200);
        expect(response.headers.get("x-effect-ui-starter")).toBe("basic");
        expect(html).toContain("Hello, Effect UI.");
        expect(html).toContain("__EFFECT_UI_HYDRATION__");
      })
    ));
});
