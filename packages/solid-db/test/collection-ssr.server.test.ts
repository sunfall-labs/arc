import { Route } from "@sunfall/arc-core";
import { App, createRequestHandler } from "@sunfall/arc-start";
import { isServer } from "@solidjs/web";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  failingProjectsApp,
  failingProjectsMarkup,
  ProjectsUnavailable,
} from "./collection-ssr-fixture.js";

describe("SolidDb.collection (server)", () => {
  it("renders a collection whose first load failed as not loaded, the state the client hydrates", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(isServer).toBe(true);
        const { Projects, Root, events } = failingProjectsApp(() =>
          Effect.fail(new ProjectsUnavailable()),
        );
        // The route preload fails (rendered as a route failure) and leaves the
        // collection failed on its first load.
        const Home = Route.define("/", {
          preloadCollections: [Projects],
          preload: () => Projects.preload(),
        });
        const handler = createRequestHandler(
          App.define({ root: Root, routes: [Home] as const, collections: [Projects] }),
        );
        const response = yield* Effect.scoped(handler(new Request("https://arc.test/")));
        const html = yield* Effect.promise(() => response.text());

        // Only the route preload loaded: a server render starts no loads.
        expect(events.loads).toBe(1);
        // Nothing threw to a boundary, so no error data was serialized into the page.
        expect(html).toContain(`<div id="root">${failingProjectsMarkup}</div>`);
        expect(events.renders).toEqual([failingProjectsMarkup]);
        expect(events.typedFallbacks).toBe(0);
        expect(html).not.toContain("_$HY.r[");
        const payload = JSON.parse(
          html.match(
            /<script type="application\/json" id="__SUNFALL_ARC_HYDRATION__">(.*?)<\/script>/s,
          )?.[1] ?? "null",
        );
        expect(payload.collections).toBeUndefined();
      }),
    ));
});
