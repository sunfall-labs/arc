import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { generateFileRouteManifestArtifact } from "../src/file-routes.js";
import {
  planStartPrerenderPages,
  resolveStartPrerenderOptions,
  runStartPrerenderEffect,
  StartPrerenderError,
} from "../src/start-prerender.js";

const manifest = generateFileRouteManifestArtifact(
  [
    "src/routes/index.tsx",
    "src/routes/about.tsx",
    "src/routes/posts/$slug.tsx",
    "src/routes/admin.tsx",
  ],
  { routeDirectory: "src/routes" },
);

describe("Start prerender planning", () => {
  it("discovers static file routes and keeps dynamic routes explicit", () => {
    const pages = planStartPrerenderPages(manifest, {
      enabled: true,
      pages: [{ path: "/posts/hello", outputPath: "posts/hello/index.html" }],
    });

    expect(pages.map((page) => page.path)).toEqual(["/", "/about", "/admin", "/posts/hello"]);
    expect(pages.find((page) => page.path === "/posts/hello")?.outputPath).toBe(
      "posts/hello/index.html",
    );
    expect(pages).not.toContainEqual(expect.objectContaining({ path: "/posts/:slug" }));
  });

  it("lets explicit pages disable or filter discovered paths", () => {
    const pages = planStartPrerenderPages(manifest, {
      enabled: true,
      filter: ({ path }) => path !== "/admin",
      pages: [{ path: "/about", prerender: false }],
    });

    expect(pages.map((page) => page.path)).toEqual(["/"]);
  });

  it("normalizes prerender defaults and disabled configs", () => {
    expect(resolveStartPrerenderOptions(false)).toBeUndefined();
    expect(resolveStartPrerenderOptions({ enabled: false })).toBeUndefined();
    expect(resolveStartPrerenderOptions(true)).toMatchObject({
      autoStaticPathsDiscovery: true,
      autoSubfolderIndex: true,
      crawlLinks: true,
      failOnError: true,
      retryCount: 0,
      retryDelay: 0,
    });
    expect(
      new StartPrerenderError({
        operation: "render-page",
        message: "Could not render.",
        path: "/docs",
      }).path,
    ).toBe("/docs");
  });

  it("replaces dev asset tags with production assets when writing pages", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-ui-start-prerender-"));
    const outDir = join(root, "dist");

    try {
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        join(outDir, "index.html"),
        [
          "<!doctype html>",
          '<html><head><link rel="stylesheet" href="/assets/app-abc.css" /></head>',
          '<body><script type="module" src="/assets/app-abc.js"></script></body></html>',
        ].join("\n"),
      );
      writeFileSync(
        join(root, "src/server.ts"),
        [
          "export default function handleRequest() {",
          "  return new Response(",
          "    `<!doctype html>",
          "<html>",
          "  <head>",
          '    <link rel="stylesheet" href="/src/styles.css" data-effect-ui-docs-dev-style />',
          "  </head>",
          "  <body>",
          "    <main>Prerendered page</main>",
          '    <script type="module" src="/src/main.tsx"></script>',
          "  </body>",
          "</html>`",
          "  );",
          "}",
          "",
        ].join("\n"),
      );

      const result = await Effect.runPromise(
        Effect.scoped(
          runStartPrerenderEffect({
            root,
            outDir,
            manifest,
            configFile: false,
            serverEntry: "/src/server.ts",
            prerender: {
              enabled: true,
              autoStaticPathsDiscovery: false,
              crawlLinks: false,
            },
          }),
        ),
      );
      const html = readFileSync(join(outDir, "index.html"), "utf8");

      expect(result.failures).toEqual([]);
      expect(result.pages.map((page) => page.page.path)).toEqual(["/"]);
      expect(html).toContain('href="/assets/app-abc.css"');
      expect(html).toContain('src="/assets/app-abc.js"');
      expect(html).not.toContain("/src/styles.css");
      expect(html).not.toContain("/src/main.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
