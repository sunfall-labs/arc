import { Server } from "@effect-ui/core";
import { Collection } from "@effect-ui/db";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  ServerCollectionMissingIdentity,
  serverCollectionOptions,
  type ServerCollectionDeletePayload,
  type ServerCollectionInsertPayload,
  type ServerCollectionUpdatePayload
} from "../src/server-collection.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

describe("serverCollectionOptions", () => {
  it("requires a stable collection identity", () => {
    try {
      serverCollectionOptions<Project>(
        // @ts-expect-error missing stable collection identity is rejected at runtime
        {
          getKey: (project) => project.id
        }
      );
      expect.fail("Expected serverCollectionOptions to reject missing identity");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerCollectionMissingIdentity);
      expect(error).toMatchObject({
        _tag: "ServerCollectionMissingIdentity",
        guidance: expect.stringContaining("stable name or id")
      });
    }
  });

  it("uses load for preload and refetch for later refreshes", () => {
    const load = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", archived: false }
      ])
    );
    const refetch = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "lumen", name: "Lumen", archived: true }
      ])
    );
    const Projects = Collection.define(serverCollectionOptions<Project>({
      id: "Projects.server.load-refetch",
      getKey: (project) => project.id,
      load,
      refetch
    }));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => Projects.preload());

        yield* Effect.sync(() => {
          expect(Projects.name).toBe("Projects.server.load-refetch");
          expect(Projects.rows().map((project) => project.id)).toEqual(["atlas"]);
          expect(load).toHaveBeenCalledTimes(1);
          expect(refetch).not.toHaveBeenCalled();
        });

        yield* Effect.promise(() => Projects.refetch());

        yield* Effect.sync(() => {
          expect(Projects.rows().map((project) => project.id)).toEqual(["lumen"]);
          expect(load).toHaveBeenCalledTimes(1);
          expect(refetch).toHaveBeenCalledTimes(1);
        });
      })
    );
  });

  it("forwards mutation payloads to server function handlers", () => {
    const inserts: Array<ServerCollectionInsertPayload<Project, string>> = [];
    const updates: Array<ServerCollectionUpdatePayload<Project, string>> = [];
    const deletes: Array<ServerCollectionDeletePayload<Project, string>> = [];
    const insert = Server.fn<ServerCollectionInsertPayload<Project, string>, void>(
      "Projects.server.insert",
      {
        handler: (payload) =>
          Effect.sync(() => {
            inserts.push(payload);
          })
      }
    );
    const update = Server.fn<ServerCollectionUpdatePayload<Project, string>, void>(
      "Projects.server.update",
      {
        handler: (payload) =>
          Effect.sync(() => {
            updates.push(payload);
          })
      }
    );
    const remove = Server.fn<ServerCollectionDeletePayload<Project, string>, void>(
      "Projects.server.delete",
      {
        handler: (payload) =>
          Effect.sync(() => {
            deletes.push(payload);
          })
      }
    );
    const Projects = Collection.define(serverCollectionOptions<Project>({
      name: "Projects.server.mutations",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", archived: false }
      ],
      insert,
      update,
      delete: remove
    }));

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => Projects.insert({ id: "lumen", name: "Lumen", archived: false }));
        yield* Effect.promise(() => Projects.update("atlas", { name: "Atlas Prime" }));
        yield* Effect.promise(() => Projects.delete("lumen"));

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
                    value: { id: "lumen", name: "Lumen", archived: false }
                  }
                ]
              }
            }
          ]);
          expect(updates).toMatchObject([
            {
              updates: [
                {
                  key: "atlas",
                  previous: { id: "atlas", name: "Atlas", archived: false },
                  value: { id: "atlas", name: "Atlas Prime", archived: false },
                  changes: { name: "Atlas Prime" }
                }
              ],
              transaction: {
                collection: "Projects.server.mutations",
                mutations: [{ _tag: "Update", key: "atlas", changes: { name: "Atlas Prime" } }]
              }
            }
          ]);
          expect(deletes).toMatchObject([
            {
              deletes: [
                {
                  key: "lumen",
                  previous: { id: "lumen", name: "Lumen", archived: false }
                }
              ],
              transaction: {
                collection: "Projects.server.mutations",
                mutations: [{ _tag: "Delete", key: "lumen" }]
              }
            }
          ]);
        });
      })
    );
  });
});
