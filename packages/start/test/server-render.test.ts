import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createRequestHandler } from "../src/index.js";
import { probe, serverRenderApp } from "./server-render-fixture.js";

const handler = createRequestHandler(serverRenderApp);

const render = (url: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* handler(new Request(url));
        return { response, html: yield* Effect.promise(() => response.text()) };
      }),
    ),
  );

describe("server renders", () => {
  it("never subscribe a Resource's change feed", async () => {
    probe.feeds = 0;
    const { response, html } = await render("https://arc.test/board");
    expect(response.status).toBe(200);
    expect(html).toContain("[Alpha]");
    expect(html).toContain("1 cards");
    await Effect.runPromise(Effect.sleep("10 millis"));
    // Preloaded, read, and hydrated, but the browser follows the feed.
    expect(probe.feeds).toBe(0);
  });

  it("give each request its own app State, shared by the request's bindings", async () => {
    probe.toastRefs.length = 0;
    await render("https://arc.test/board");
    const [shell, page] = probe.toastRefs;
    expect(probe.toastRefs).toHaveLength(2);
    expect(page).toBe(shell);

    await render("https://arc.test/board");
    expect(probe.toastRefs).toHaveLength(4);
    expect(probe.toastRefs[2]).toBe(probe.toastRefs[3]);
    expect(probe.toastRefs[2]).not.toBe(shell);
  });
});
