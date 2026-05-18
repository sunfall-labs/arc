import { ResourceFailure, provideRequest, Server, ServerClient } from "@sunfall/arc-core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  InvalidProjectName,
  ProjectNotFound,
  formatProjectError,
  getProject,
  listProjectWorkItems,
  listProjects,
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  normalizeProjectError,
  renameProject,
  submitProjectName,
  updateWorkItemStatus,
} from "./domain.js";
import { ProjectDemoStoreLive } from "./domain.server.js";
import { Route as ProjectRoute } from "./routes/projects/$id.js";

const withLocalServer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provideService(effect, ServerClient, Server.localClient());

const provideProjectDemoStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provide(effect, ProjectDemoStoreLive);

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

  it("normalizes ProjectError class instances and plain decoded objects", () => {
    const notFound = new ProjectNotFound({ id: makeProjectId("atlas") });
    const invalidName = { _tag: "InvalidProjectName", name: "At" };

    expect(normalizeProjectError(notFound)).toMatchObject({
      _tag: "ProjectNotFound",
      id: "atlas",
    });
    expect(normalizeProjectError(invalidName)).toMatchObject({
      _tag: "InvalidProjectName",
      name: "At",
    });
    expect(formatProjectError(new InvalidProjectName({ name: "At" }))).toBe(
      "Project names need at least three meaningful characters.",
    );
  });

  it("unwraps ResourceFailure before formatting project errors", () => {
    const failure = new ResourceFailure({
      ref: {} as never,
      error: new ProjectNotFound({ id: makeProjectId("kepler") }),
      previous: undefined,
      hasPrevious: false,
    });

    expect(formatProjectError(failure)).toBe('Project "kepler" was not found.');
  });

  it("loads projects through server functions", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const projects = yield* withLocalServer(listProjects.effect("all"));

          expect(projects.length).toBeGreaterThan(0);
        }),
      ),
    ));

  it("loads and updates work items through server functions", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        provideRequest(
          new Request("https://example.com/projects/atlas?tab=tasks", {
            headers: {
              "x-sunfall-arc-now-label": "request scoped task update",
            },
          }),
        )(
          Effect.gen(function* () {
            const workItems = yield* withLocalServer(listProjectWorkItems.effect("all"));
            const updated = yield* withLocalServer(
              updateWorkItemStatus.effect({
                id: makeWorkItemId("atlas-retry"),
                status: "done",
              }),
            );

            expect(workItems.map((item) => item.id)).toContain(makeWorkItemId("atlas-retry"));
            expect(updated).toMatchObject({
              id: makeWorkItemId("atlas-retry"),
              status: "done",
              updatedAt: "request scoped task update",
            });
          }),
        ),
      ),
    ));

  it("renames and reloads a project", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const renamed = yield* withLocalServer(
            renameProject.effect({ id: makeProjectId("atlas"), name: "Atlas Revenue" }),
          );
          const loaded = yield* withLocalServer(getProject.effect({ id: makeProjectId("atlas") }));

          expect(renamed.name).toBe("Atlas Revenue");
          expect(loaded.name).toBe("Atlas Revenue");
        }),
      ),
    ));

  it("uses request-scoped context inside server mutations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const renamed = yield* provideProjectDemoStore(
          provideRequest(
            new Request("https://example.com/projects/meridian", {
              headers: {
                "x-sunfall-arc-now-label": "request scoped",
              },
            }),
          )(
            withLocalServer(
              renameProject.effect({ id: makeProjectId("meridian"), name: "Meridian Insights" }),
            ),
          ),
        );

        expect(renamed.updatedAt).toBe("request scoped");
      }),
    ));

  it("returns typed validation data for progressive project name submissions", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const result = yield* withLocalServer(
            submitProjectName.effect({ id: makeProjectId("atlas"), name: "At" }),
          );

          expect(result._tag).toBe("ValidationFailure");
          if (result._tag === "ValidationFailure") {
            expect(result.fieldErrors.name?.[0]).toContain("three meaningful characters");
          }
        }),
      ),
    ));

  it("returns a typed redirect after a valid progressive project name submission", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const result = yield* withLocalServer(
            submitProjectName.effect({
              id: makeProjectId("kepler"),
              name: "Kepler Discovery",
              redirectTo: makeProjectReturnTo("/projects/kepler?tab=activity"),
            }),
          );
          const loaded = yield* withLocalServer(getProject.effect({ id: makeProjectId("kepler") }));

          expect(result).toMatchObject({
            _tag: "Redirect",
            location: "/projects/kepler?tab=activity",
            status: 303,
            replace: true,
          });
          expect(loaded.name).toBe("Kepler Discovery");
        }),
      ),
    ));
});
