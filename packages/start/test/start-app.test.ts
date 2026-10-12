import { Resource, Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Layer, Logger, Schema, Context } from "effect";
import { describe, expect, it } from "vitest";
import { App, createRequestHandler } from "../src/index.js";
import { hydrationScriptId, streamHydrationAttribute } from "../src/hydration.js";
import { StartDevServerError, handleSsrDevRequest } from "../src/start-vite-dev-ssr.js";
import { StartRequestHandlerError } from "../src/start-request-handler-error.js";

interface Greeting {
  readonly text: string;
}
const Greeting = Context.Service<Greeting>("@sunfall/arc-start/test/StartApp/Greeting");

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

  it("renders unmatched URLs with the default document and a 404 status", async () => {
    const handler = createRequestHandler(app, {
      server: Layer.succeed(Greeting)({ text: "server" }),
    });
    const { response, html } = await render(handler, "https://arc.test/unknown");

    expect(response.status).toBe(404);
    // The document says it is a not-found render, so it hydrates as one at any URL.
    expect(html).toContain('"notFound":true');
    expect(html).not.toContain("<title>");
    expect(html).toContain('<div id="root">server /unknown</div>');
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});

describe("Vite dev SSR route preload warnings", () => {
  it("warns once per loaded handler about routes that preload without preloadResources", async () => {
    const UndeclaredRoute = Route.define("/undeclared", {
      preload: () => Effect.void,
    });
    const handler = createRequestHandler(
      App.define({
        root: Root,
        routes: [ProjectRoute, UndeclaredRoute] as const,
        client: Layer.succeed(Greeting)({ text: "client" }),
      }),
      { server: Layer.succeed(Greeting)({ text: "server" }) },
    );
    const devServer = {
      ssrLoadModule: () => Effect.succeed({ default: handler }),
      transformIndexHtml: (_url: string, html: string) => Effect.succeed(html),
    };
    const warnings: Array<string> = [];
    const captureWarnings = Logger.layer([
      Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") {
          warnings.push(String(message));
        }
      }),
    ]);
    const request = () =>
      handleSsrDevRequest(devServer, new Request("https://arc.test/projects/atlas")).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.text())),
        Effect.provide(captureWarnings),
      );

    await Effect.runPromise(request());
    await Effect.runPromise(request());

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Route "/undeclared" has a preload but no preloadResources');
    expect(warnings.join("\n")).not.toContain("/projects/:id");
  });
});

describe("dev SSR failure messages", () => {
  it("name the failure through tagged errors that carry no message of their own", () => {
    class RenderBroke extends Schema.TaggedError<RenderBroke>()("RenderBroke", {}) {}
    const error = new StartDevServerError({
      operation: "run-handler",
      error: new StartRequestHandlerError({
        operation: "handle-request",
        request: { method: "GET", url: "https://arc.test/issues/1" },
        cause: { _tag: "StartPreloadError", cause: new Error("cannot render synchronously") },
      }),
    });
    // Vite prints this line for a failed dev request; it used to be empty.
    expect(error.message).toBe(
      "Start dev SSR failed to run-handler: GET https://arc.test/issues/1 failed: StartPreloadError: cannot render synchronously",
    );
    expect(
      new StartDevServerError({ operation: "load-module", error: new RenderBroke() }).message,
    ).toBe("Start dev SSR failed to load-module: RenderBroke");
  });
});
