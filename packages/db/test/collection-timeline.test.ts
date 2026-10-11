import { Signal, Timeline } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
}

describe("Collection Timeline causes", () => {
  it("labels collection load-state and row commits with the collection name", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const Projects = Collection.define<Project>({
          name: "Projects.timeline",
          getKey: (project) => project.id,
          load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
        });

        yield* Projects.preloadEffect();

        const entries = Signal.peek(recording.entries);
        expect(new Set(entries.map((entry) => Timeline.describe(entry.cause)))).toEqual(
          new Set(['Collection "Projects.timeline" sync', 'Collection "Projects.timeline" change']),
        );
        expect(
          new Set(entries.flatMap((entry) => entry.changes.map((change) => change.name))),
        ).toEqual(new Set(["Projects.timeline.loadState", "Projects.timeline.version"]));
      }).pipe(Effect.scoped),
    ));
});
