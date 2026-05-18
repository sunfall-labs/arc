import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(docsRoot, "dist");
const manifestFile = join(distRoot, ".vite", "manifest.json");

const budgets = {
  initialJavaScriptGzipBytes: 116 * 1024,
  initialCssGzipBytes: 16 * 1024,
  initialAssetGzipBytes: 128 * 1024,
  largestInitialAssetGzipBytes: 116 * 1024,
  largestHtmlGzipBytes: 16 * 1024,
};

const forbiddenClientPatterns = [
  { name: "@shikijs packages", pattern: /@shikijs\//u },
  { name: "Shiki runtime", pattern: /\bshiki\/(?:core|engine|langs|themes)\b/u },
  { name: "Node fs module", pattern: /\bnode:fs\b/u },
  { name: "server-only content loader", pattern: /\breadRecipeFileEffect\b/u },
  { name: "content.server module", pattern: /\bcontent\.server\b/u },
];

class PerformanceBudgetError extends Data.TaggedError("PerformanceBudgetError") {}

const fail = (message, repair, cause) => new PerformanceBudgetError({ message, repair, cause });

const fsEffect = (description, effect) =>
  Effect.tryPromise({
    try: effect,
    catch: (cause) =>
      fail(
        `Failed to ${description}.`,
        "Run the docs-site production build before checking the performance budget.",
        cause,
      ),
  });

const readTextEffect = (filePath) =>
  fsEffect(`read ${relative(distRoot, filePath)}`, () => readFile(filePath, "utf8"));

const readDirEffect = (directory) =>
  fsEffect(`read ${relative(distRoot, directory)}`, () =>
    readdir(directory, { withFileTypes: true }),
  );

const readJsonEffect = (filePath) =>
  readTextEffect(filePath).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: (cause) =>
          fail(
            `Failed to parse ${relative(distRoot, filePath)} as JSON.`,
            "Check that Vite emitted a valid production manifest.",
            cause,
          ),
      }),
    ),
  );

const collectFilesEffect = (directory) =>
  Effect.gen(function* () {
    const entries = yield* readDirEffect(directory);
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(yield* collectFilesEffect(path)));
        continue;
      }
      if (entry.isFile()) {
        files.push(path);
      }
    }
    return files;
  });

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const gzipBytes = (text) => gzipSync(Buffer.from(text)).byteLength;

const unique = (values) => [...new Set(values)];

const manifestEntryForIndex = (manifest) =>
  manifest["index.html"] ??
  Object.values(manifest).find((entry) => entry?.isEntry === true && entry?.src === "index.html");

const initialAssetFilesFromManifest = (manifest) => {
  const entry = manifestEntryForIndex(manifest);
  if (entry === undefined) {
    throw fail(
      "Docs build manifest is missing the index.html entry.",
      "Keep Vite manifest output enabled for the docs-site production build.",
    );
  }

  const jsFiles = [];
  const cssFiles = [];
  const visited = new Set();
  const visit = (manifestKey) => {
    if (visited.has(manifestKey)) {
      return;
    }
    visited.add(manifestKey);

    const chunk = manifest[manifestKey];
    if (chunk === undefined) {
      throw fail(
        `Docs build manifest references missing chunk ${manifestKey}.`,
        "Regenerate the docs-site production build.",
      );
    }

    if (typeof chunk.file === "string") {
      jsFiles.push(chunk.file);
    }
    if (Array.isArray(chunk.css)) {
      cssFiles.push(...chunk.css);
    }
    for (const imported of chunk.imports ?? []) {
      visit(imported);
    }
  };

  const entryKey =
    Object.entries(manifest).find(([, value]) => value === entry)?.[0] ?? "index.html";
  visit(entryKey);

  return {
    jsFiles: unique(jsFiles),
    cssFiles: unique(cssFiles),
    allFiles: unique([...jsFiles, ...cssFiles]),
  };
};

const fileMetricsEffect = (filePath) =>
  readTextEffect(filePath).pipe(
    Effect.map((text) => ({
      file: relative(distRoot, filePath),
      rawBytes: Buffer.byteLength(text),
      gzipBytes: gzipBytes(text),
      text,
    })),
  );

const sumGzip = (metrics) => metrics.reduce((total, metric) => total + metric.gzipBytes, 0);

const largestByGzip = (metrics) =>
  metrics.reduce((largest, metric) => (metric.gzipBytes > largest.gzipBytes ? metric : largest), {
    file: "",
    rawBytes: 0,
    gzipBytes: 0,
    text: "",
  });

