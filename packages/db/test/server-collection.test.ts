import { Server, type EffectInputCallbackError, type ServerClientError } from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("Server functions as collection sync operations", () => {
  it("forwards mutation payloads to server function handlers", () => {
    const inserts: Array<Collection.SyncInsertPayload<Project, string>> = [];
    const updates: Array<Collection.SyncUpdatePayload<Project, string>> = [];
    const deletes: Array<Collection.SyncDeletePayload<Project, string>> = [];
    const insert = Server.fn<Collection.SyncInsertPayload<Project, string>, void>(
      "Projects.server.insert",
      {
        handler: (payload) =>
          Effect.sync(() => {
            inserts.push(payload);
          }),
      },
    );
    const update = Server.fn<Collection.SyncUpdatePayload<Project, string>, void>(
      "Projects.server.update",
      {
        handler: (payload) =>
          Effect.sync(() => {
            updates.push(payload);
          }),
      },
    );
    const remove = Server.fn<Collection.SyncDeletePayload<Project, string>, void>(
      "Projects.server.delete",
      {
        handler: (payload) =>
          Effect.sync(() => {
            deletes.push(payload);
          }),
      },
    );
    const Projects = Collection.define<
      Project,
      string,
      ServerClientError | EffectInputCallbackError
    >({
      name: "Projects.server.mutations",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", archived: false }],
      sync: { insert, update, delete: remove },
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Projects.insert({ id: "lumen", name: "Lumen", archived: false });
        yield* Projects.update("atlas", { name: "Atlas Prime" });
        yield* Projects.delete("lumen");

        yield* Effect.sync(() => {
          expect(inserts).toMatchObject([
            {
              values: [{ id: "lumen", name: "Lumen", archived: false }],
              transaction: {
                collection: "Projects.server.mutations",
                mutations: [
                  {
                    _tag: "Insert",
                    key: "lumen",
                    value: { id: "lumen", name: "Lumen", archived: false },
                  },
                ],
              },
            },
          ]);
          expect(updates).toMatchObject([
            {
              updates: [
                {
                  key: "atlas",
                  previous: { id: "atlas", name: "Atlas", archived: false },
                  value: { id: "atlas", name: "Atlas Prime", archived: false },
                  changes: { name: "Atlas Prime" },
                },
              ],
              transaction: {
                collection: "Projects.server.mutations",
                mutations: [{ _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } }],
              },
            },
          ]);
          expect(deletes).toMatchObject([
            {
              deletes: [
                {
                  key: "lumen",
                  previous: { id: "lumen", name: "Lumen", archived: false },
                },
              ],
              transaction: {
                collection: "Projects.server.mutations",
                mutations: [{ _tag: "Delete", key: "lumen" }],
              },
            },
          ]);
        });
      }),
    );
  });
});
