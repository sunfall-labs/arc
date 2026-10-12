import {
  ActionResult,
  ResourceFailure,
  Route,
  RoutePreloadError,
  provideRequest,
  type Action,
} from "@sunfall/arc-core";
import { Cause, Effect } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import {
  InvalidProjectName,
  ProjectNotFound,
  formatProjectError,
  makeProjectId,
  makeProjectReturnTo,
  makeWorkItemId,
  normalizeProjectError,
  type Project,
} from "./domain.js";
import {
  ProjectDemoStoreLive,
  getProject,
  listProjectWorkItems,
  listProjects,
  moveWorkItem,
  submitProjectName,
} from "./domain.server.js";
import { route as ProjectRoute } from "./routes/projects/$id.js";

/** Runs a served Action's server implementation in-process. */
const run = <I, A, E, R>(action: Action.Definition<I, A, E, R>, input: I) =>
  Effect.suspend(() => action.run!(input) as Effect.Effect<A, E, R>);

const provideProjectDemoStore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provide(effect, ProjectDemoStoreLive);

const renamed = (result: unknown): Project | undefined =>
  ActionResult.is(result) ? undefined : (result as Project);

describe("project console domain", () => {
  it("brands route-safe project ids", () => {
    expect(makeProjectId("atlas-billing")).toBe("atlas-billing");
    expect(() => makeProjectId("Atlas Billing")).toThrow();
  });

  it("decodes project route params through the branded schema", () => {
    const match = Route.match([ProjectRoute], "/projects/atlas?tab=settings");

    expect(match?.params.id).toBe(makeProjectId("atlas"));
    expect(match?.search.tab).toBe("settings");
    expect(Route.match([ProjectRoute], "/projects/Atlas")).toBeUndefined();
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
      result: AsyncResult.fail(new ProjectNotFound({ id: makeProjectId("kepler") })),
    });

    expect(formatProjectError(failure)).toBe('Project "kepler" was not found.');
  });

  it("unwraps route preload failures before formatting project errors", () => {
    const failure = new RoutePreloadError({
      path: "/projects/:id",
      href: "/projects/kepler",
      cause: new ProjectNotFound({ id: makeProjectId("kepler") }),
    });

    expect(formatProjectError(failure)).toBe('Project "kepler" was not found.');
  });

  it("decodes the project route's hydrated preload failure with its error schema", () => {
    const cause = Route.preloadFailureCauseFromSnapshot(ProjectRoute, {
      path: "/projects/:id",
      href: "/projects/kepler",
      failure: { _tag: "Encoded", value: { _tag: "ProjectNotFound", id: "kepler" } },
    });
    const failure = cause.reasons.find(Cause.isFailReason)?.error;

    expect(failure?.cause).toBeInstanceOf(ProjectNotFound);
    expect(formatProjectError(failure)).toBe('Project "kepler" was not found.');
  });

  it("loads projects through the served Resource's implementation", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const projects = yield* listProjects.local("all");

          expect(projects.length).toBeGreaterThan(0);
        }),
      ),
    ));

  it("loads and moves work items through the server implementations", () =>
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
            const workItems = yield* listProjectWorkItems.local("all");
            const updated = yield* run(moveWorkItem, {
              id: makeWorkItemId("atlas-retry"),
              status: "done",
            });

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
          const submitted = yield* run(submitProjectName, {
            id: makeProjectId("atlas"),
            name: "Atlas Revenue",
          });
          const loaded = yield* getProject.local(makeProjectId("atlas"));

          expect(renamed(submitted)?.name).toBe("Atlas Revenue");
          expect(loaded.name).toBe("Atlas Revenue");
        }),
      ),
    ));

  it("fails a rename of a missing project with its typed error", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const failure = yield* Effect.flip(
            run(submitProjectName, { id: makeProjectId("missing"), name: "Missing Project" }),
          );

          expect(failure).toMatchObject({ _tag: "ProjectNotFound", id: "missing" });
        }),
      ),
    ));

  it("uses request-scoped context inside server mutations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const submitted = yield* provideProjectDemoStore(
          provideRequest(
            new Request("https://example.com/projects/meridian", {
              headers: {
                "x-sunfall-arc-now-label": "request scoped",
              },
            }),
          )(
            run(submitProjectName, {
              id: makeProjectId("meridian"),
              name: "Meridian Insights",
            }),
          ),
        );

        expect(renamed(submitted)?.updatedAt).toBe("request scoped");
      }),
    ));

  it("returns typed validation data for progressive project name submissions", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const result = yield* run(submitProjectName, {
            id: makeProjectId("atlas"),
            name: "At",
          });

          expect(ActionResult.is(result) && ActionResult.isValidationFailure(result)).toBe(true);
          expect(result).toMatchObject({
            fieldErrors: { name: [expect.stringContaining("three meaningful characters")] },
          });
        }),
      ),
    ));

  it("returns a typed redirect after a valid progressive project name submission", () =>
    Effect.runPromise(
      provideProjectDemoStore(
        Effect.gen(function* () {
          const result = yield* run(submitProjectName, {
            id: makeProjectId("kepler"),
            name: "Kepler Discovery",
            redirectTo: makeProjectReturnTo("/projects/kepler?tab=activity"),
          });
          const loaded = yield* getProject.local(makeProjectId("kepler"));

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
