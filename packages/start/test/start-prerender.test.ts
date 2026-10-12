import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { generateFileRouteManifestArtifact } from "../src/file-routes.js";
import {
  planStartPrerenderPages,
  resolveStartPrerenderOptions,
  runStartPrerender,
  StartPrerenderError,
} from "../src/start-prerender.js";
import { sunfallArcStart } from "../src/vite.js";

const manifest = generateFileRouteManifestArtifact(
  [
    "src/routes/index.tsx",
    "src/routes/about.tsx",
    "src/routes/posts/$slug.tsx",
    "src/routes/admin.tsx",
  ],
  { routeDirectory: "src/routes" },
);

const writePrerenderFixture = (
  root: string,
  options: {
    readonly body?: string;
    readonly failFirstAttempt?: boolean;
    readonly status?: number;
  } = {},
): string => {
  const outDir = join(root, "dist");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(outDir, ".vite"), { recursive: true });
  writeFileSync(
    join(outDir, ".vite/manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "assets/app-abc.js",
        src: "index.html",
        isEntry: true,
        imports: ["_shared-abc.js"],
        css: ["assets/app-abc.css"],
      },
      "_shared-abc.js": { file: "assets/shared-abc.js", css: ["assets/shared-abc.css"] },
    }),
  );
  writeFileSync(
    join(root, "src/server.ts"),
    [
      "let attempts = 0;",
      "export default function handleRequest() {",
      ...(options.failFirstAttempt
        ? ["  attempts += 1;", '  if (attempts === 1) throw new Error("flaky render");']
        : []),
      "  return new Response(",
      `    ${JSON.stringify(
        options.body ??
          [
            "<!doctype html>",
            "<html>",
            "  <head>",
            '    <link rel="stylesheet" href="/src/styles.css" data-sunfall-arc-docs-dev-style />',
            "  </head>",
            "  <body>",
            "    <main>Prerendered page</main>",
            '    <script type="module" src="/src/main.tsx"></script>',
            "  </body>",
            "</html>",
          ].join("\n"),
      )},`,
      `    { status: ${options.status ?? 200} }`,
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  return outDir;
};

const promiseLikeCallbackResult = { then() {} } as never;

describe("Start prerender planning", () => {
  it("discovers static file routes and keeps dynamic routes explicit", () => {
    const pages = planStartPrerenderPages(manifest, {
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
      filter: ({ path }) => path !== "/admin",
      pages: [{ path: "/about", prerender: false }],
    });

    expect(pages.map((page) => page.path)).toEqual(["/"]);
  });

  it("normalizes prerender defaults and disabled configs", () => {
    expect(resolveStartPrerenderOptions(false)).toBeUndefined();
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
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root);

      const result = await Effect.runPromise(
        Effect.scoped(
          runStartPrerender({
            root,
            outDir,
            manifest,
            configFile: false,
            serverEntry: "/src/server.ts",
            prerender: {
              autoStaticPathsDiscovery: false,
              crawlLinks: false,
            },
          }),
        ),
      );
      const html = readFileSync(join(outDir, "index.html"), "utf8");

      expect(result.failures).toEqual([]);
      expect(result.pages.map((page) => page.page.path)).toEqual(["/"]);
      expect(html).toContain('href="/assets/shared-abc.css"');
      expect(html).toContain('href="/assets/app-abc.css"');
      expect(html).toContain('src="/assets/app-abc.js"');
      expect(html).not.toContain("/src/styles.css");
      expect(html).not.toContain("/src/main.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces dev asset tags with production assets under a Vite base path", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root);

      const result = await Effect.runPromise(
        Effect.scoped(
          runStartPrerender({
            root,
            outDir,
            base: "/arc/",
            manifest,
            configFile: false,
            serverEntry: "/src/server.ts",
            prerender: {
              autoStaticPathsDiscovery: false,
              crawlLinks: false,
            },
          }),
        ),
      );
      const html = readFileSync(join(outDir, "index.html"), "utf8");

      expect(result.failures).toEqual([]);
      expect(result.pages.map((page) => page.page.path)).toEqual(["/"]);
      expect(html).toContain('href="/arc/assets/app-abc.css"');
      expect(html).toContain('src="/arc/assets/app-abc.js"');
      expect(html).not.toContain("/src/styles.css");
      expect(html).not.toContain("/src/main.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects Promise-shaped onSuccess callback work", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root);
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            runStartPrerender({
              root,
              outDir,
              manifest,
              configFile: false,
              serverEntry: "/src/server.ts",
              prerender: {
                autoStaticPathsDiscovery: false,
                crawlLinks: false,
                onSuccess: () => promiseLikeCallbackResult,
              },
            }),
          ),
        ),
      );

      expect(error).toMatchObject({
        operation: "callback",
        path: "/",
      });
      expect(error.message).toContain("onSuccess callback returned Promise-shaped work");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects Promise-shaped onError callback work", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root, { status: 500 });
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            runStartPrerender({
              root,
              outDir,
              manifest,
              configFile: false,
              serverEntry: "/src/server.ts",
              prerender: {
                autoStaticPathsDiscovery: false,
                crawlLinks: false,
                failOnError: false,
                onError: () => promiseLikeCallbackResult,
              },
            }),
          ),
        ),
      );

      expect(error).toMatchObject({
        operation: "callback",
        path: "/",
      });
      expect(error.message).toContain("onError callback returned Promise-shaped work");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs Effect-returning onSuccess callback work", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));
    let callbackCount = 0;

    try {
      const outDir = writePrerenderFixture(root);
      const result = await Effect.runPromise(
        Effect.scoped(
          runStartPrerender({
            root,
            outDir,
            manifest,
            configFile: false,
            serverEntry: "/src/server.ts",
            prerender: {
              autoStaticPathsDiscovery: false,
              crawlLinks: false,
              onSuccess: () =>
                Effect.sync(() => {
                  callbackCount += 1;
                }),
            },
          }),
        ),
      );

      expect(result.pages.map((page) => page.page.path)).toEqual(["/"]);
      expect(callbackCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports failed Effect-returning onError callback work", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root, { status: 500 });
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            runStartPrerender({
              root,
              outDir,
              manifest,
              configFile: false,
              serverEntry: "/src/server.ts",
              prerender: {
                autoStaticPathsDiscovery: false,
                crawlLinks: false,
                failOnError: false,
                onError: () => Effect.fail(new Error("callback effect failed")),
              },
            }),
          ),
        ),
      );

      expect(error).toMatchObject({
        operation: "callback",
        path: "/",
      });
      expect(error.message).toContain("onError callback Effect failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs prerendering from the Vite closeBundle host seam", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-vite-"));

    try {
      const outDir = writePrerenderFixture(root);
      mkdirSync(join(root, "src/routes"), { recursive: true });
      writeFileSync(join(root, "src/routes/index.tsx"), "export default function Index() {}\n");

      const plugin = sunfallArcStart({
        fileRoutes: ["src/routes/index.tsx"],
        fileRouteOptions: {
          routeDirectory: "src/routes",
        },
        serverEntry: "/src/server.ts",
        prerender: {
          autoStaticPathsDiscovery: false,
          crawlLinks: false,
        },
      });

      plugin.config({ root });
      plugin.configResolved({
        root,
        command: "build",
        mode: "production",
        configFile: false,
        build: { outDir },
      });
      const result = plugin.closeBundle();
      expect(result).toBeDefined();
      await result;

      const html = readFileSync(join(outDir, "index.html"), "utf8");
      expect(html).toContain("Prerendered page");
      expect(html).toContain('href="/assets/app-abc.css"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries failed renders with the configured schedule", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-retry-"));

    try {
      const outDir = writePrerenderFixture(root, { failFirstAttempt: true });
      const result = await Effect.runPromise(
        runStartPrerender({
          root,
          outDir,
          manifest,
          configFile: false,
          serverEntry: "/src/server.ts",
          prerender: {
            autoStaticPathsDiscovery: false,
            crawlLinks: false,
            retryCount: 1,
            retryDelay: 1,
          },
        }),
      );

      expect(result.failures).toEqual([]);
      expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain("Prerendered page");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a missing Vite build manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-manifest-"));

    try {
      const outDir = writePrerenderFixture(root);
      rmSync(join(outDir, ".vite"), { recursive: true, force: true });
      const error = await Effect.runPromise(
        Effect.flip(
          runStartPrerender({
            root,
            outDir,
            manifest,
            configFile: false,
            serverEntry: "/src/server.ts",
            prerender: { autoStaticPathsDiscovery: false, crawlLinks: false },
          }),
        ),
      );

      expect(error).toMatchObject({ operation: "read-assets" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
