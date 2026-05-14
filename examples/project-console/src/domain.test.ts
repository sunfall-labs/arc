import { provideRequest, Server, ServerClient } from "@effect-ui/core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { getProject, listProjects, makeProjectId, makeProjectReturnTo, renameProject, submitProjectName } from "./domain.js";
import { Route as ProjectRoute } from "./routes/projects/$id.js";
import "./domain.server.js";

describe("project console domain", () => {
  it("brands route-safe project ids", () => {
    expect(makeProjectId("atlas-billing")).toBe("atlas-billing");
    expect(() => makeProjectId("Atlas Billing")).toThrow();
  });

  it("decodes project route params through the branded schema", () => {
    const match = ProjectRoute.match("/projects/atlas?tab=settings");

    expect(match?.params.id).toBe(makeProjectId("atlas"));
    expect(match?.search.tab).toBe("settings");
    expect(() => ProjectRoute.match("/projects/Atlas")).toThrow();
  });

  it("loads projects through server functions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Effect.provideService(
          listProjects.effect("all"),
          ServerClient,
          Server.localClient()
        );

        expect(projects.length).toBeGreaterThan(0);
      })
    ));

  it("renames and reloads a project", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const renamed = yield* Effect.provideService(
          renameProject.effect({ id: makeProjectId("atlas"), name: "Atlas Revenue" }),
          ServerClient,
          Server.localClient()
        );
        const loaded = yield* Effect.provideService(
          getProject.effect({ id: makeProjectId("atlas") }),
          ServerClient,
          Server.localClient()
        );

        expect(renamed.name).toBe("Atlas Revenue");
        expect(loaded.name).toBe("Atlas Revenue");
      })
    ));

  it("uses request-scoped context inside server mutations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const renamed = yield* provideRequest(
          new Request("https://example.com/projects/meridian", {
            headers: {
              "x-effect-ui-now-label": "request scoped"
            }
          })
        )(
          Effect.provideService(
            renameProject.effect({ id: makeProjectId("meridian"), name: "Meridian Insights" }),
            ServerClient,
            Server.localClient()
          )
        );

        expect(renamed.updatedAt).toBe("request scoped");
      })
    ));

  it("returns typed validation data for progressive project name submissions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provideService(
          submitProjectName.effect({ id: makeProjectId("atlas"), name: "At" }),
          ServerClient,
          Server.localClient()
        );

        expect(result._tag).toBe("ValidationFailure");
        if (result._tag === "ValidationFailure") {
          expect(result.fieldErrors.name?.[0]).toContain("three meaningful characters");
        }
      })
    ));

  it("returns a typed redirect after a valid progressive project name submission", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* Effect.provideService(
          submitProjectName.effect({
            id: makeProjectId("kepler"),
            name: "Kepler Discovery",
            redirectTo: makeProjectReturnTo("/projects/kepler?tab=activity")
          }),
          ServerClient,
          Server.localClient()
        );
        const loaded = yield* Effect.provideService(
          getProject.effect({ id: makeProjectId("kepler") }),
          ServerClient,
          Server.localClient()
        );

        expect(result).toMatchObject({
          _tag: "Redirect",
          location: "/projects/kepler?tab=activity",
          status: 303,
          replace: true
        });
        expect(loaded.name).toBe("Kepler Discovery");
      })
    ));
});
