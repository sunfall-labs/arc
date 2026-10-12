// Production Node server for the Arc app. Arc ships a Node adapter
// (`@sunfall/arc-start/node`) but no production server build, so this file is
// the wiring an app writes itself: serve Vite's built assets, and pass the
// built entry, its CSS, and its static imports to the Start document.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeServerHandler } from "@sunfall/arc-start/node";
import { createHandler } from "./dist/server/server.js";

const root = fileURLToPath(new URL("./dist/client/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, ".vite/manifest.json"), "utf8"));
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const entry = manifest[entryKey];

const staticImports = (key, seen = new Set()) => {
  for (const imported of manifest[key].imports ?? []) {
    if (!seen.has(imported)) {
      seen.add(imported);
      staticImports(imported, seen);
    }
  }
  return seen;
};

const handler = createNodeServerHandler(
  createHandler({
    entry: `/${entry.file}`,
    css: (entry.css ?? []).map((file) => `/${file}`),
    modulepreload: [...staticImports(entryKey)].map((key) => `/${manifest[key].file}`),
  }),
);

const contentTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// Hashed assets are immutable: read once, cache in memory, long max-age.
const assets = new Map();
const serveAsset = (pathname, response) => {
  let body = assets.get(pathname);
  if (body === undefined) {
    const file = normalize(join(root, pathname));
    if (!file.startsWith(join(root, "assets"))) {
      return false;
    }
    try {
      body = readFileSync(file);
    } catch {
      return false;
    }
    assets.set(pathname, body);
  }
  response.writeHead(200, {
    "content-type": contentTypes[extname(pathname)] ?? "application/octet-stream",
    "content-length": body.length,
    "cache-control": "public, max-age=31536000, immutable",
  });
  response.end(body);
  return true;
};

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname.startsWith("/assets/") && serveAsset(pathname, response)) {
    return;
  }
  handler(request, response);
}).listen(port, host, () => {
  console.log(`arc listening on http://${host}:${port}`);
});
