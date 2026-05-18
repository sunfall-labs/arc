import { createServer } from "node:http";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(docsRoot, "dist");
const host = "127.0.0.1";

const pageBasePathFromEnvironment = () => {
  const value = process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH;
  if (value === undefined || value.trim().length === 0) {
    throw new Error(
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
    throw new Error(`Invalid DOCS_SITE_BASE_PATH: ${input}`);
  }

  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+/gu, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const basePath = normalizeBasePath(pageBasePathFromEnvironment());

const collectHtmlFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? collectHtmlFiles(path)
        : entry.isFile() && entry.name.endsWith(".html")
          ? [path]
          : [];
    }),
  );
  return files.flat();
};

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

const resolveDistFile = async (pathname) => {
  if (basePath !== "/" && !(pathname === basePath.slice(0, -1) || pathname.startsWith(basePath))) {
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

  try {
    const current = await stat(filePath);
    if (current.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
  } catch {
    if (extname(filePath) === "") {
      filePath = join(filePath, "index.html");
    }
  }

  try {
    const resolved = await stat(filePath);
    return resolved.isFile() && isWithinDist(filePath) ? filePath : undefined;
  } catch {
    return undefined;
  }
};

const createPagesServer = () =>
  createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const filePath = await resolveDistFile(url.pathname);
    if (filePath === undefined) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, { "content-type": mimeType(filePath) });
    createReadStream(filePath).pipe(response);
  });

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const fetchOk = async (origin, path) => {
  const response = await fetch(new URL(path, origin));
  if (!response.ok) {
    throw new Error(`Expected ${path} to return 2xx, got ${response.status}.`);
  }
  return response.text();
};

const prefixedAttributeValues = (html) =>
  [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/giu)]
    .map((match) => match[1])
    .filter((value) => value?.startsWith(basePath));

await access(join(distRoot, "index.html"));

const htmlFiles = await collectHtmlFiles(distRoot);
const nestedHtmlFile = htmlFiles.find((file) => relative(distRoot, file) !== "index.html");
const nestedPath =
  nestedHtmlFile === undefined
    ? undefined
    : `${basePath}${relative(distRoot, nestedHtmlFile)
        .replace(/\\/gu, "/")
        .replace(/(?:^|\/)index\.html$/u, "")}`;

const server = createPagesServer();
const port = await listen(server);
const origin = `http://${host}:${port}`;

try {
  const rootHtml = await fetchOk(origin, basePath);
  const urls = new Set([basePath, ...prefixedAttributeValues(rootHtml)]);
  if (nestedPath !== undefined) {
    urls.add(nestedPath);
  }

  for (const url of urls) {
    await fetchOk(origin, url);
  }

  console.log(`Smoke-tested ${urls.size} GitHub Pages URLs for base path ${basePath}.`);
} finally {
  await close(server);
}
