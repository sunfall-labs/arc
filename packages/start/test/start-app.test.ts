import { Resource, Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Layer, Schema, Context } from "effect";
import { describe, expect, it } from "vitest";
import { App, createRequestHandler } from "../src/index.js";
import { hydrationScriptId, streamHydrationAttribute } from "../src/hydration.js";

class Greeting extends Context.Service<Greeting, { readonly text: string }>()(
  "@sunfall/arc-start/test/StartApp/Greeting",
) {}

const ProjectName = Resource.define({
  name: "StartApp.projectName",
  input: Schema.String,
  output: Schema.String,
  load: (id) => Effect.succeed(`Project ${id}`),
});

const ProjectRoute = Route.define("/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) => Resource.preload(ProjectName(params.id)),
  preloadResources: [ProjectName],
});

const Root = Component.define("Root", function* (props: App.RootProps) {
  const greeting = yield* Greeting;
  return () => `${greeting.text} ${props.href}`;
});

const app = App.define({
  root: Root,
  routes: [ProjectRoute] as const,
  client: Layer.succeed(Greeting)({ text: "client" }),
});

const render = (handler: ReturnType<typeof createRequestHandler>, url: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const response = yield* handler(new Request(url));
        return { response, html: yield* Effect.promise(() => response.text()) };
      }),
    ),
  );

describe("createRequestHandler(app)", () => {
  it("renders the app root into Start's document with hydration in order", async () => {
    const handler = createRequestHandler(app, {
      server: Layer.succeed(Greeting)({ text: "server" }),
      document: ({ match }) => ({
        title: `Project <${match?.href ?? "none"}>`,
        meta: [{ name: "description", content: 'say "hi"' }],
        links: [{ rel: "stylesheet", href: "/src/styles.css" }],
        headers: { "x-start-app": "yes" },
      }),
    });
    const { response, html } = await render(handler, "https://arc.test/projects/atlas?tab=1");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-start-app")).toBe("yes");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html.startsWith('<!doctype html><html lang="en"><head><meta charset="UTF-8" />')).toBe(
      true,
    );
    expect(html).toContain("<title>Project &lt;/projects/atlas?tab=1&gt;</title>");
    expect(html).toContain('<meta name="description" content="say &quot;hi&quot;" />');
    expect(html).toContain('<link rel="stylesheet" href="/src/styles.css" />');
    // The root renders with the server Layer and the request href.
    expect(html).toContain('<div id="root">server /projects/atlas?tab=1</div>');
    const order = [
      html.indexOf("_$HY"),
      html.indexOf('<div id="root">'),
      html.indexOf(streamHydrationAttribute),
      html.indexOf(hydrationScriptId),
      html.indexOf('<script type="module" src="/src/main.tsx"></script>'),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(html).toContain("Project atlas");
    expect(html.endsWith("</body></html>")).toBe(true);
  });

  it("renders unmatched URLs with the default document", async () => {
    const handler = createRequestHandler(app, {
      server: Layer.succeed(Greeting)({ text: "server" }),
    });
    const { response, html } = await render(handler, "https://arc.test/unknown");

    expect(response.status).toBe(200);
    expect(html).not.toContain("<title>");
    expect(html).toContain('<div id="root">server /unknown</div>');
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});
