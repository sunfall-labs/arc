import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AnySunfallArcRuntime, SunfallArcRuntime } from "@sunfall/arc-core";
import {
  hydrationScriptId,
  serverActionPath,
  startActionForm,
  streamHydrationAttribute,
  type StartHydrationChunk,
  type StartHydrationPayload,
} from "@sunfall/arc-start";
import { Effect } from "effect";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { makeProjectId, makeProjectReturnTo, SubmitProjectName } from "./domain.js";
import { app } from "./app-definition.js";
import { handleRequest, serverApp } from "./server.js";
import { projectConsoleStartGraph, projectConsoleStartGraphSummary } from "./start-graph.js";
import {
  projectConsoleActionSources,
  projectConsoleServerFunctionSources,
  projectConsoleServerRegistry,
  projectConsoleStartOptions,
} from "./start-options.js";

const textDecoder = new TextDecoder();
const projectRoot = new URL("..", import.meta.url).pathname;
const testDist = join(projectRoot, ".test-dist/client");
const htmlJsonScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const runInRuntime = <A, E, R, RuntimeServices, RuntimeError>(
  runtime: SunfallArcRuntime<RuntimeServices, RuntimeError> | AnySunfallArcRuntime<RuntimeError>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> =>
  Effect.runPromise((runtime as unknown as AnySunfallArcRuntime<RuntimeError>).provide(effect));

const readTextChunks = async (response: Response): Promise<ReadonlyArray<string>> => {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();

  const chunks: string[] = [];
  while (reader) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(textDecoder.decode(result.value));
  }

  return chunks;
};

const readTextFiles = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      contents.push(...(await readTextFiles(path)));
    } else if (/\.(?:html|js|css|json|map)$/.test(entry.name)) {
      contents.push(await readFile(path, "utf8"));
    }
  }

  return contents;
};

const rootHydrationPayloadFrom = (html: string): StartHydrationPayload => {
  for (const match of html.matchAll(htmlJsonScriptPattern)) {
    if ((match[1] ?? "").includes(`id="${hydrationScriptId}"`)) {
      return JSON.parse(match[2] ?? "") as StartHydrationPayload;
    }
  }

  expect.fail("Root hydration script not found.");
};

const streamHydrationChunksFrom = (html: string): ReadonlyArray<StartHydrationChunk> =>
  Array.from(html.matchAll(htmlJsonScriptPattern))
    .filter((match) => match[1]?.includes(streamHydrationAttribute))
    .map((match) => JSON.parse(match[2] ?? "") as StartHydrationChunk);

const resourcePairs = (payload: StartHydrationPayload): ReadonlySet<string> =>
  new Set(payload.resources.map((resource) => JSON.stringify([resource.name, resource.key])));

