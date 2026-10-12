import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { Data, Effect, type Scope } from "effect";
import { ClientAssets, type StartClientAssets } from "./start-client-assets.js";
import type { StartRequestHandlerInput } from "./start-host-adapter.js";

/**
 * Error raised when the production server cannot read its build or listen. It
 * names the client build directory and the address, with `host` undefined
 * when binding all interfaces.
 */
export class StartNodeServeError extends Data.TaggedError("StartNodeServeError")<{
  readonly operation: "read-client" | "listen";
  readonly clientDir: string;
  readonly host: string | undefined;
  readonly port: number;
  readonly error: unknown;
}> {
  override get message(): string {
    const reason = this.error instanceof Error ? this.error.message : String(this.error);
    if (this.operation === "read-client") {
      return `Cannot read the client build at ${this.clientDir}: ${reason}`;
    }
    const address = `${this.host ?? "all interfaces"} port ${this.port}`;
    const code = (this.error as { readonly code?: unknown } | null)?.code;
    if (code === "EADDRINUSE") {
      return `Cannot listen on ${address}: the port is already in use (set PORT to another port)`;
    }
    if (code === "EACCES") {
      return `Cannot listen on ${address}: permission denied`;
    }
    return `Cannot listen on ${address}: ${reason}`;
  }
}

/** Options for `serve`: where the client build lives and where to listen. */
export interface StartNodeServeOptions {
  /** The client build directory (Vite's client `outDir`), served as static files. */
  readonly clientDir: string;
  /** The client build the server renders documents for. */
  readonly assets: StartClientAssets;
  /** Vite's `base`, the URL prefix of the client build. Defaults to `"/"`. */
  readonly base?: string;
  /** Port to listen on. Defaults to `PORT` from the environment, then 3000. */
  readonly port?: number;
  /** Host to bind. Defaults to `HOST` from the environment, then all interfaces. */
  readonly host?: string;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

interface StaticFile {
  readonly path: string;
  readonly immutable: boolean;
  body?: Buffer;
}

/**
 * Every file of the client build by URL path, read once at startup so a page
 * request costs no file-system lookup. Vite's `.vite` metadata and the
 * build's `index.html` (the server renders documents) are not served.
 */
const staticFiles = (clientDir: string, base: string): Map<string, StaticFile> => {
  const files = new Map<string, StaticFile>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const urlPath = relative(clientDir, path).split(sep).join("/");
      if (entry.isDirectory()) {
        if (urlPath !== ".vite") {
          visit(path);
        }
      } else if (entry.isFile() && urlPath !== "index.html") {
        // Vite fingerprints everything it emits under `assets/`.
        files.set(`${base}${urlPath}`, { path, immutable: urlPath.startsWith("assets/") });
      }
    }
  };
  visit(clientDir);
  return files;
};

const sendStatic = (request: IncomingMessage, response: ServerResponse, file: StaticFile): void => {
  file.body ??= readFileSync(file.path);
  response.writeHead(200, {
    "content-type": contentTypes[extname(file.path)] ?? "application/octet-stream",
    "content-length": file.body.length,
    "cache-control": file.immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  response.end(request.method === "HEAD" ? undefined : file.body);
};

const requestPath = (url: string | undefined): string => {
  const raw = url ?? "/";
  const end = raw.search(/[?#]/);
  const path = end === -1 ? raw : raw.slice(0, end);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** Listens with `handler` behind the client build's static files (see `serve` in `./node`). */
export const listenStartNodeServer = (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  options: Omit<StartNodeServeOptions, "assets">,
): Effect.Effect<Server, StartNodeServeError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const base = options.base ?? "/";
      const port = options.port ?? Number(process.env.PORT ?? 3000);
      const host = options.host ?? process.env.HOST;
      const fail = (operation: "read-client" | "listen", error: unknown) =>
        new StartNodeServeError({ operation, clientDir: options.clientDir, host, port, error });
      const files = yield* Effect.try({
        try: () => staticFiles(options.clientDir, base),
        catch: (error) => fail("read-client", error),
      });
      const server = createServer((request, response) => {
        const method = request.method;
        const file =
          method === "GET" || method === "HEAD" ? files.get(requestPath(request.url)) : undefined;
        if (file !== undefined) {
          sendStatic(request, response, file);
        } else {
          handler(request, response);
        }
      });
      yield* Effect.callback<void, StartNodeServeError>((resume) => {
        const onError = (error: unknown): void => resume(Effect.fail(fail("listen", error)));
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resume(Effect.void);
        });
      });
      return server;
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }),
  );

/** Runs a Start request handler with the client build its documents reference. */
export const withClientAssets =
  <E, R>(
    handler: StartRequestHandlerInput<E, R>,
    assets: StartClientAssets,
  ): StartRequestHandlerInput<E, R> =>
  (request) =>
    Effect.provideService(handler(request), ClientAssets, assets);
