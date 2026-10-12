// `App.launch` (from @sunfall/arc-start) in Solid's browser build: it restores
// the server's hydration payload and hydrates the server-rendered root.
import { makeRuntime, Resource } from "@sunfall/arc-core";
import { App, StartRootMissing } from "@sunfall/arc-start";
import { createComponent } from "@solidjs/web";
import { Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { Component } from "../src/index.js";
import { createHydrationScript, createStartHydrationPayload } from "../../start/src/hydration.js";
import { ssrApp, ssrMarkup } from "./component-ssr-fixture.js";

describe("App.launch", () => {
  it("hydrates the server-rendered root from the document's payload", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { App: Card, ProjectById, events } = ssrApp();
          const Root = Component.define("Root", function* (props: App.RootProps) {
            const Page = yield* Card;
            return () => createComponent(Page, { id: props.href.split("/").pop() ?? "" });
          });
          const app = App.define({ root: Root, routes: [] as const });

          // What the server sends: the rendered root plus Start's payload script.
          const server = makeRuntime();
          yield* Effect.addFinalizer(() => server.dispose.pipe(Effect.orDie));
          yield* server.provide(Resource.preload(ProjectById("atlas")));
          const resources = yield* server.provide(
            Resource.hydrationPayload([ProjectById("atlas")]),
          );
          const hydrationGlobal = globalThis as { _$HY?: unknown };
          hydrationGlobal._$HY = { events: [], completed: new WeakSet(), r: {} };
          document.body.innerHTML = `<div id="root">${ssrMarkup}</div>${createHydrationScript(
            createStartHydrationPayload(resources),
          )}`;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              delete hydrationGlobal._$HY;
              document.body.innerHTML = "";
            }),
          );
          const root = document.getElementById("root")!;
          const serverText = root.firstChild;
          expect(events.loads).toBe(1);

          const fiber = Effect.runFork(App.launch(app, { href: "/projects/atlas" }));
          yield* Effect.yieldNow;
          expect(root.textContent).toBe(ssrMarkup);
          expect(root.firstChild).toBe(serverText);
          // One client setup, no reload, no Loading flash.
          expect(events).toMatchObject({ setups: 1, loads: 1, fallbacks: 0 });

          yield* Fiber.interrupt(fiber);
          // Interrupting disposes the tree and the runtime (and its Layer).
          expect(events.released).toBe(1);
        }),
      ),
    ));

  it("fails with StartRootMissing when the document has no app root", () =>
    Effect.gen(function* () {
      const Root = Component.define("Root", function* () {
        yield* Effect.void;
        return () => "root";
      });
      const exit = yield* Effect.exit(
        App.launch(App.define({ root: Root, routes: [] as const }), { href: "/" }),
      );
      expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toMatchObject({
        _tag: "Some",
        value: expect.any(StartRootMissing),
      });
    }).pipe(Effect.runPromise));
});
