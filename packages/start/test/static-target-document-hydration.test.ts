import { Resource, makeRuntime } from "@sunfall/arc-core";
import { Cause, Effect, Exit } from "effect";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { createHydrationScript } from "../src/hydration.js";
import {
  StartStaticNavigationHydrationError,
  hydrateStartStaticTargetDocumentEffect,
  type StartStaticTargetDocumentWindow,
} from "../src/static-target-document-hydration.js";

const asTargetDocumentWindow = (window: Window): StartStaticTargetDocumentWindow =>
  window as unknown as StartStaticTargetDocumentWindow;

const parseWithWindow =
  (window: Window) =>
  (html: string): Document =>
    new window.DOMParser().parseFromString(html, "text/html");

describe("Start static target document hydration", () => {
  it("fetches, parses, and hydrates a target static document through the Runtime Spine", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.family({
            name: "Start.Static.TargetDocument.Project.success",
            load: (_id: string) => Effect.fail(new Error("static target test has no loader")),
          });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScript({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  updatedAt: 1,
                },
              },
            ],
          })}</body></html>`;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const window = new Window({ url: "https://docs.test/app/" });
          const fetch = vi.fn(async () => new Response(html));

          const outcome = yield* hydrateStartStaticTargetDocumentEffect({
            runtime,
            href: "/projects/1",
            browserHref: "/app/projects/1",
            window: asTargetDocumentWindow(window),
            fetch,
            parseDocument: parseWithWindow(window),
          });
          const project = yield* runtime.provide(Resource.prefetchEffect(ref));

          expect(outcome).toMatchObject({
            _tag: "Hydrated",
            refs: [ref],
          });
          expect(project).toEqual({ id: "1", name: "Hydrated project" });
          expect(String(fetch.mock.calls[0]?.[0])).toBe("https://docs.test/app/projects/1");
          expect(fetch.mock.calls[0]?.[1]).toMatchObject({
            credentials: "same-origin",
            headers: { accept: "text/html" },
          });
        }),
      ),
    ));

  it("maps non-ok target document responses to a typed hydration error", async () => {
    const runtime = makeRuntime();
    try {
      const window = new Window({ url: "https://docs.test/app/" });
      const fetch = vi.fn(async () => new Response("missing", { status: 404 }));
      const exit = await Effect.runPromiseExit(
        hydrateStartStaticTargetDocumentEffect({
          runtime,
          href: "/projects/1",
          browserHref: "/app/projects/1",
          window: asTargetDocumentWindow(window),
          fetch,
          parseDocument: parseWithWindow(window),
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(StartStaticNavigationHydrationError);
        expect(error).toMatchObject({
          href: "/projects/1",
          browserHref: "/app/projects/1",
          reason: "HttpStatus",
          status: 404,
        });
      }
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });
});
