import { Resource, Route } from "@sunfall/arc-core";
import { App, createRequestHandler } from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { createComponent, isServer } from "@solidjs/web";
import { describe, expect, it, vi } from "vitest";
import { Component, RouterOutlet } from "../src/index.js";
import { ssrApp, ssrMarkup } from "./component-ssr-fixture.js";

describe("Component (server)", () => {
  it("renders the app root per request runtime, reading route-preloaded resources synchronously", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(isServer).toBe(true);
        const { App: Card, ProjectById, events } = ssrApp();
        const ProjectRoute = Route.define("/projects/:id", {
          params: Schema.Struct({ id: Schema.String }),
          preload: ({ params }) => Resource.preload(ProjectById(params.id)).pipe(Effect.asVoid),
        });
        // Start renders the app root with the request href.
        const Root = Component.define("Root", function* (props: App.RootProps) {
          const Page = yield* Card;
          return () => createComponent(Page, { id: props.href.split("/").pop() ?? "" });
        });
        const handler = createRequestHandler(
          App.define({ root: Root, routes: [ProjectRoute] as const }),
        );
        const request = Effect.fn(function* () {
          const response = yield* Effect.scoped(
            handler(new Request("https://arc.test/projects/atlas")),
          );
          return yield* Effect.promise(() => response.text());
        });

        expect(yield* request()).toContain(`<div id="root">${ssrMarkup}</div>`);
        // Setup ran (and the provided Layer was built) in the request runtime,
        // and the route preload made the read synchronous: no Loading fallback.
        expect(events).toMatchObject({ layerBuilds: 1, setups: 1, loads: 1, fallbacks: 0 });
        // Request runtime disposal released the Layer built for it.
        expect(events.released).toBe(1);

        expect(yield* request()).toContain(`<div id="root">${ssrMarkup}</div>`);
        expect(events).toMatchObject({ layerBuilds: 2, setups: 2, loads: 2, fallbacks: 0 });
        expect(events.released).toBe(2);
      }),
    ));

  it("renders and logs a defect under catchTags instead of a blank region, sending nothing of it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logged: Array<string> = [];
        const spies = (["log", "error", "warn"] as const).map((method) =>
          vi.spyOn(console, method).mockImplementation((...args: Array<unknown>) => {
            logged.push(args.map(String).join(" "));
          }),
        );
        try {
          class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
          const Broken = Component.define("Broken", function* () {
            yield* Effect.die(new Error("server-secret defect")) as Effect.Effect<never, Missing>;
            return (): string => "never";
          }).pipe(Component.catchTags({ Missing: () => "missing" }));
          const Root = Component.define("Root", function* (_props: App.RootProps) {
            const View = yield* Broken;
            return () => ["shell|", createComponent(View, {})];
          });
          const handler = createRequestHandler(App.define({ root: Root, routes: [] as const }));
          const response = yield* Effect.scoped(handler(new Request("https://arc.test/")));
          const html = yield* Effect.promise(() => response.text());
          expect(html).toContain('<div id="root">shell|Something went wrong.');
          expect(html).not.toContain("server-secret defect");
          // The server log keeps the original defect.
          expect(logged.join("\n")).toContain("server-secret defect");
        } finally {
          spies.forEach((spy) => spy.mockRestore());
        }
      }),
    ));

  it("renders the default not-found view when no notFound renderer is given", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Home = Route.define("/");
        const Root = Component.define("Root", function* (props: App.RootProps) {
          const router = yield* Component.router([Home] as const, { initialHref: props.href });
          return () => createComponent(RouterOutlet, { router });
        });
        const handler = createRequestHandler(App.define({ root: Root, routes: [Home] as const }));
        const response = yield* Effect.scoped(handler(new Request("https://arc.test/nowhere")));
        expect(response.status).toBe(404);
        expect(yield* Effect.promise(() => response.text())).toContain('<div id="root">Not found');
      }),
    ));
});
