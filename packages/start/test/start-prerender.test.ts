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
    readonly status?: number;
  } = {},
): string => {
  const outDir = join(root, "dist");
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
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root);

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

  it("rejects Promise-shaped onSuccess callback work", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-"));

    try {
      const outDir = writePrerenderFixture(root);
      const error = await Effect.runPromise(
        Effect.flip(
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
          enabled: true,
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

  it("reports Vite prerender server close failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-start-prerender-close-"));

    try {
      const outDir = writePrerenderFixture(root);
      const error = await Effect.runPromise(
        Effect.flip(
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
              vite: {
                plugins: [
                  {
                    name: "sunfall-arc-test-close-failure",
                    configureServer(server) {
                      const closeWebsocket = server.ws.close.bind(server.ws);
                      server.ws.close = () => {
                        closeWebsocket();
                        throw new Error("websocket close failed");
                      };
                    },
                  },
                ],
              },
            }),
          ),
        ),
      );

      expect(error).toMatchObject({ operation: "close-server" });
      expect(error.message).toContain("Could not close the Vite prerender websocket server");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
