import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { StartAction, type StartHydrationPayload } from "@sunfall/arc-start";
import {
  hydrationScriptId,
  serverActionPath,
  streamHydrationAttribute,
  type StartHydrationChunk,
} from "@sunfall/arc-start/testing";
import { Effect, type Scope } from "effect";
import { Window } from "happy-dom";
import { build, createServer } from "vite";
import { describe, expect, it } from "vitest";
import { makeProjectId, makeProjectReturnTo, SubmitProjectName } from "./domain.js";
import { app } from "./app-definition.js";
import { handleRequest } from "./server.js";
import { serverFunctions } from "./domain.server.js";
import { projectConsoleStartGraphSummary } from "./start-graph.js";
import { projectConsoleStartOptions } from "./start-options.js";

const textDecoder = new TextDecoder();
const projectRoot = new URL("..", import.meta.url).pathname;
const testDist = join(projectRoot, ".test-dist/client");
const htmlJsonScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const runRequest = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect));

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
    const response = await runRequest(
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
      "routes=3; server-functions=6; actions=1",
    );
    expect(response.headers.get("x-sunfall-arc-start-routes")).toBe("/,/projects,/projects/:id");
    expect(chunks[0]).toContain("<!doctype html>");
    expect(chunks[1]).toContain("Atlas Billing");
    expect(html).toContain("Atlas Billing");
    expect(html).toContain("Kepler Search");
    expect(html).toContain("Next milestone");
    expect(html).toContain("Indexed work queue");
    expect(html).toContain("sunfall-arc-start-graph");
    expect(html).toContain("window._$HY");
    expect(html).toContain("__SUNFALL_ARC_HYDRATION__");
    expect(html).toContain("data-sunfall-arc-hydration-chunk");
    const document = new Window().document;
    document.write(html);
    document.close();
    const root = document.getElementById("root");
    expect(root?.querySelector(`[${streamHydrationAttribute}]`)).toBeNull();
    expect(document.querySelector(`[${streamHydrationAttribute}]`)).not.toBeNull();
    expect(html).toContain('data-sunfall-arc-hydration-sequence="0"');
    expect(html).toContain('"_tag":"StartHydrationChunk"');
    expect(html).toContain("Projects.collection");
    expect(html).toContain("Project.workItems");
    expect(html).toContain("Projects.list");
    expect(html).toContain("Project.byId");
    expect(html).toContain('"id":"atlas"');
    expect([...streamedPairs].filter((pair) => rootPairs.has(pair))).toEqual([]);
  });

  it("exposes the generated Start route graph used by the Vite preset", () => {
    expect(app.actions.map((action) => action.name)).toEqual(["Project.name.submit"]);
    expect(app.collections.map((collection) => collection.name)).toEqual([
      "Projects.collection",
      "Project.workItems",
    ]);
    expect(serverFunctions.map((fn) => fn.name).sort()).toEqual([
      "Project.advance",
      "Project.get",
      "Project.list",
      "Project.name.submit",
      "Project.workItem.status",
      "Project.workItems.list",
    ]);
    expect(projectConsoleStartGraphSummary).toEqual({
      routes: ["/", "/projects", "/projects/:id"],
      serverFunctions: serverFunctions.map((fn) => fn.name),
      actions: ["Project.name.submit"],
    });
    expect("fileRoutes" in projectConsoleStartOptions).toBe(false);
  });

  it("derives the app graph's server functions and Actions from the server entry", async () => {
    const server = await createServer({
      root: projectRoot,
      configFile: join(projectRoot, "vite.config.ts"),
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      const { graph } = (await server.ssrLoadModule("virtual:sunfall-arc/app-graph")) as {
        readonly graph: {
          readonly serverFunctions: { readonly entries: ReadonlyArray<Record<string, unknown>> };
          readonly actions: { readonly entries: ReadonlyArray<Record<string, unknown>> };
        };
      };
      const getProjectEntry = graph.serverFunctions.entries.find(
        (entry) => entry.name === "Project.get",
      );

      expect(graph.serverFunctions.entries.map((entry) => entry.name).sort()).toEqual(
        serverFunctions.map((fn) => fn.name).sort(),
      );
      expect(getProjectEntry).toMatchObject({
        server: { module: "/src/domain.server.ts", exportName: "getProject" },
        client: { _tag: "Import", module: "/src/domain.contract.ts", exportName: "getProject" },
      });
      expect(graph.actions.entries).toMatchObject([
        {
          name: "Project.name.submit",
          server: { module: "/src/domain.ts", exportName: "SubmitProjectName" },
        },
      ]);
    } finally {
      await server.close();
    }
  });

  it("renders route search state on the server", async () => {
    const response = await runRequest(
      handleRequest(new Request("https://example.com/projects/kepler?tab=activity")),
    );
    const html = await response.text();

    expect(html).toContain("Kepler Search");
    expect(html).toContain("Recent activity");
    expect(html).toContain('href="/projects/kepler?tab=activity"');
    expect(html).toContain('class="active"');
  });

  it("runs progressive project name actions from plain form posts", async () => {
    const form = StartAction.form(SubmitProjectName, {
      input: {
        id: makeProjectId("lumen"),
        redirectTo: makeProjectReturnTo("/projects/lumen?tab=activity"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "Lumen Care");

    const response = await runRequest(
      handleRequest(
        new Request(`https://example.com${serverActionPath}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      ),
    );
    const page = await runRequest(handleRequest(new Request("https://example.com/projects/lumen")));
    const html = await page.text();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/lumen?tab=activity");
    expect(html).toContain("Lumen Care");
  });

  it("returns typed validation data from plain form posts", async () => {
    const form = StartAction.form(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "At");

    const response = await runRequest(
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
    const form = StartAction.form(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas"),
      },
    });
    const body = new URLSearchParams(form.hiddenFields.map((field) => [field.name, field.value]));
    body.set("name", "Atlas Growth");
    body.set("redirectTo", "https://example.com/phishing");

    const response = await runRequest(
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
    expect(generatedRoutes).toContain("  route_projects_$id: route_projects_$id,");
    expect(generatedRoutes).not.toContain("ByPath");
    expect(generatedRoutes).toContain("export type FileRouteHrefOptions<Id extends FileRouteId>");
    expect(bundleText).not.toContain("seedProjects");
    expect(bundleText).not.toContain("Move invoice preview");
    expect(bundleText).not.toContain("Webhook replay still manual");
    expect(bundleText).not.toContain("domain.server");
    expect(bundleText).not.toContain("/src/domain.server.ts");
  }, 20_000);
});
