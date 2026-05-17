#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { createServer } from "vite";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

class DocsStaticExportError extends Data.TaggedError("DocsStaticExportError") {}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const configFile = resolve(root, "vite.config.ts");

const assetScriptPattern =
  /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/assets\/[^"]+\.js")[^>]*><\/script>/g;
const assetStylesheetPattern =
  /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="\/assets\/[^"]+\.css")[^>]*>/g;
const devEntryPattern = /<script type="module" src="\/src\/main\.tsx"><\/script>/;

const fail = (message, cause) => new DocsStaticExportError({ message, cause });

const promiseEffect = (message, task) =>
  Effect.tryPromise({
    try: task,
    catch: (cause) => fail(message, cause),
  });

const distPath = (outputPath) => {
  const target = resolve(dist, outputPath);
  if (target !== resolve(dist, "index.html") && !target.startsWith(`${dist}${sep}`)) {
    throw fail(`Refusing to write outside dist: ${outputPath}`);
  }
  return target;
};

const readBuiltAssetTags = Effect.gen(function* () {
  const indexHtml = yield* promiseEffect("Failed to read dist/index.html.", () =>
    readFile(resolve(dist, "index.html"), "utf8"),
  );
  const scripts = [...indexHtml.matchAll(assetScriptPattern)].map((match) => match[0]);
  const stylesheets = [...indexHtml.matchAll(assetStylesheetPattern)].map((match) => match[0]);

  if (scripts.length === 0) {
    return yield* Effect.fail(fail("Vite build output did not contain a hashed module script."));
  }

  return { scripts, stylesheets };
});

const injectProductionAssets = (html, assets) => {
  let next = html;

  if (assets.stylesheets.length > 0) {
    next = next.replace(/\n\s*<\/head>/, `\n    ${assets.stylesheets.join("\n    ")}\n  </head>`);
  }

  if (!devEntryPattern.test(next)) {
    throw fail("SSR HTML did not contain the development /src/main.tsx module script.");
  }

  return next.replace(devEntryPattern, assets.scripts.join("\n    "));
};

const enqueue = (queue, queued, path) => {
  if (queued.has(path)) {
    return;
  }
  queued.add(path);
  queue.push(path);
};

const createViteServer = Effect.acquireRelease(
  promiseEffect("Could not create the Vite static export server.", () =>
    createServer({
      root,
      configFile,
      appType: "custom",
      logLevel: "warn",
      server: {
        middlewareMode: true,
      },
    }),
  ),
  (server) =>
    promiseEffect("Could not close the Vite static export server.", () => server.close()).pipe(
      Effect.orDie,
    ),
);

const renderStaticSite = Effect.scoped(
  Effect.gen(function* () {
    const assets = yield* readBuiltAssetTags;
    const server = yield* createViteServer;
    const staticExport = yield* promiseEffect("Could not load the static export module.", () =>
      server.ssrLoadModule("/src/static-export.ts"),
    );
    const seedPaths = yield* staticExport.docsSiteStaticSeedPathsEffect;
    const queue = [];
    const queued = new Set();
    const rendered = new Set();
    const written = [];

    for (const path of seedPaths) {
      enqueue(queue, queued, path);
    }

    for (let index = 0; index < queue.length; index += 1) {
      const path = queue[index];
      if (rendered.has(path)) {
        continue;
      }
      rendered.add(path);

      const page = yield* staticExport.renderDocsSiteStaticPageEffect(path);
      if (page.status < 200 || page.status >= 300) {
        return yield* Effect.fail(fail(`Rendering ${path} returned HTTP ${page.status}.`));
      }

      const html = yield* Effect.try({
        try: () => injectProductionAssets(page.html, assets),
        catch: (cause) =>
          cause instanceof DocsStaticExportError
            ? cause
            : fail(`Could not prepare production assets for ${path}.`, cause),
      });
      const outputPath = staticExport.docsSiteStaticOutputPath(path);
      const absoluteOutputPath = yield* Effect.try({
        try: () => distPath(outputPath),
        catch: (cause) =>
          cause instanceof DocsStaticExportError
            ? cause
            : fail(`Could not resolve output path for ${path}.`, cause),
      });
      yield* promiseEffect(`Could not create ${relative(root, dirname(absoluteOutputPath))}.`, () =>
        mkdir(dirname(absoluteOutputPath), { recursive: true }),
      );
      yield* promiseEffect(`Could not write ${relative(root, absoluteOutputPath)}.`, () =>
        writeFile(absoluteOutputPath, html),
      );
      written.push(outputPath);

      for (const link of staticExport.docsSiteStaticLinks(html, path)) {
        enqueue(queue, queued, link);
      }
    }

    yield* Effect.sync(() => {
      console.log(
        [
          `Docs static export wrote ${written.length} pages.`,
          ...written.map((path) => `- ${relative(root, join(dist, path))}`),
        ].join("\n"),
      );
    });
  }),
);

runScriptMainEffect(
  renderStaticSite.pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        console.error(cause instanceof Error ? cause.message : cause);
        process.exitCode = 1;
      }),
    ),
  ),
  { onExit: (code) => process.exit(code) },
);
