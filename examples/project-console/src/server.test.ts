import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { serverActionPath, startActionForm } from "@effect-ui/start";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { makeProjectId, makeProjectReturnTo, SubmitProjectName } from "./domain.js";
import { handleRequest } from "./server.js";
import { projectConsoleStartGraphSummary } from "./start-graph.js";
import { projectConsoleStartOptions } from "./start-options.js";

const textDecoder = new TextDecoder();
const projectRoot = new URL("..", import.meta.url).pathname;
const testDist = join(projectRoot, ".test-dist/client");

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
      contents.push(...await readTextFiles(path));
    } else if (/\.(?:html|js|css|json|map)$/.test(entry.name)) {
      contents.push(await readFile(path, "utf8"));
    }
  }

  return contents;
};

describe("project console SSR", () => {
  it("streams the matched project route with hydration payloads", async () => {
    const response = await handleRequest(new Request("https://example.com/projects/atlas"));
    const chunks = await readTextChunks(response);
    const html = chunks.join("");

    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(chunks.length).toBeGreaterThan(1);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-effect-ui-render")).toBe("streaming");
    expect(response.headers.get("x-effect-ui-start-graph")).toBe("routes=3; server-functions=5; actions=2");
    expect(response.headers.get("x-effect-ui-start-routes")).toBe("/,/projects,/projects/:id");
    expect(chunks[0]).toContain("<!doctype html>");
    expect(chunks[1]).toContain("Atlas Billing");
    expect(html).toContain("Atlas Billing");
    expect(html).toContain("Kepler Search");
    expect(html).toContain("Next milestone");
    expect(html).toContain("effect-ui-start-graph");
    expect(html).toContain("window._$HY");
    expect(html).toContain("__EFFECT_UI_HYDRATION__");
    expect(html).toContain("data-effect-ui-hydration-chunk");
    expect(html).toContain("data-effect-ui-hydration-sequence=\"0\"");
    expect(html).toContain("\"_tag\":\"StartHydrationChunk\"");
    expect(html).toContain("Projects.collection");
    expect(html).toContain("Projects.list");
    expect(html).toContain("Project.byId");
    expect(html).toContain("\"id\":\"atlas\"");
  });

  it("exposes the generated Start route graph used by the Vite preset", () => {
    expect(projectConsoleStartGraphSummary).toEqual({
      routes: ["/", "/projects", "/projects/:id"],
      serverFunctions: [
        "Project.advance",
        "Project.get",
        "Project.list",
        "Project.name.submit",
        "Project.rename"
      ],
      actions: ["Project.collection.rename", "Project.name.submit"]
    });
    expect(projectConsoleStartOptions.fileRoutes).toEqual([
      "src/routes/index.ts",
      "src/routes/projects/index.ts",
      "src/routes/projects/$id.ts"
    ]);
  });

  it("renders route search state on the server", async () => {
    const response = await handleRequest(
      new Request("https://example.com/projects/kepler?tab=activity")
    );
    const html = await response.text();

    expect(html).toContain("Kepler Search");
    expect(html).toContain("Recent activity");
    expect(html).toContain("href=\"/projects/kepler?tab=activity\" class=\"active\"");
  });

  it("runs progressive project name actions from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("lumen"),
        redirectTo: makeProjectReturnTo("/projects/lumen?tab=activity")
      }
    });
    const body = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value])
    );
    body.set("name", "Lumen Care");

    const response = await handleRequest(
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    );
    const page = await handleRequest(new Request("https://example.com/projects/lumen"));
    const html = await page.text();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/projects/lumen?tab=activity");
    expect(html).toContain("Lumen Care");
  });

  it("returns typed validation data from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas")
      }
    });
    const body = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value])
    );
    body.set("name", "At");

    const response = await handleRequest(
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: ["Use at least three meaningful characters."]
      }
    });
  });

  it("rejects unsafe branded redirect targets from plain form posts", async () => {
    const form = startActionForm(SubmitProjectName, {
      input: {
        id: makeProjectId("atlas")
      }
    });
    const body = new URLSearchParams(
      form.hiddenFields.map((field) => [field.name, field.value])
    );
    body.set("name", "Atlas Growth");
    body.set("redirectTo", "https://example.com/phishing");

    const response = await handleRequest(
      new Request(`https://example.com${serverActionPath}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ServerError"
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
        sourcemap: false
      }
    });

    const bundleText = (await readTextFiles(testDist)).join("\n");
    const generatedRoutes = await readFile(join(projectRoot, "src/routeTree.gen.ts"), "utf8");

    expect(generatedRoutes).toContain("This file is generated by @effect-ui/start. Do not edit.");
    expect(generatedRoutes).toContain('import type { Route } from "@effect-ui/core";');
    expect(generatedRoutes).toContain('import { Route as route_projects_$id } from "./routes/projects/$id.js";');
    expect(generatedRoutes).toContain('const route_projects_$id_path: "/projects/:id" = route_projects_$id.path;');
    expect(generatedRoutes).toContain('  "/projects/:id": route_projects_$id');
    expect(generatedRoutes).toContain("export type FileRouteHrefOptionsById");
    expect(bundleText).not.toContain("seedProjects");
    expect(bundleText).not.toContain("Move invoice preview");
    expect(bundleText).not.toContain("Webhook replay still manual");
    expect(bundleText).not.toContain("domain.server");
    expect(bundleText).not.toContain("/src/domain.server.ts");
  });
});
