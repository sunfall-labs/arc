import { Resource, Route } from "@sunfall/arc-core";
import { App, createRequestHandler } from "@sunfall/arc-start";
import { isServer } from "@solidjs/web";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  failureMarkup,
  ProjectNotFound,
  resourceFailureApp,
  secret,
  serializedBoundaries,
} from "./resource-failure-ssr-fixture.js";

describe("Component.resource failures (server)", () => {
  it("renders failed reads from their safe wire form and serializes nothing else", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(isServer).toBe(true);
        const { ProjectById, Stats, Root, events } = resourceFailureApp();
        // The route renders even though both loads fail: the page's
        // boundaries show the failures.
        const Home = Route.define("/", {
          preload: () => Resource.preload([ProjectById("atlas"), Stats("all")]).pipe(Effect.ignore),
        });
        const handler = createRequestHandler(App.define({ root: Root, routes: [Home] as const }));
        const response = yield* Effect.scoped(handler(new Request("https://arc.test/")));
        const html = yield* Effect.promise(() => response.text());

        // No server-only field reaches the page, in the markup or the serialized data.
        expect(html).not.toContain(secret);
        expect(html).toContain(
          `<div id="root">${failureMarkup}<script>${serializedBoundaries}</script></div>`,
        );
        // The server's handlers saw the values decoded from the wire: the typed
        // instance with its declared fields, and the tag-only untyped failure.
        expect(events.typed.length).toBeGreaterThan(0);
        for (const error of events.typed) {
          expect(error).toBeInstanceOf(ProjectNotFound);
          expect(error).toMatchObject({ id: "atlas" });
          expect(error).not.toHaveProperty("secret");
        }
        for (const error of events.untyped) {
          expect(error).toMatchObject({ _tag: "ResourceUntypedFailure", tag: "DatabaseDown" });
          expect(error).not.toHaveProperty("secret");
        }
        // Only the route preload loaded; the failures are not hydrated as data.
        expect(events.loads).toBe(2);
        expect(html).toContain('{"resources":[]}');
      }),
    ));
});
