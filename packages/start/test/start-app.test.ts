import { Action, ActionResult, makeRuntime, Resource, Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect, Layer, Schema, Context } from "effect";
import { describe, expect, it } from "vitest";
import { App, createRequestHandler, StartAction } from "../src/index.js";
import { hydrationScriptId, streamHydrationAttribute } from "../src/hydration.js";
import { StartDevServerError } from "../src/start-vite-dev-ssr.js";
import { StartRequestHandlerError } from "../src/start-request-handler-error.js";
import { actionTransportLayer } from "../src/start-action-transport.js";
import { rpcClientLayer } from "../src/start-rpc-client.js";
import { handlerFetch, testHttpClientLayer } from "./test-http-client.js";

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

  it("serves the implementations: Actions on the action endpoint, Resource loads over RPC", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Shared, browser-safe definitions.
        const Greet = Action.define({
          name: "StartApp.greet",
          input: Schema.String,
          output: Schema.String,
        });
        const GreetingFor = Resource.define({
          name: "StartApp.greetingFor",
          input: Schema.String,
          output: Schema.String,
        });
        // Server-only implementations, reading a service of the server Layer.
        const greet = Action.implement(Greet, (name) =>
          Greeting.useSync((greeting) => `${greeting.text} action ${name}`),
        );
        const greetingFor = Resource.implement(GreetingFor, (name) =>
          Greeting.useSync((greeting) => `${greeting.text} resource ${name}`),
        );
        const handler = createRequestHandler(app, {
          server: Layer.succeed(Greeting)({ text: "server" }),
          implementations: [greet, greetingFor],
        });
        const browser = makeRuntime(
          Layer.mergeAll(actionTransportLayer, rpcClientLayer).pipe(
            Layer.provide(testHttpClientLayer(handlerFetch(handler))),
          ),
        );

        expect(yield* Action.use(Greet, { runtime: browser }).submit("ada")).toBe(
          "server action ada",
        );
        expect(yield* browser.provide(Resource.preload(GreetingFor("ada")))).toBe(
          "server resource ada",
        );
        yield* browser.dispose;
      }),
    ));
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

describe("no-JavaScript form posts to a page", () => {
  const Rename = Action.define({
    name: "StartApp.rename",
    input: Schema.Struct({ id: Schema.String, name: Schema.String }),
    output: Schema.Union([ActionResult.Redirect, ActionResult.ValidationFailure]),
  });
  const rename = Action.implement(Rename, ({ id, name }) =>
    Effect.succeed(
      name.trim().length < 3
        ? ActionResult.validation<Record<string, unknown>, string>({
            fieldErrors: { name: ["Use at least three characters."] },
          })
        : ActionResult.redirect(`/projects/${id}`),
    ),
  );
  const FormRoute = Route.define("/projects/:id/rename", {
    params: Schema.Struct({ id: Schema.String }),
  });
  const RenamePage = Component.define("RenamePage", function* (_props: App.RootProps) {
    const handle = yield* Component.action(Rename);
    return () => {
      const result = handle.result();
      const value = result._tag === "Success" ? result.value : undefined;
      const error =
        value !== undefined && ActionResult.isValidationFailure(value)
          ? value.fieldErrors["name"]?.[0]
          : undefined;
      const posted = handle.formValues()?.["name"];
      return `name=[${typeof posted === "string" ? posted : ""}] error=[${error ?? ""}]`;
    };
  });
  const formApp = App.define({
    root: RenamePage,
    routes: [FormRoute] as const,
  });
  const handler = createRequestHandler(formApp, { implementations: [rename] });
  const post = (fields: Record<string, string>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const form = StartAction.form(Rename, { input: { id: "atlas" } });
          const body = new URLSearchParams([
            ...form.hiddenFields.map((field) => [field.name, field.value] as [string, string]),
            ...Object.entries(fields),
          ]);
          const response = yield* handler(
            new Request("https://example.com/projects/atlas/rename?tab=x", {
              method: form.method.toUpperCase(),
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body,
            }),
          );
          return { response, html: yield* Effect.promise(() => response.text()) };
        }),
      ),
    );

  it("follows the Action's redirect with a 303", async () => {
    const { response } = await post({ name: "Atlas 2" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/atlas");
  });

  it("renders the page again with the outcome and the fields when validation fails", async () => {
    const { response, html } = await post({ name: "At" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("name=[At] error=[Use at least three characters.]");
    const root = html.match(
      new RegExp(`<script[^>]*id="${hydrationScriptId}"[^>]*>([\\s\\S]*?)</script>`),
    )?.[1];
    expect(JSON.parse(root ?? "{}").postedAction).toMatchObject({
      action: "StartApp.rename",
      values: { name: "At" },
      input: { id: "atlas", name: "At" },
      outcome: { _tag: "ValidationFailure" },
    });
  });

  it("answers a form whose fields fail the input schema as its validation failure", async () => {
    const { response, html } = await post({});
    expect(response.status).toBe(422);
    expect(html).toContain("error=[Missing key]");
  });

  it("answers 404 for a form naming no served Action", async () => {
    const response = await Effect.runPromise(
      Effect.scoped(
        handler(
          new Request("https://example.com/projects/atlas/rename", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ __sunfall_arc_action: "Nope" }),
          }),
        ),
      ),
    );
    expect(response.status).toBe(404);
  });
});
