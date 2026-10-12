// @vitest-environment happy-dom
import { Resource, makeRuntime } from "@sunfall/arc-core";
import { Cause, Effect, Exit } from "effect";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { createHydrationScriptSync } from "../src/hydration.js";
import {
  StartStaticNavigationHydrationError,
  hydrateStartStaticTargetDocument,
  type StartStaticTargetDocumentWindow,
} from "../src/static-target-document-hydration.js";

const asTargetDocumentWindow = (window: Window): StartStaticTargetDocumentWindow =>
  window as unknown as StartStaticTargetDocumentWindow;

const parseHtmlDocument = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

describe("Start static target document hydration", () => {
  it("fetches, parses, and hydrates a target static document through the Runtime Spine", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ProjectById = Resource.define({
            name: "Start.Static.TargetDocument.Project.success",
            load: (
              _id: string,
            ): Effect.Effect<{ readonly id: string; readonly name: string }, Error> =>
              Effect.fail(new Error("static target test has no loader")),
          });
          const ref = ProjectById("1");
          const html = `<!doctype html><html><body>${createHydrationScriptSync({
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success",
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  timestamp: 1,
                },
              },
            ],
          })}</body></html>`;
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => Effect.orDie(runtime.dispose));
          const window = new Window({ url: "https://docs.test/app/" });
          const fetch = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(html),
          );

          const outcome = yield* hydrateStartStaticTargetDocument({
            runtime,
            href: "/projects/1",
            browserHref: "/app/projects/1",
            window: asTargetDocumentWindow(window),
            fetch,
            parseDocument: parseHtmlDocument,
          });
          const project = yield* runtime.provide(Resource.preload(ref));

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
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response("missing", { status: 404 }),
      );
      const exit = await Effect.runPromiseExit(
        hydrateStartStaticTargetDocument({
          runtime,
          href: "/projects/1",
          browserHref: "/app/projects/1",
          window: asTargetDocumentWindow(window),
          fetch,
          parseDocument: parseHtmlDocument,
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
      await Effect.runPromise(runtime.dispose);
    }
  });
});
