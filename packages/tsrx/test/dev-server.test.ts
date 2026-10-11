import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sunfallArcTsrx } from "../src/index.js";

// A Solid app root (resolves `solid-js` / `@solidjs/web` like a starter does).
const appRoot = new URL("../../solid/", import.meta.url).pathname;
// Arc core imports Solid's reactive core (`@solidjs/signals`) directly.
const coreSignal = new URL("../../core/src/signal.ts", import.meta.url).pathname;

const importSpecifiers = (code: string): ReadonlyArray<string> =>
  [...code.matchAll(/from\s+["']([^"']+)["']/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

describe("sunfallArcTsrx dev server", () => {
  let cacheDir = "";
  let server: ViteDevServer | undefined;

  beforeAll(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "sunfall-arc-tsrx-deps-"));
    server = await createServer({
      root: appRoot,
      configFile: false,
      logLevel: "silent",
      cacheDir,
      plugins: sunfallArcTsrx(),
      server: { middlewareMode: true, hmr: false, watch: null },
    });
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("serves Arc core's Solid reactive core from the pre-bundle solid-js shares", async () => {
    const result = await server?.transformRequest(`/@fs${coreSignal}`);
    const signals = importSpecifiers(result?.code ?? "").filter((specifier) =>
      specifier.includes("signals"),
    );

    // A raw `/@fs/.../@solidjs/signals/dist/*.js` import would be a second
    // reactive runtime beside the copy bundled into `solid-js`/`@solidjs/web`.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatch(/\/deps\/solid-js_n_@solidjs_signals\.js/);
  }, 60_000);
});