describe("project console SSR", () => {
  it("streams the matched project route with hydration payloads", async () => {
    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(new Request("https://example.com/projects/atlas")),
    );
    const chunks = await readTextChunks(response);
    const html = chunks.join("");
    const rootPairs = resourcePairs(rootHydrationPayloadFrom(html));
    const streamedPairs = new Set(
      streamHydrationChunksFrom(html).flatMap((chunk) => [...resourcePairs(chunk.payload)]),
    );

    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(chunks.length).toBeGreaterThan(1);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-sunfall-arc-render")).toBe("streaming");
    expect(response.headers.get("x-sunfall-arc-start-graph")).toBe(
      "routes=3; server-functions=5; actions=2",
    );
    expect(response.headers.get("x-sunfall-arc-start-routes")).toBe("/,/projects,/projects/:id");
    expect(chunks[0]).toContain("<!doctype html>");
    expect(chunks[1]).toContain("Atlas Billing");
    expect(html).toContain("Atlas Billing");
    expect(html).toContain("Kepler Search");
    expect(html).toContain("Next milestone");
    expect(html).toContain("sunfall-arc-start-graph");
    expect(html).toContain("window._$HY");
    expect(html).toContain("__SUNFALL_ARC_HYDRATION__");
    expect(html).toContain("data-sunfall-arc-hydration-chunk");
    expect(html).toContain('data-sunfall-arc-hydration-sequence="0"');
    expect(html).toContain('"_tag":"StartHydrationChunk"');
    expect(html).toContain("Projects.collection");
    expect(html).toContain("Projects.list");
    expect(html).toContain("Project.byId");
    expect(html).toContain('"id":"atlas"');
    expect([...streamedPairs].filter((pair) => rootPairs.has(pair))).toEqual([]);
  });

  it("exposes the generated Start route graph used by the Vite preset", () => {
    expect(serverApp.routes).toBe(app.routes);
    expect(serverApp.client).toBe(app.client);
    expect(serverApp.fullStack).toBe(app.fullStack);
    expect(app.registry.actions.size).toBe(0);
    expect(app.registry.serverFunctions.size).toBe(0);
    expect(Array.from(serverApp.registry.actions.keys()).sort()).toEqual([
      "Project.collection.rename",
      "Project.name.submit",
    ]);
    expect(Array.from(serverApp.registry.serverFunctions.keys()).sort()).toEqual([
      "Project.advance",
      "Project.get",
      "Project.list",
      "Project.name.submit",
      "Project.rename",
    ]);
    expect(projectConsoleStartGraphSummary).toEqual({
      routes: ["/", "/projects", "/projects/:id"],
      serverFunctions: [
        "Project.advance",
        "Project.get",
        "Project.list",
        "Project.name.submit",
        "Project.rename",
      ],
      actions: ["Project.collection.rename", "Project.name.submit"],
    });
    expect("fileRoutes" in projectConsoleStartOptions).toBe(false);
  });

  it("derives registry, Start options, and fallback graph facts from the same sources", () => {
    expect(projectConsoleStartOptions.serverFunctionSources).toBe(
      projectConsoleServerFunctionSources,
    );
    expect(projectConsoleStartOptions.actionSources).toBe(projectConsoleActionSources);
    expect(projectConsoleStartGraph.serverFunctions).toBe(projectConsoleServerFunctionSources);
    expect(projectConsoleStartGraph.actions).toBe(projectConsoleActionSources);
    expect(projectConsoleServerRegistry.serverFunctions.map((fn) => fn.name)).toEqual(
      projectConsoleStartGraphSummary.serverFunctions,
    );
    expect(projectConsoleServerRegistry.actions.map((action) => action.name)).toEqual(
      projectConsoleStartGraphSummary.actions,
    );
  });

  it("renders route search state on the server", async () => {
    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(new Request("https://example.com/projects/kepler?tab=activity")),
    );
    const html = await response.text();

    expect(html).toContain("Kepler Search");
    expect(html).toContain("Recent activity");
    expect(html).toContain('href="/projects/kepler?tab=activity"');
    expect(html).toContain('class="active"');
  });

  it("runs progressive project name actions from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("lumen"),
        redirectTo: makeProjectReturnTo("/projects/lumen?tab=activity"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "Lumen Care");

    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      ),
    );
    const page = await runInRuntime(
      serverApp.runtime,
      handleRequest(new Request("https://example.com/projects/lumen")),
    );
    const html = await page.text();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/lumen?tab=activity");
    expect(html).toContain("Lumen Care");
  });

  it("returns typed validation data from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "At");

    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      ),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: ["Use at least three meaningful characters."],
      },
    });
  });

  it("rejects unsafe branded redirect targets from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "Atlas Growth");
    body.set("redirectTo", "https://example.com/phishing");

    const response = await runInRuntime(
      serverApp.runtime,
      handleRequest(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ServerError",
    });
  });

  it("keeps server-only project seed data out of the client bundle", async () => {
    await rm(testDist, { recursive: true, force: true });
    await build({
      root: projectRoot,
      configFile: join(projectRoot, "vite.config.ts"),
      logLevel: "silent",
      build: {
        outDir: testDist,
        emptyOutDir: true,
        minify: false,
        sourcemap: false,
      },
    });

    const bundleText = (await readTextFiles(testDist)).join("\n");
    const generatedRoutes = await readFile(join(projectRoot, "src/routeTree.gen.ts"), "utf8");

    expect(generatedRoutes).toContain("This file is generated by @sunfall/arc-start. Do not edit.");
    expect(generatedRoutes).toContain('import { Route } from "@sunfall/arc-core";');
    expect(generatedRoutes).toContain(
      'import { Route as route_projects_$id } from "./routes/projects/$id.js";',
    );
    expect(generatedRoutes).toContain(
      'const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;',
    );
    expect(generatedRoutes).toContain('  "/projects/:id": route_projects_$id');
    expect(generatedRoutes).toContain("export const hrefByPath");
    expect(generatedRoutes).toContain("export type Href<Id extends RouteId>");
    expect(generatedRoutes).toContain("export type Match<Path extends RoutePath>");
    expect(bundleText).not.toContain("seedProjects");
    expect(bundleText).not.toContain("Move invoice preview");
    expect(bundleText).not.toContain("Webhook replay still manual");
    expect(bundleText).not.toContain("domain.server");
    expect(bundleText).not.toContain("/src/domain.server.ts");
  }, 20_000);
});
