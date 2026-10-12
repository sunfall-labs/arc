import { Effect, Schema } from "effect";
import { Resource } from "@sunfall/arc-core";
import type { MutableResourceStore } from "@sunfall/arc-core/internal";
import { buildQuery, currentQueryStore, runWithQueryStore } from "@sunfall/arc-db/internal";

// Adapter plumbing shared by the Solid binding and tests; not application API.
const Projects = Resource.define({
  name: "type-tests/db-internal/projects",
  input: Schema.Literal("all"),
  output: Schema.Array(Schema.Struct({ id: Schema.String })),
  rows: { key: (project) => project.id },
  load: () => Effect.succeed([{ id: "atlas" }]),
});
const store: MutableResourceStore = currentQueryStore();
const rows: ReadonlyArray<{ readonly id: string }> = runWithQueryStore(store, () =>
  buildQuery((query) =>
    query.from({ project: Projects("all") }).select(({ project }) => project),
  ).execute(),
);
void rows;