const budgetFailures = (metrics) => {
  const failures = [];
  if (metrics.initialJavaScriptGzipBytes > budgets.initialJavaScriptGzipBytes) {
    failures.push(
      `initial JS is ${formatBytes(metrics.initialJavaScriptGzipBytes)} over ${formatBytes(
        budgets.initialJavaScriptGzipBytes,
      )}`,
    );
  }
  if (metrics.initialCssGzipBytes > budgets.initialCssGzipBytes) {
    failures.push(
      `initial CSS is ${formatBytes(metrics.initialCssGzipBytes)} over ${formatBytes(
        budgets.initialCssGzipBytes,
      )}`,
    );
  }
  if (metrics.initialAssetGzipBytes > budgets.initialAssetGzipBytes) {
    failures.push(
      `initial assets are ${formatBytes(metrics.initialAssetGzipBytes)} over ${formatBytes(
        budgets.initialAssetGzipBytes,
      )}`,
    );
  }
  if (metrics.largestInitialAsset.gzipBytes > budgets.largestInitialAssetGzipBytes) {
    failures.push(
      `${metrics.largestInitialAsset.file} is ${formatBytes(
        metrics.largestInitialAsset.gzipBytes,
      )} gzip over ${formatBytes(budgets.largestInitialAssetGzipBytes)}`,
    );
  }
  if (metrics.largestHtml.gzipBytes > budgets.largestHtmlGzipBytes) {
    failures.push(
      `${metrics.largestHtml.file} is ${formatBytes(metrics.largestHtml.gzipBytes)} gzip over ${formatBytes(
        budgets.largestHtmlGzipBytes,
      )}`,
    );
  }
  return failures;
};

const clientBoundaryFailures = (assetMetrics) => {
  const failures = [];
  for (const metric of assetMetrics) {
    if (!metric.file.endsWith(".js")) {
      continue;
    }
    for (const forbidden of forbiddenClientPatterns) {
      if (forbidden.pattern.test(metric.text)) {
        failures.push(`${metric.file} contains ${forbidden.name}`);
      }
    }
  }
  return failures;
};

const prerenderFailures = (htmlMetrics) => {
  const failures = [];
  for (const metric of htmlMetrics) {
    if (!/<div id="root"><main\b/u.test(metric.text)) {
      failures.push(`${metric.file} does not contain prerendered app HTML inside #root`);
    }
    if (/<div id="root"><\/div>/u.test(metric.text)) {
      failures.push(`${metric.file} ships an empty #root`);
    }
    if (/Loading recipes|Loading page/u.test(metric.text)) {
      failures.push(`${metric.file} ships loading fallback text in prerendered HTML`);
    }
  }
  return failures;
};

const mainEffect = Effect.gen(function* () {
  const manifest = yield* readJsonEffect(manifestFile);
  const files = yield* collectFilesEffect(distRoot);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  const clientAssetFiles = initialAssetFilesFromManifest(manifest);

  const initialJsMetrics = yield* Effect.forEach(clientAssetFiles.jsFiles, (file) =>
    fileMetricsEffect(join(distRoot, file)),
  );
  const initialCssMetrics = yield* Effect.forEach(clientAssetFiles.cssFiles, (file) =>
    fileMetricsEffect(join(distRoot, file)),
  );
  const initialAssetMetrics = [...initialJsMetrics, ...initialCssMetrics];
  const htmlMetrics = yield* Effect.forEach(htmlFiles, fileMetricsEffect);

  const metrics = {
    initialJavaScriptGzipBytes: sumGzip(initialJsMetrics),
    initialCssGzipBytes: sumGzip(initialCssMetrics),
    initialAssetGzipBytes: sumGzip(initialAssetMetrics),
    largestInitialAsset: largestByGzip(initialAssetMetrics),
    largestHtml: largestByGzip(htmlMetrics),
  };

  const failures = [
    ...budgetFailures(metrics),
    ...clientBoundaryFailures(initialAssetMetrics),
    ...prerenderFailures(htmlMetrics),
  ];

  if (failures.length > 0) {
    return yield* Effect.fail(
      fail(
        ["Docs performance budget failed:", ...failures.map((failure) => `- ${failure}`)].join(
          "\n",
        ),
        "Trim the initial client graph, keep server-only modules out of browser assets, or raise the checked budget with fresh benchmark evidence.",
      ),
    );
  }

  console.log(
    [
      "Docs performance budget passed.",
      `initial JS gzip: ${formatBytes(metrics.initialJavaScriptGzipBytes)}`,
      `initial CSS gzip: ${formatBytes(metrics.initialCssGzipBytes)}`,
      `initial assets gzip: ${formatBytes(metrics.initialAssetGzipBytes)}`,
      `largest initial asset: ${metrics.largestInitialAsset.file} (${formatBytes(
        metrics.largestInitialAsset.gzipBytes,
      )})`,
      `largest HTML: ${metrics.largestHtml.file} (${formatBytes(metrics.largestHtml.gzipBytes)})`,
      `HTML pages checked: ${htmlMetrics.length}`,
    ].join("\n"),
  );
});

runScriptMainEffect(
  mainEffect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        if (error.repair !== undefined && error.repair !== "") {
          console.error(error.repair);
        }
        process.exitCode = 1;
      }),
    ),
  ),
);
