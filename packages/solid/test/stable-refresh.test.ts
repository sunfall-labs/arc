import { makeRuntime, Resource } from "@sunfall/arc-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Component } from "../src/index.js";
import { stableRefreshApp, type Project } from "./stable-refresh-fixture.jsx";

const atlas: Project = {
  id: "atlas",
  name: "Atlas",
  owner: { name: "Ada" },
  tags: ["core"],
  updatedAt: 1,
};

/** Mounts the editor over `source` and waits for its first render. */
const mountEditor = (source: { current: Project }) =>
  Effect.gen(function* () {
    const app = stableRefreshApp(source);
    const runtime = makeRuntime();
    const container = document.createElement("div");
    yield* Component.mount(app.Page, container, { runtime });
    const input = () => container.querySelector("input")!;
    const owner = () => container.querySelector(".owner")!.textContent;
    yield* Effect.promise(() => vi.waitFor(() => expect(input().value).toBe("Atlas")));
    const refresh = runtime.provide(Resource.refresh(app.ProjectById("atlas")));
    // Lets every reaction to a refresh run before the DOM is inspected.
    const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)));
    return { ...app, input, owner, refresh, settle };
  });

describe("Resource refresh", () => {
  it("keeps typed text in an input bound to a field a refresh did not change", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = { current: atlas };
          const editor = yield* mountEditor(source);
          const runs = { ...editor.runs };

          // The user types; the refresh loads a new, equal object.
          editor.input().value = "Atlas Prime";
          yield* editor.refresh;
          yield* editor.settle;
          expect(editor.input().value).toBe("Atlas Prime");
          expect(editor.runs).toEqual(runs);

          // A real change to the field reaches the input.
          source.current = { ...atlas, name: "Atlas II" };
          yield* editor.refresh;
          yield* Effect.promise(() =>
            vi.waitFor(() => expect(editor.input().value).toBe("Atlas II")),
          );
        }),
      ),
    ));

  it("re-runs only the bindings to fields that changed", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = { current: atlas };
          const editor = yield* mountEditor(source);
          const nameRuns = editor.runs.name;

          editor.input().value = "Atlas Prime";
          source.current = { ...atlas, owner: { name: "Grace" }, updatedAt: 2 };
          yield* editor.refresh;
          yield* Effect.promise(() => vi.waitFor(() => expect(editor.owner()).toBe("Grace")));
          expect(editor.runs.name).toBe(nameRuns);
          expect(editor.input().value).toBe("Atlas Prime");
        }),
      ),
    ));
});
