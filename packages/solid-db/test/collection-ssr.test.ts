import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  failingProjectsApp,
  failingProjectsMarkup,
  ProjectsUnavailable,
} from "./collection-ssr-fixture.js";

describe("SolidDb.collection (hydration)", () => {
  it("hydrates the server markup of a collection whose first load failed, then loads it", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const loaded = yield* Deferred.make<void>();
          const { Root, events } = failingProjectsApp(() =>
            Deferred.await(loaded).pipe(Effect.andThen(Effect.fail(new ProjectsUnavailable()))),
          );
          // The server payload carries nothing for the failed collection, so the
          // client restores nothing and starts never-loaded, like the server render.
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
            }),
          );
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          const container = document.createElement("div");
          container.innerHTML = failingProjectsMarkup;
          const serverText = container.firstChild;

          yield* Component.mount(Root, container, { runtime, hydrate: true });
          // The hydration pass renders exactly the server markup and claims its node.
          expect(events.renders[0]).toBe(failingProjectsMarkup);
          expect(container.firstChild).toBe(serverText);
          expect(events.typedFallbacks).toBe(0);

          // Once the hydration pass settles, the client loads the collection
          // itself; its typed failure reaches `catchTags` like any client load.
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("projects: loading")),
          );
          expect(events.loads).toBe(1);
          yield* Deferred.succeed(loaded, undefined);
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(container.textContent).toBe("projects unavailable")),
          );
          expect(events).toMatchObject({ loads: 1, typedFallbacks: 1 });
        }),
      ),
    ));
});
