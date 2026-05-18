import {
  defineApp,
  RequestContext,
  Resource,
  ResponseContext,
  route,
  Server,
  type AnySunfallArcRuntime,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { Collection } from "@sunfall/arc-db";
import {
  createRequestHandler,
  serverActionPath,
  startActionForm,
  streamHydrationAttribute,
  type StartHydrationChunk,
} from "@sunfall/arc-start";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeProjectId,
  makeProjectReturnTo,
  ProjectById,
  ProjectSchema,
  ProjectsRef,
  SubmitProjectName,
} from "./domain.js";
import { handleRequest, serverApp } from "./server.js";

const htmlJsonScriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

const streamHydrationChunksFrom = (html: string): ReadonlyArray<StartHydrationChunk> =>
  Array.from(html.matchAll(htmlJsonScriptPattern))
    .filter((match) => match[0].includes(streamHydrationAttribute))
    .map((match) => JSON.parse(match[1] ?? "") as StartHydrationChunk);

const runInRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError> | AnySunfallArcRuntime<RuntimeError>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> =>
  Effect.runPromise((runtime as unknown as AnySunfallArcRuntime<RuntimeError>).provide(effect));

const postActionForm = async (
  form: ReturnType<typeof startActionForm>,
  body: URLSearchParams,
): Promise<Response> =>
  runInRuntime(
    serverApp.runtime,
    handleRequest(
      new Request(`https://example.com${serverActionPath}`, {
        method: form.method.toUpperCase(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    ),
  );

describe("project console full-stack golden path", () => {
  it("renders route data, serializes route preload resources, and observes updated data after a Start form action", async () => {
    const projectId = makeProjectId("meridian");
    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(new Request("https://example.com/projects/meridian?tab=activity")),
    );
    const html = await response.text();
    const chunks = streamHydrationChunksFrom(html);
    const resources = chunks.flatMap((chunk) => chunk.payload.resources);
    const projectResource = resources.find(
      (resource) => resource.key === ProjectById(projectId).key,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-sunfall-arc-render")).toBe("streaming");
    expect(html).toContain("Meridian Analytics");
    expect(html).toContain("Recent activity");
    expect(html).toContain("Dehydrate report cache into the first SSR payload.");
    expect(html).toContain("Projects.collection");
    expect(html).toContain("Project.workItems");
    expect(resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining([ProjectsRef.key, ProjectById(projectId).key]),
    );
    expect(projectResource).toMatchObject({
      name: "Project.byId",
      input: "meridian",
      state: {
        _tag: "Success",
        value: {
          id: "meridian",
          name: "Meridian Analytics",
        },
      },
    });
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(ProjectSchema)(
          projectResource?.state._tag === "Success" ? projectResource.state.value : undefined,
        ),
      ),
    ).resolves.toMatchObject({
      id: projectId,
      name: "Meridian Analytics",
    });

    const form = startActionForm(SubmitProjectName, {
      input: {
        id: projectId,
        redirectTo: makeProjectReturnTo("/projects/meridian?tab=activity"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "Meridian Golden Path");

    const actionResponse = await postActionForm(form, body);
    const followUp = await runInRuntime(
      serverApp.runtime,
      handleRequest(new Request("https://example.com/projects/meridian?tab=activity")),
    );
    const followUpHtml = await followUp.text();
    const followUpResources = streamHydrationChunksFrom(followUpHtml).flatMap(
      (chunk) => chunk.payload.resources,
    );
    const updatedProjectResource = followUpResources.find(
      (resource) => resource.key === ProjectById(projectId).key,
    );

    expect(actionResponse.status).toBe(303);
    expect(actionResponse.headers.get("location")).toBe("/projects/meridian?tab=activity");
    expect(followUpHtml).toContain("Meridian Golden Path");
    expect(followUpHtml).toContain("Projects.collection");
    expect(followUpHtml).toContain("Project.workItems");
    expect(updatedProjectResource).toMatchObject({
      state: {
        _tag: "Success",
        value: {
          id: "meridian",
          name: "Meridian Golden Path",
        },
      },
    });
  });

  it("runs request-runtime server functions during preload and applies ResponseContext with route-touched collections", async () => {
    const BoundaryProject = Server.contract<
      { readonly id: string },
      { readonly id: string; readonly name: string; readonly requestPath: string }
    >("ProjectConsoleGolden.boundary.project", {
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        requestPath: Schema.String,
      }),
    });
    const boundaryProject = Server.client(BoundaryProject);
    Server.implement(BoundaryProject, ({ id }) =>
      Effect.gen(function* () {
        const request = yield* RequestContext;
        const response = yield* ResponseContext;
        const path = new URL(request.url).pathname;
        yield* response.setStatus(207, "Multi-Status");
        yield* response.setHeader("x-sunfall-arc-golden-runtime", path);
        yield* response
          .setCookie("golden-project", id, {
            httpOnly: true,
            path: "/",
            sameSite: "Lax",
          })
          .pipe(Effect.orDie);
        return {
          id,
          name: `Boundary ${id}`,
          requestPath: path,
        };
      }),
    );

    interface BoundaryProject {
      readonly id: string;
      readonly name: string;
      readonly requestPath: string;
    }

    const BoundaryResource = Resource.family({
      name: "ProjectConsoleGolden.boundary.resource",
      input: Schema.String,
      output: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        requestPath: Schema.String,
      }),
      load: (id) => boundaryProject.effect({ id }),
    });
    const BoundaryCollection = Collection.define({
      name: "ProjectConsoleGolden.boundary.collection",
      output: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
        }),
      ),
      getKey: (project) => project.id,
      load: () => Effect.succeed([{ id: "atlas", name: "Collected Atlas" }]),
    });
    const BoundaryRoute = route("/golden/:id", {
      params: Schema.Struct({ id: Schema.String }),
      preload: ({ params }) =>
        Effect.asVoid(
          Effect.all([
            Resource.prefetchEffect(BoundaryResource(params.id)),
            BoundaryCollection.preloadEffect(),
          ]),
        ),
    });
    const boundaryApp = defineApp({
      routes: [BoundaryRoute] as const,
      client: {},
    });
    const handler = createRequestHandler(boundaryApp, {
      render: ({ collections, legacyHydrationScript, match }) => {
        const id = match?.params.id ?? "missing";
        const project = Resource.read(BoundaryResource(id));
        const collection = collections.collections[0];
        return [
          "<html><body>",
          `<main>${project.name}:${project.requestPath}</main>`,
          `<aside>${collection?.name}:${collection?.rows[0]?.value.name}</aside>`,
          legacyHydrationScript,
          "</body></html>",
        ].join("");
      },
    });

    const response = await runInRuntime(
      boundaryApp.runtime,
      handler(new Request("https://example.com/golden/atlas")),
    );
    const html = await response.text();

    expect(response.status).toBe(207);
    expect(response.statusText).toBe("Multi-Status");
    expect(response.headers.get("x-sunfall-arc-golden-runtime")).toBe("/golden/atlas");
    expect(response.headers.getSetCookie()).toEqual([
      "golden-project=atlas; Path=/; HttpOnly; SameSite=Lax",
    ]);
    expect(html).toContain("<main>Boundary atlas:/golden/atlas</main>");
    expect(html).toContain(
      "<aside>ProjectConsoleGolden.boundary.collection:Collected Atlas</aside>",
    );
    expect(html).toContain("ProjectConsoleGolden.boundary.resource");
    expect(html).toContain("ProjectConsoleGolden.boundary.collection");
  });
});
