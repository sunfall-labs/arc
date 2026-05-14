// @vitest-environment happy-dom

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeRuntime, route } from "@effect-ui/core";
import type { BrowserRouter } from "../src/index.js";

vi.doMock("solid-js", () => import("solid-js/dist/solid.js"));
vi.doMock("solid-js/web", () => import("solid-js/web/dist/web.js"));

const { createRoot } = await import("solid-js");
const { createBrowserRouter } = await import("../src/index.js");

describe("createBrowserRouter", () => {
  it("runs route preload once per href", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let preloads = 0;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);

          const ProjectRoute = route("/projects/:id", {
            preload: () =>
              Effect.sync(() => {
                preloads++;
              })
          });

          let dispose: () => void = () => undefined;
          const router = createRoot((rootDispose): BrowserRouter<readonly [typeof ProjectRoute]> => {
            dispose = rootDispose;
            return createBrowserRouter([ProjectRoute] as const, {
              initialHref: "/projects/atlas",
              runtime
            });
          });
          yield* Effect.addFinalizer(() => Effect.sync(dispose));

          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/atlas"
            });
            expect(preloads).toBe(1);
          });

          yield* Effect.sync(() => {
            router.navigateHref("/projects/kepler");
          });
          yield* Effect.sleep("20 millis");

          yield* Effect.sync(() => {
            expect(router.state()).toMatchObject({
              _tag: "Ready",
              href: "/projects/kepler"
            });
            expect(preloads).toBe(2);
          });
        })
      )
    ));
});
