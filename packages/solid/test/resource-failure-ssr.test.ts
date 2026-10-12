import { makeRuntime, ResourceUntypedFailure } from "@sunfall/arc-core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import {
  failureMarkup,
  ProjectNotFound,
  resourceFailureApp,
  serializedBoundaries,
} from "./resource-failure-ssr-fixture.js";

describe("Component.resource failures (hydration)", () => {
  it("rebuilds the server-rendered failures from the wire and hydrates the same markup without loading", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { Root, events } = resourceFailureApp();
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              delete (globalThis as { $R?: unknown }).$R;
            }),
          );
          // Run the server's inline script, as the browser does before hydrating.
          new Function(serializedBoundaries)();

          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.dispose.pipe(Effect.orDie));
          const container = document.createElement("div");
          container.innerHTML = failureMarkup;
          const [projectText, statsText] = Array.from(container.childNodes).filter(
            (node) => node.nodeType === Node.TEXT_NODE,
          );

          yield* Component.mount(Root, container, { runtime, hydrate: true });

          // Both boundaries rendered the server's fallbacks into the server's
          // text nodes: no hydration key missed, nothing was re-created.
          expect(container.textContent).toBe("missing atlas|untyped DatabaseDown");
          expect(projectText?.textContent).toBe("missing atlas");
          expect(projectText?.parentNode).toBe(container);
          expect(statsText?.textContent).toBe("untyped DatabaseDown");
          expect(statsText?.parentNode).toBe(container);
          // The schema-declared failure decoded into the real class, so
          // `catchTags` matched it; the schema-less one is tag-only.
          expect(events.typed).toHaveLength(1);
          expect(events.typed[0]).toBeInstanceOf(ProjectNotFound);
          expect(events.typed[0]).toMatchObject({ id: "atlas" });
          expect(events.untyped).toHaveLength(1);
          expect(events.untyped[0]).toBeInstanceOf(ResourceUntypedFailure);
          expect(events.untyped[0]).toMatchObject({ tag: "DatabaseDown" });
          // Hydration rendered the failures without running the reads again.
          yield* Effect.sleep(10);
          expect(events.loads).toBe(0);
        }),
      ),
    ));
});
