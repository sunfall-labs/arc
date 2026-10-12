import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createRequestHandler, type StartHydrationPayload } from "../src/index.js";
import { hydrationScriptId, streamHydrationAttribute } from "../src/hydration.js";
import { verdictsApp, viewerServer } from "./route-verdicts-fixture.js";

const handler = createRequestHandler(verdictsApp, { implementations: [viewerServer] });

const render = (url: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* handler(new Request(url));
        return { response, html: yield* Effect.promise(() => response.text()) };
      }),
    ),
  );

const jsonScripts = (html: string, attribute: string) =>
  Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))
    .filter((match) => (match[1] ?? "").includes(attribute))
    .map((match) => JSON.parse(match[2] ?? "null") as unknown);

const rootPayload = (html: string) =>
  jsonScripts(html, `id="${hydrationScriptId}"`)[0] as StartHydrationPayload;

const hydrated = (html: string): ReadonlyArray<string> =>
  (
    jsonScripts(html, streamHydrationAttribute) as ReadonlyArray<{
      readonly payload: StartHydrationPayload;
    }>
  ).flatMap((chunk) => chunk.payload.resources.map((resource) => resource.key));

describe("route verdicts in Start", () => {
  it("renders a matched route whose record exists", async () => {
    const { response, html } = await render("https://arc.test/items/atlas");
    expect(response.status).toBe(200);
    expect(html).toContain('<p class="item">Atlas</p>');
  });

  it("answers 404 when the preload says Route.notFound(), hydrating what loaded before it", async () => {
    const { response, html } = await render("https://arc.test/items/nope");
    expect(response.status).toBe(404);
    // The server's router starts NotFound, so the item page never renders.
    expect(html).toContain('<p class="not-found">Not found</p>');
    expect(html).not.toContain("missing");
    expect(html).toContain("<header>Ada</header>");
    expect(rootPayload(html).notFound).toBe(true);
    expect(hydrated(html)).toEqual(['RouteVerdicts.viewer:"me"']);
  });

  it("answers a redirect when the preload says Route.redirect(...), rendering nothing", async () => {
    const { response, html } = await render("https://arc.test/private");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/items/atlas?from=private");
    expect(html).toBe("");
  });

  it("loads and hydrates a Resource the render reads but no route preloads", async () => {
    // No route matches, so nothing preloads: the shell's read runs during the
    // render with the request's services (the in-process server-function
    // client) and its value hydrates with the page.
    const { response, html } = await render("https://arc.test/unknown");
    expect(response.status).toBe(404);
    expect(html).toContain("<header>Ada</header>");
    expect(hydrated(html)).toEqual(['RouteVerdicts.viewer:"me"']);
  });
});
