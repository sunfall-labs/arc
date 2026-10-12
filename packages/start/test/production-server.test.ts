import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { App, createRequestHandler } from "../src/index.js";
import { serve } from "../src/node.js";
import { clientAssetsFromViteManifest, type ViteManifest } from "../src/start-client-assets.js";
import { routeModulesByPath } from "../src/start-server-build.js";

// A client build manifest shaped like Vite's: an entry with a shared chunk and
// CSS, and two lazy route components that share a chunk of their own.
const manifest: ViteManifest = {
  "src/main.tsx": {
    file: "assets/main-1.js",
    src: "src/main.tsx",
    isEntry: true,
    imports: ["_shared-1.js"],
    css: ["assets/main-1.css"],
  },
  "_shared-1.js": { file: "assets/shared-1.js", css: ["assets/shared-1.css"] },
  "src/routes/index.component.tsx": {
    file: "assets/index.component-1.js",
    imports: ["_shared-1.js", "_model-1.js"],
    css: ["assets/index-1.css"],
  },
  "src/routes/items/$id.component.tsx": {
    file: "assets/item.component-1.js",
    imports: ["_model-1.js"],
  },
  "_model-1.js": { file: "assets/model-1.js" },
};

describe("clientAssetsFromViteManifest", () => {
  it("preloads the entry with its imports and each route's chunks beyond them", () => {
    expect(
      clientAssetsFromViteManifest(manifest, {
        base: "/app/",
        entry: "src/main.tsx",
        routeModules: {
          "/": ["src/routes/index.component.tsx"],
          "/items/:id": ["src/routes/items/$id.component.tsx"],
          "/unbuilt": ["src/routes/unbuilt.component.tsx"],
        },
      }),
    ).toEqual({
      entry: "/app/assets/main-1.js",
      modulepreload: ["/app/assets/main-1.js", "/app/assets/shared-1.js"],
      stylesheets: ["/app/assets/main-1.css", "/app/assets/shared-1.css"],
      routes: {
        "/": {
          modulepreload: ["/app/assets/index.component-1.js", "/app/assets/model-1.js"],
          stylesheets: ["/app/assets/index-1.css"],
        },
        "/items/:id": {
          modulepreload: ["/app/assets/item.component-1.js", "/app/assets/model-1.js"],
          stylesheets: [],
        },
      },
    });
  });

  it("maps file-route component and layout modules to root-relative paths", () => {
    expect(
      routeModulesByPath("/repo/app", {
        version: 1,
        entries: [],
        modules: [
          { kind: "Route", routePath: "/", filePath: "/repo/app/src/routes/index.ts" },
          {
            kind: "Component",
            routePath: "/",
            filePath: "/repo/app/src/routes/index.component.tsx",
          },
          { kind: "Layout", routePath: "/", filePath: "src/routes/_layout.tsx" },
        ] as never,
      }),
    ).toEqual({ "/": ["src/routes/index.component.tsx", "src/routes/_layout.tsx"] });
  });
});

const ItemRoute = Route.define("/items/:id");
const Root = Component.define("Root", function* (props: App.RootProps) {
  yield* Effect.void;
  return () => `page ${props.href}`;
});
const app = App.define({ root: Root, routes: [ItemRoute] as const });

describe("serve", () => {
  const clientDir = mkdtempSync(join(tmpdir(), "arc-start-serve-"));
  mkdirSync(join(clientDir, "assets"));
  mkdirSync(join(clientDir, ".vite"));
  writeFileSync(join(clientDir, "assets/main-1.js"), "console.log('entry')");
  writeFileSync(join(clientDir, "robots.txt"), "User-agent: *");
  writeFileSync(join(clientDir, ".vite/manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(clientDir, "index.html"), "<p>unused</p>");
  afterAll(() => rmSync(clientDir, { recursive: true, force: true }));

  const assets = clientAssetsFromViteManifest(manifest, {
    base: "/",
    routeModules: { "/items/:id": ["src/routes/items/$id.component.tsx"] },
  });

  it("serves the client build and renders documents that reference it", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* serve(
            createRequestHandler(app, {
              document: () => ({ links: [{ rel: "stylesheet", href: "/src/styles.css" }] }),
            }),
            { clientDir, assets, port: 0, host: "127.0.0.1" },
          );
          const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          const get = (path: string) =>
            Effect.promise(async () => {
              const response = await fetch(`${origin}${path}`);
              return { response, body: await response.text() };
            });

          const entry = yield* get("/assets/main-1.js");
          expect(entry.response.status).toBe(200);
          expect(entry.response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
          expect(entry.response.headers.get("cache-control")).toContain("immutable");
          expect(entry.body).toBe("console.log('entry')");
          expect((yield* get("/robots.txt")).response.headers.get("cache-control")).toBe(
            "no-cache",
          );

          const page = yield* get("/items/7");
          expect(page.response.status).toBe(200);
          expect(page.body).toContain("page /items/7");
          expect(page.body).toContain('<script type="module" src="/assets/main-1.js"></script>');
          expect(page.body).not.toContain("/src/");
          const links = [...page.body.matchAll(/<link rel="([^"]+)" href="([^"]+)" \/>/g)].map(
            ([, rel, href]) => `${rel} ${href}`,
          );
          expect(links).toEqual([
            "stylesheet /assets/main-1.css",
            "stylesheet /assets/shared-1.css",
            "modulepreload /assets/main-1.js",
            "modulepreload /assets/shared-1.js",
            "modulepreload /assets/item.component-1.js",
            "modulepreload /assets/model-1.js",
          ]);

          // Build metadata and the build's own index.html are not served.
          expect((yield* get("/.vite/manifest.json")).response.status).toBe(404);
          expect((yield* get("/index.html")).response.status).toBe(404);
        }),
      ),
    ));
});
