import { defineApp, Resource, route } from "@sunfall/arc-core";
import { createRequestHandler } from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { createComponent, isServer, renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { ssrApp, ssrMarkup } from "./component-ssr-fixture.js";

describe("Component (server)", () => {
  it("renders per request runtime, reading route-preloaded resources synchronously", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(isServer).toBe(true);
        const { App, ProjectById, events } = ssrApp();
        const ProjectRoute = route("/projects/:id", {
          params: Schema.Struct({ id: Schema.String }),
          preload: ({ params }) =>
            Resource.prefetchEffect(ProjectById(params.id)).pipe(Effect.asVoid),
        });
        const app = defineApp({ routes: [ProjectRoute] as const, client: {} });
        const handler = createRequestHandler(app, {
          render: ({ runtime, match }) =>
            renderToString(() =>
              createComponent(Component.embed(App, runtime), { id: match?.params.id ?? "" }),
            ),
        });
        const request = Effect.fn(function* () {
          const response = yield* Effect.scoped(
            handler(new Request("https://arc.test/projects/atlas")),
          );
          return yield* Effect.promise(() => response.text());
        });

        expect(yield* request()).toBe(ssrMarkup);
        // Setup ran (and the provided Layer was built) in the request runtime,
        // and the route preload made the read synchronous: no Loading fallback.
        expect(events).toMatchObject({ layerBuilds: 1, setups: 1, loads: 1, fallbacks: 0 });
        // Request runtime disposal released the Layer built for it.
        expect(events.released).toBe(1);

        expect(yield* request()).toBe(ssrMarkup);
        expect(events).toMatchObject({ layerBuilds: 2, setups: 2, loads: 2, fallbacks: 0 });
        expect(events.released).toBe(2);
      }),
    ));
});
