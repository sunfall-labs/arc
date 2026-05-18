import { access, createReadStream, readdir, stat } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect } from "effect";
import { runScriptMainEffect } from "./effect-main-runner.mjs";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(docsRoot, "dist");
const host = "127.0.0.1";

class PagesBuildSmokeError extends Data.TaggedError("PagesBuildSmokeError") {}

const fail = (message, repair, cause) => new PagesBuildSmokeError({ message, repair, cause });

const fsEffect = (description, register) =>
  Effect.callback((resume) => {
    register((cause, value) => {
      if (cause) {
        resume(
          Effect.fail(
            fail(
              `Failed to ${description}.`,
              "Run the docs-site GitHub Pages build before smoke testing.",
              cause,
            ),
          ),
        );
        return;
      }
      resume(Effect.succeed(value));
    });
  });

const accessEffect = (filePath) =>
  fsEffect(`access ${relative(distRoot, filePath)}`, (resume) => access(filePath, resume)).pipe(
    Effect.asVoid,
  );

const readDirEffect = (directory) =>
  fsEffect(`read ${relative(distRoot, directory)}`, (resume) =>
    readdir(directory, { withFileTypes: true }, resume),
  );

const statEffect = (filePath) =>
  fsEffect(`stat ${relative(distRoot, filePath)}`, (resume) => stat(filePath, resume));

const statOptionEffect = (filePath) =>
  statEffect(filePath).pipe(
    Effect.map((value) => ({ _tag: "Some", value })),
    Effect.catch(() => Effect.succeed({ _tag: "None" })),
  );

const pageBasePathFromEnvironment = () => {
  const value = process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH;
  if (value === undefined || value.trim().length === 0) {
    throw fail(
      "Missing DOCS_SITE_BASE_PATH.",
      "Set DOCS_SITE_BASE_PATH before smoke-testing a GitHub Pages build, such as '/repository-name/'.",
    );
  }
  return value;
};

const normalizeBasePath = (input) => {
  const value = input.trim();
  if (value.length === 0 || value === "/") {
    return "/";
  }
  if (value.includes("?") || value.includes("#") || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(value)) {
    throw fail(
      `Invalid DOCS_SITE_BASE_PATH: ${input}`,
      "Use a path prefix such as '/repository-name/'.",
    );
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const basePathEffect = Effect.try({
  try: () => normalizeBasePath(pageBasePathFromEnvironment()),
  catch: (cause) =>
    cause instanceof PagesBuildSmokeError
      ? cause
      : fail(
          "Failed to read GitHub Pages base path.",
          "Set DOCS_SITE_BASE_PATH before smoke testing.",
          cause,
        ),
});

const collectHtmlFilesEffect = (directory) =>
  Effect.gen(function* () {
    const entries = yield* readDirEffect(directory);
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(yield* collectHtmlFilesEffect(path)));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(path);
      }
    }
    return files;
  });

const mimeType = (filePath) => {
  switch (extname(filePath)) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
};

const isWithinDist = (filePath) => {
  const path = relative(distRoot, filePath);
  return path === "" || (!path.startsWith("..") && !path.includes(`..${sep}`));
};

const resolveDistFileEffect = (basePath, pathname) =>
  Effect.gen(function* () {
    if (
      basePath !== "/" &&
      !(pathname === basePath.slice(0, -1) || pathname.startsWith(basePath))
    ) {
      return undefined;
    }

    const withoutBase =
      basePath === "/"
        ? pathname.replace(/^\/+/u, "")
        : pathname === basePath.slice(0, -1)
          ? ""
          : pathname.slice(basePath.length);
    let filePath = join(distRoot, decodeURIComponent(withoutBase));
    if (!isWithinDist(filePath)) {
      return undefined;
    }

    const current = yield* statOptionEffect(filePath);
    if (current._tag === "Some" && current.value.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (current._tag === "None" && extname(filePath) === "") {
      filePath = join(filePath, "index.html");
    }

    const resolved = yield* statOptionEffect(filePath);
    return resolved._tag === "Some" && resolved.value.isFile() && isWithinDist(filePath)
      ? filePath
      : undefined;
  });

const createPagesServer = (basePath) =>
  createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    Effect.runFork(
      resolveDistFileEffect(basePath, url.pathname).pipe(
        Effect.tap((filePath) =>
          Effect.sync(() => {
            if (filePath === undefined) {
              response.writeHead(404).end("Not found");
              return;
            }

            response.writeHead(200, { "content-type": mimeType(filePath) });
            createReadStream(filePath).pipe(response);
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            response.writeHead(500).end(error.message);
          }),
        ),
      ),
    );
  });

const listenEffect = (server) =>
  Effect.callback((resume) => {
    const onError = (cause) => {
      resume(
        Effect.fail(
          fail(
            "Failed to start GitHub Pages smoke server.",
            "Check local port availability.",
            cause,
          ),
        ),
      );
    };
    server.once("error", onError);
    server.listen(0, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (typeof address === "object" && address !== null && typeof address.port === "number") {
        resume(Effect.succeed(address.port));
        return;
      }
      resume(
        Effect.fail(
          fail(
            "GitHub Pages smoke server did not expose a TCP port.",
            "Use an HTTP server address for smoke testing.",
          ),
        ),
      );
    });
  });

const closeEffect = (server) =>
  Effect.callback((resume) => {
    server.close((cause) => {
      if (cause) {
        resume(
          Effect.fail(
            fail(
              "Failed to close GitHub Pages smoke server.",
              "Check the local test server lifecycle.",
              cause,
            ),
          ),
        );
        return;
      }
      resume(Effect.void);
    });
  });

const fetchOkEffect = (origin, path) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(new URL(path, origin)),
      catch: (cause) =>
        fail(`Failed to fetch ${path}.`, "Ensure the local smoke server is running.", cause),
    });
    if (!response.ok) {
      return yield* Effect.fail(
        fail(`Expected ${path} to return 2xx, got ${response.status}.`, "Fix the Pages output."),
      );
    }
    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        fail(`Failed to read response body for ${path}.`, "Check the local smoke response.", cause),
    });
  });

const prefixedAttributeValues = (basePath, html) =>
  [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/giu)]
    .map((match) => match[1])
    .filter((value) => value?.startsWith(basePath));

const mainEffect = Effect.gen(function* () {
  const basePath = yield* basePathEffect;
  yield* accessEffect(join(distRoot, "index.html"));

  const htmlFiles = yield* collectHtmlFilesEffect(distRoot);
  const nestedHtmlFile = htmlFiles.find((file) => relative(distRoot, file) !== "index.html");
  const nestedPath =
    nestedHtmlFile === undefined
      ? undefined
      : `${basePath}${relative(distRoot, nestedHtmlFile)
          .replace(/\\/gu, "/")
          .replace(/(?:^|\/)index\.html$/u, "")}`;

  const server = createPagesServer(basePath);
  const port = yield* listenEffect(server);
  const origin = `http://${host}:${port}`;

  yield* Effect.gen(function* () {
    const rootHtml = yield* fetchOkEffect(origin, basePath);
    const urls = new Set([basePath, ...prefixedAttributeValues(basePath, rootHtml)]);
    if (nestedPath !== undefined) {
      urls.add(nestedPath);
    }

    for (const url of urls) {
      yield* fetchOkEffect(origin, url);
    }

    console.log(`Smoke-tested ${urls.size} GitHub Pages URLs for base path ${basePath}.`);
  }).pipe(Effect.ensuring(closeEffect(server).pipe(Effect.catch(() => Effect.void))));
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
