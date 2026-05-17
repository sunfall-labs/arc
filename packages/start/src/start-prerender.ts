import { Cause, Data, Effect, Exit, Scope } from "effect";
import {
  EffectInputPromiseRejected,
  isPromiseLikeValue,
  toEffect,
  type EffectInput,
} from "@sunfall/arc-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createServer, type InlineConfig, type ViteDevServer } from "vite";
import type { FileRouteManifest } from "./file-routes.js";
import type { StartNodeRequestOptions } from "./node-web-exchange.js";
import {
  resolveStartHandlerEffect,
  type StartSsrHandlerModule,
  type StartSsrRequestHandler,
  type StartViteDevServer,
} from "./start-vite-dev-ssr.js";
import { responseWithScopeLifetimeEffect } from "./response-lifetime.js";
import { suspendResponseStreamSuccessFinalizerEffect } from "./streaming.js";
import { defaultServerEntry } from "./start-manifest-wall.js";
import {
  extractStartStaticHtmlLinks,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
} from "./static-export.js";

/** Per-page prerender override for explicit pages. */
export interface StartPrerenderPageOptions {
  /** Whether this explicit page should be prerendered. Defaults to true. */
  readonly enabled?: boolean;
  /** HTML output path relative to the build output directory. */
  readonly outputPath?: string;
}

/** Explicit page entry added to the static prerender plan. */
export interface StartPrerenderPage {
  /** Root-relative page path to prerender. */
  readonly path: string;
  /** HTML output path relative to the build output directory. */
  readonly outputPath?: string;
  /** Per-page prerender override. */
  readonly prerender?: boolean | StartPrerenderPageOptions;
}

/** Explicit prerender page input accepted by `StartPrerenderOptions.pages`. */
export type StartPrerenderPageInput = string | StartPrerenderPage;

/** Planned page identity passed through filters and prerender callbacks. */
export interface StartPrerenderPageContext {
  readonly path: string;
  readonly source: "static-route" | "page" | "crawl" | "root";
}

/** Event emitted after one prerender page is written successfully. */
export interface StartPrerenderSuccessEvent {
  readonly page: StartPrerenderPageContext;
  readonly outputPath: string;
  readonly status: number;
}

/** Event emitted after one prerender page exhausts its render attempts. */
export interface StartPrerenderFailureEvent {
  readonly page: StartPrerenderPageContext;
  readonly error: unknown;
  readonly attempts: number;
}

/** Static prerender options consumed by the Start Vite build hook. */
export interface StartPrerenderOptions {
  /** Enables static prerendering after a production Vite build. */
  readonly enabled?: boolean;
  /** Origin used when constructing build-time SSR requests. */
  readonly origin?: string;
  /** Write `/docs` to `docs/index.html` instead of `docs.html`. Defaults to true. */
  readonly autoSubfolderIndex?: boolean;
  /** Add file routes without params to the initial prerender queue. Defaults to true. */
  readonly autoStaticPathsDiscovery?: boolean;
  /** Crawl internal anchor links from prerendered HTML. Defaults to true. */
  readonly crawlLinks?: boolean;
  /** Explicit pages to add to or override the static route discovery plan. */
  readonly pages?: readonly StartPrerenderPageInput[];
  /** Include or exclude a planned page before rendering. */
  readonly filter?: (page: StartPrerenderPageContext) => boolean;
  /** Number of retries after the first failed render attempt. Defaults to 0. */
  readonly retryCount?: number;
  /** Delay between retries in milliseconds. Defaults to 0. */
  readonly retryDelay?: number;
  /** Reject the build when any prerender page fails. Defaults to true. */
  readonly failOnError?: boolean;
  /** Called after a page is successfully written; returned Effects are executed. */
  readonly onSuccess?: (event: StartPrerenderSuccessEvent) => EffectInput<void, unknown, never>;
  /** Called after all attempts for a page fail; returned Effects are executed. */
  readonly onError?: (event: StartPrerenderFailureEvent) => EffectInput<void, unknown, never>;
}

/** Boolean shorthand or option object for configuring Start prerendering. */
export type StartPrerenderConfig = boolean | StartPrerenderOptions;

/** Runtime input for executing the Start prerender Effect. */
export interface StartPrerenderRunOptions {
  readonly root: string;
  readonly outDir: string;
  readonly manifest: FileRouteManifest;
  readonly prerender: StartPrerenderConfig;
  /** Inline Vite config used by the temporary prerender SSR server. */
  readonly vite?: InlineConfig;
  readonly serverEntry?: string;
  readonly handlerExport?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
  readonly nodeRequest?: StartNodeRequestOptions;
}

/** Summary returned by `runStartPrerenderEffect(...)`. */
export interface StartPrerenderResult {
  readonly pages: readonly StartPrerenderSuccessEvent[];
  readonly failures: readonly StartPrerenderFailureEvent[];
}

/** Typed failure reported by Start prerender planning, rendering, writing, and callbacks. */
export class StartPrerenderError extends Data.TaggedError("StartPrerenderError")<{
  readonly operation:
    | "read-assets"
    | "create-server"
    | "close-server"
    | "render-page"
    | "prepare-html"
    | "create-directory"
    | "write-page"
    | "callback";
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

/** Fully defaulted prerender options used by the Start prerender runner. */
export interface ResolvedStartPrerenderOptions {
  readonly origin: string;
  readonly autoSubfolderIndex: boolean;
  readonly autoStaticPathsDiscovery: boolean;
  readonly crawlLinks: boolean;
  readonly pages: readonly StartPrerenderPageInput[];
  readonly filter?: (page: StartPrerenderPageContext) => boolean;
  readonly retryCount: number;
  readonly retryDelay: number;
  readonly failOnError: boolean;
  readonly onSuccess?: (event: StartPrerenderSuccessEvent) => EffectInput<void, unknown, never>;
  readonly onError?: (event: StartPrerenderFailureEvent) => EffectInput<void, unknown, never>;
}

/** Concrete page selected for a prerender run. */
export interface StartPrerenderPlannedPage extends StartPrerenderPageContext {
  readonly outputPath?: string;
}

type StartPrerenderViteServer = StartViteDevServer & Pick<ViteDevServer, "close" | "hot" | "ws">;

const closePrerenderServerHandle = (
  close: (() => unknown) | undefined,
  message: string,
): Effect.Effect<void, StartPrerenderError> =>
  close === undefined
    ? Effect.void
    : Effect.try({
        try: close,
        catch: startPrerenderHostError("close-server", message),
      }).pipe(
        Effect.flatMap((result) =>
          isPromiseLikeValue(result)
            ? Effect.tryPromise({
                try: () => result as ReturnType<ViteDevServer["close"]>,
                catch: startPrerenderHostError("close-server", message),
              }).pipe(Effect.asVoid)
            : Effect.void,
        ),
      );

const defaultPrerenderOrigin = "https://sunfall-arc.static";

const assetScriptPattern =
  /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/assets\/[^"]+\.js")[^>]*><\/script>/g;
const assetStylesheetPattern =
  /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="\/assets\/[^"]+\.css")[^>]*>/g;
const devStylesheetPattern =
  /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="\/(?:src|@fs)\/[^"]+\.css(?:\?[^"]*)?")[^>]*>/g;
const devModuleScriptPattern =
  /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/(?:src|@fs)\/[^"]+")[^>]*><\/script>/g;

const startPrerenderError = (
  operation: StartPrerenderError["operation"],
  message: string,
  options: { readonly path?: string; readonly cause?: unknown } = {},
): StartPrerenderError =>
  new StartPrerenderError({
    operation,
    message,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });

const startPrerenderHostError =
  (
    operation: StartPrerenderError["operation"],
    message: string,
    path?: string,
  ): ((cause: unknown) => StartPrerenderError) =>
  (cause) =>
    startPrerenderError(operation, message, {
      ...(path === undefined ? {} : { path }),
      cause,
    });

const positiveInteger = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? fallback : Math.floor(value);

/** Resolves boolean or partial prerender config into defaulted options. */
export const resolveStartPrerenderOptions = (
  config: StartPrerenderConfig | undefined,
): ResolvedStartPrerenderOptions | undefined => {
  if (config === undefined || config === false) {
    return undefined;
  }
  const options = config === true ? {} : config;
  if (options.enabled === false) {
    return undefined;
  }

  return {
    origin: options.origin ?? defaultPrerenderOrigin,
    autoSubfolderIndex: options.autoSubfolderIndex ?? true,
    autoStaticPathsDiscovery: options.autoStaticPathsDiscovery ?? true,
    crawlLinks: options.crawlLinks ?? true,
    pages: options.pages ?? [],
    ...(options.filter === undefined ? {} : { filter: options.filter }),
    retryCount: positiveInteger(options.retryCount, 0),
    retryDelay: positiveInteger(options.retryDelay, 0),
    failOnError: options.failOnError ?? true,
    ...(options.onSuccess === undefined ? {} : { onSuccess: options.onSuccess }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  };
};

const explicitPageOptions = (
  input: StartPrerenderPageInput,
): { readonly path: string; readonly outputPath?: string; readonly enabled: boolean } => {
  if (typeof input === "string") {
    return { path: normalizeStartStaticPath(input), enabled: true };
  }

  const path = normalizeStartStaticPath(input.path);
  const prerender = input.prerender;
  const pageOptions = typeof prerender === "object" && prerender !== null ? prerender : {};
  const outputPath = pageOptions.outputPath ?? input.outputPath;
  return {
    path,
    ...(outputPath === undefined ? {} : { outputPath }),
    enabled: prerender === false || pageOptions.enabled === false ? false : true,
  };
};

const staticRoutePages = (manifest: FileRouteManifest): readonly StartPrerenderPlannedPage[] =>
  manifest.entries
    .filter((entry) => entry.params.length === 0)
    .map((entry) => ({
      path: normalizeStartStaticPath(entry.routePath),
      source: "static-route" as const,
    }));

/** Builds the ordered static prerender queue from file routes and explicit pages. */
export const planStartPrerenderPages = (
  manifest: FileRouteManifest,
  config: StartPrerenderConfig | undefined,
): readonly StartPrerenderPlannedPage[] => {
  const options = resolveStartPrerenderOptions(config);
  if (options === undefined) {
    return [];
  }

  const pages = new Map<string, StartPrerenderPlannedPage>();
  const disabled = new Set<string>();
  const addPage = (page: StartPrerenderPlannedPage): void => {
    if (disabled.has(page.path)) {
      return;
    }
    if (options.filter?.(page) === false) {
      return;
    }
    pages.set(page.path, page);
  };

  if (options.autoStaticPathsDiscovery) {
    for (const page of staticRoutePages(manifest)) {
      addPage(page);
    }
  } else {
    addPage({ path: "/", source: "root" });
  }

  for (const input of options.pages) {
    const page = explicitPageOptions(input);
    if (!page.enabled) {
      disabled.add(page.path);
      pages.delete(page.path);
      continue;
    }
    addPage({
      path: page.path,
      source: "page",
      ...(page.outputPath === undefined ? {} : { outputPath: page.outputPath }),
    });
  }

  return [...pages.values()];
};

const outputPathForPage = (
  page: StartPrerenderPlannedPage,
  options: ResolvedStartPrerenderOptions,
): string =>
  page.outputPath === undefined
    ? startStaticPageOutputPath(page.path, {
        autoSubfolderIndex: options.autoSubfolderIndex,
      })
    : page.outputPath.replace(/^\/+/, "");

const resolveOutputPath = (
  outDir: string,
  outputPath: string,
): Effect.Effect<string, StartPrerenderError> =>
  Effect.try({
    try: () => {
      const target = resolve(outDir, outputPath);
      const relativeTarget = relative(outDir, target);
      if (relativeTarget === "" || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
        throw startPrerenderError(
          "write-page",
          `Refusing to write prerendered HTML outside the build output directory: ${outputPath}`,
        );
      }
      if (target !== resolve(outDir, "index.html") && !target.startsWith(`${outDir}${sep}`)) {
        throw startPrerenderError(
          "write-page",
          `Refusing to write prerendered HTML outside the build output directory: ${outputPath}`,
        );
      }
      return target;
    },
    catch: (cause) =>
      cause instanceof StartPrerenderError
        ? cause
        : startPrerenderError("write-page", "Could not resolve prerender output path.", {
            cause,
          }),
  });

const readBuiltAssetTags = (
  outDir: string,
): Effect.Effect<
  { readonly scripts: readonly string[]; readonly stylesheets: readonly string[] },
  StartPrerenderError
> =>
  Effect.gen(function* () {
    const indexHtml = yield* Effect.tryPromise({
      try: () => readFile(resolve(outDir, "index.html"), "utf8"),
      catch: startPrerenderHostError(
        "read-assets",
        "Failed to read the production index.html for prerender asset injection.",
      ),
    });
    const scripts = [...indexHtml.matchAll(assetScriptPattern)].map((match) => match[0]);
    const stylesheets = [...indexHtml.matchAll(assetStylesheetPattern)].map((match) => match[0]);

    if (scripts.length === 0) {
      return yield* Effect.fail(
        startPrerenderError(
          "read-assets",
          "Vite build output did not contain a hashed module script.",
        ),
      );
    }

    return { scripts, stylesheets };
  });

const injectProductionAssets = (
  html: string,
  assets: { readonly scripts: readonly string[]; readonly stylesheets: readonly string[] },
): Effect.Effect<string, StartPrerenderError> =>
  Effect.try({
    try: () => {
      let next = html;
      const hasProductionStylesheets =
        assets.stylesheets.length === 0 || assets.stylesheets.every((tag) => next.includes(tag));
      const devStylesheets = [...next.matchAll(devStylesheetPattern)];

      if (devStylesheets.length > 0) {
        let replacedFirstStylesheet = false;
        next = next.replace(devStylesheetPattern, () => {
          if (hasProductionStylesheets || replacedFirstStylesheet) {
            return "";
          }
          replacedFirstStylesheet = true;
          return assets.stylesheets.join("\n    ");
        });
      } else if (assets.stylesheets.length > 0 && !hasProductionStylesheets) {
        next = next.replace(
          /\n\s*<\/head>/,
          `\n    ${assets.stylesheets.join("\n    ")}\n  </head>`,
        );
      }

      const devModuleScripts = [...next.matchAll(devModuleScriptPattern)];
      if (devModuleScripts.length > 0) {
        let replacedFirstScript = false;
        return next.replace(devModuleScriptPattern, () => {
          if (replacedFirstScript) {
            return "";
          }
          replacedFirstScript = true;
          return assets.scripts.join("\n    ");
        });
      }

      if (/<\/body>/.test(next)) {
        return next.replace(/\n\s*<\/body>/, `\n    ${assets.scripts.join("\n    ")}\n  </body>`);
      }

      throw startPrerenderError(
        "prepare-html",
        "SSR HTML did not contain a dev module script or closing body tag for asset injection.",
      );
    },
    catch: (cause) =>
      cause instanceof StartPrerenderError
        ? cause
        : startPrerenderError("prepare-html", "Could not inject production assets.", { cause }),
  });

const createPrerenderServer = (
  root: string,
  configFile: string | false | undefined,
  mode: string | undefined,
  viteConfig: InlineConfig | undefined,
): Effect.Effect<StartPrerenderViteServer, StartPrerenderError> =>
  Effect.tryPromise({
    try: () => {
      const {
        configFile: viteBaseConfigFile,
        logLevel: viteLogLevel,
        mode: viteMode,
        server: viteServer,
        ...viteBaseConfig
      } = viteConfig ?? {};
      const selectedConfigFile = configFile ?? viteBaseConfigFile;
      const selectedMode = mode ?? viteMode;
      return createServer({
        ...viteBaseConfig,
        root,
        ...(selectedConfigFile === undefined ? {} : { configFile: selectedConfigFile }),
        ...(selectedMode === undefined ? {} : { mode: selectedMode }),
        appType: "custom",
        logLevel: viteLogLevel ?? "warn",
        server: {
          ...viteServer,
          hmr: false,
          middlewareMode: true,
          watch: null,
          ws: false,
        },
      } satisfies InlineConfig);
    },
    catch: startPrerenderHostError("create-server", "Could not create the Vite prerender server."),
  });

const closePrerenderServer = (
  server: StartPrerenderViteServer,
): Effect.Effect<void, StartPrerenderError> =>
  Effect.gen(function* () {
    const websocketExit = yield* closePrerenderServerHandle(
      server.ws.close.bind(server.ws),
      "Could not close the Vite prerender websocket server.",
    ).pipe(Effect.exit);
    const hotExit = yield* closePrerenderServerHandle(
      server.hot.close.bind(server.hot),
      "Could not close the Vite prerender hot channel.",
    ).pipe(Effect.exit);
    const serverExit = yield* closePrerenderServerHandle(
      server.close.bind(server),
      "Could not close the Vite prerender server.",
    ).pipe(Effect.exit);

    if (Exit.isFailure(websocketExit)) {
      return yield* Effect.failCause(websocketExit.cause);
    }
    if (Exit.isFailure(hotExit)) {
      return yield* Effect.failCause(hotExit.cause);
    }
    if (Exit.isFailure(serverExit)) {
      return yield* Effect.failCause(serverExit.cause);
    }
  });

const runWithPrerenderServer = <A, R>(
  server: StartPrerenderViteServer,
  effect: Effect.Effect<A, StartPrerenderError, R>,
): Effect.Effect<A, StartPrerenderError, R> =>
  Effect.gen(function* () {
    const useExit = yield* effect.pipe(Effect.exit);
    const closeExit = yield* closePrerenderServer(server).pipe(Effect.exit);

    if (Exit.isFailure(useExit)) {
      return yield* Effect.failCause(useExit.cause);
    }
    if (Exit.isFailure(closeExit)) {
      return yield* Effect.failCause(closeExit.cause);
    }
    return useExit.value;
  });

const sleepEffect = (milliseconds: number): Effect.Effect<void> =>
  milliseconds <= 0 ? Effect.void : Effect.sleep(`${milliseconds} millis`);

const renderPageAttempt = (
  server: StartViteDevServer,
  page: StartPrerenderPlannedPage,
  runOptions: StartPrerenderRunOptions,
  options: ResolvedStartPrerenderOptions,
): Effect.Effect<Response, StartPrerenderError> => {
  const request = new Request(new URL(page.path, options.origin).href, {
    headers: {
      accept: "text/html",
    },
  });
  const serverEntry = runOptions.serverEntry ?? defaultServerEntry;

  return Effect.gen(function* () {
    const module = yield* Effect.tryPromise({
      try: () => server.ssrLoadModule(serverEntry),
      catch: startPrerenderHostError(
        "render-page",
        `Could not load the prerender server entry ${serverEntry}.`,
        page.path,
      ),
    });
    const handler = yield* resolveStartHandlerEffect(
      module as StartSsrHandlerModule<unknown, unknown>,
      runOptions.handlerExport === undefined ? {} : { handlerExport: runOptions.handlerExport },
    ).pipe(
      Effect.mapError((cause) =>
        startPrerenderError("render-page", `Could not resolve the prerender handler.`, {
          path: page.path,
          cause,
        }),
      ),
    );
    const result = yield* Effect.try({
      try: () => (handler as StartSsrRequestHandler<unknown, unknown>)(request),
      catch: (cause) =>
        startPrerenderError("render-page", `Could not run the prerender handler.`, {
          path: page.path,
          cause,
        }),
    });
    const response = yield* responseWithScopeLifetimeEffect(
      toEffect(result as EffectInput<Response, unknown, Scope.Scope>),
    ).pipe(
      Effect.mapError((cause) =>
        startPrerenderError("render-page", `Could not prerender ${page.path}.`, {
          path: page.path,
          cause,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.fail(
          startPrerenderError("render-page", `Could not prerender ${page.path}.`, {
            path: page.path,
            cause: Cause.squash(cause),
          }),
        ),
      ),
    );

    if (response instanceof Response) {
      return response;
    }

    return yield* Effect.fail(
      startPrerenderError("render-page", "Prerender handlers must return a Response.", {
        path: page.path,
        cause: response,
      }),
    );
  });
};

const renderPageWithRetries = (
  server: StartViteDevServer,
  page: StartPrerenderPlannedPage,
  runOptions: StartPrerenderRunOptions,
  options: ResolvedStartPrerenderOptions,
): Effect.Effect<Response, StartPrerenderError> => {
  const attempt = (remainingRetries: number): Effect.Effect<Response, StartPrerenderError> =>
    renderPageAttempt(server, page, runOptions, options).pipe(
      Effect.catch((error) =>
        remainingRetries <= 0
          ? Effect.fail(error)
          : sleepEffect(options.retryDelay).pipe(
              Effect.flatMap(() => attempt(remainingRetries - 1)),
            ),
      ),
    );

  return attempt(options.retryCount);
};

const callSuccess = (
  options: ResolvedStartPrerenderOptions,
  event: StartPrerenderSuccessEvent,
): Effect.Effect<void, StartPrerenderError> =>
  Effect.try({
    try: () => options.onSuccess?.(event) as unknown,
    catch: (cause) =>
      startPrerenderError("callback", "Start prerender onSuccess callback failed.", {
        path: event.page.path,
        cause,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      isPromiseLikeValue(result)
        ? Effect.fail(
            startPrerenderError(
              "callback",
              "Start prerender onSuccess callback returned Promise-shaped work; wrap async host work in Effect.tryPromise(...) before prerendering.",
              { path: event.page.path, cause: result },
            ),
          )
        : toEffect(result as EffectInput<void, unknown, never>).pipe(
            Effect.mapError((cause) =>
              startPrerenderError("callback", "Start prerender onSuccess callback Effect failed.", {
                path: event.page.path,
                cause,
              }),
            ),
            Effect.catchDefect((defect) =>
              Effect.fail(
                startPrerenderError(
                  "callback",
                  defect instanceof EffectInputPromiseRejected
                    ? "Start prerender onSuccess callback returned Promise-shaped work; wrap async host work in Effect.tryPromise(...) before prerendering."
                    : "Start prerender onSuccess callback Effect defected.",
                  { path: event.page.path, cause: defect },
                ),
              ),
            ),
          ),
    ),
  );

const callError = (
  options: ResolvedStartPrerenderOptions,
  event: StartPrerenderFailureEvent,
): Effect.Effect<void, StartPrerenderError> =>
  Effect.try({
    try: () => options.onError?.(event) as unknown,
    catch: (cause) =>
      startPrerenderError("callback", "Start prerender onError callback failed.", {
        path: event.page.path,
        cause,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      isPromiseLikeValue(result)
        ? Effect.fail(
            startPrerenderError(
              "callback",
              "Start prerender onError callback returned Promise-shaped work; wrap async host work in Effect.tryPromise(...) before prerendering.",
              { path: event.page.path, cause: result },
            ),
          )
        : toEffect(result as EffectInput<void, unknown, never>).pipe(
            Effect.mapError((cause) =>
              startPrerenderError("callback", "Start prerender onError callback Effect failed.", {
                path: event.page.path,
                cause,
              }),
            ),
            Effect.catchDefect((defect) =>
              Effect.fail(
                startPrerenderError(
                  "callback",
                  defect instanceof EffectInputPromiseRejected
                    ? "Start prerender onError callback returned Promise-shaped work; wrap async host work in Effect.tryPromise(...) before prerendering."
                    : "Start prerender onError callback Effect defected.",
                  { path: event.page.path, cause: defect },
                ),
              ),
            ),
          ),
    ),
  );

/** Runs static prerendering as an Effect for Vite and test host adapters. */
export const runStartPrerenderEffect = (
  runOptions: StartPrerenderRunOptions,
): Effect.Effect<StartPrerenderResult, StartPrerenderError> =>
  Effect.gen(function* () {
    const options = resolveStartPrerenderOptions(runOptions.prerender);
    if (options === undefined) {
      return { pages: [], failures: [] };
    }

    const outDir = isAbsolute(runOptions.outDir)
      ? runOptions.outDir
      : resolve(runOptions.root, runOptions.outDir);
    const assets = yield* readBuiltAssetTags(outDir);
    const server = yield* createPrerenderServer(
      runOptions.root,
      runOptions.configFile,
      runOptions.mode,
      runOptions.vite,
    );
    return yield* runWithPrerenderServer(
      server,
      Effect.gen(function* () {
        const queue = [...planStartPrerenderPages(runOptions.manifest, runOptions.prerender)];
        const queued = new Set(queue.map((page) => page.path));
        const rendered = new Set<string>();
        const pages: StartPrerenderSuccessEvent[] = [];
        const failures: StartPrerenderFailureEvent[] = [];

        for (let index = 0; index < queue.length; index += 1) {
          const page = queue[index];
          if (page === undefined) {
            continue;
          }
          if (rendered.has(page.path)) {
            continue;
          }
          rendered.add(page.path);

          const renderOutcome = yield* renderPageWithRetries(
            server,
            page,
            runOptions,
            options,
          ).pipe(
            Effect.map((response) => ({ _tag: "Success" as const, response })),
            Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
          );
          if (renderOutcome._tag === "Failure") {
            const event = {
              page,
              error: renderOutcome.error,
              attempts: options.retryCount + 1,
            } satisfies StartPrerenderFailureEvent;
            failures.push(event);
            yield* callError(options, event);
            if (options.failOnError) {
              return yield* Effect.fail(renderOutcome.error);
            }
            continue;
          }

          if (renderOutcome.response.status < 200 || renderOutcome.response.status >= 300) {
            const error = startPrerenderError(
              "render-page",
              `Prerendering ${page.path} returned HTTP ${renderOutcome.response.status}.`,
              { path: page.path },
            );
            const event = {
              page,
              error,
              attempts: options.retryCount + 1,
            } satisfies StartPrerenderFailureEvent;
            failures.push(event);
            yield* callError(options, event);
            if (options.failOnError) {
              return yield* Effect.fail(error);
            }
            continue;
          }

          const rawHtml = yield* suspendResponseStreamSuccessFinalizerEffect(
            renderOutcome.response,
            Effect.tryPromise({
              try: () => renderOutcome.response.text(),
              catch: startPrerenderHostError(
                "render-page",
                `Could not read prerendered HTML for ${page.path}.`,
                page.path,
              ),
            }),
            {
              stream: {
                name: "response",
                state: "errored",
                chunkCount: 0,
              },
              status: "failure",
              failureKind: "transport",
              teardownReason: "prerender-read-error",
            },
          );
          const html = yield* injectProductionAssets(rawHtml, assets);
          const outputPath = outputPathForPage(page, options);
          const absoluteOutputPath = yield* resolveOutputPath(outDir, outputPath);
          yield* Effect.tryPromise({
            try: () => mkdir(dirname(absoluteOutputPath), { recursive: true }),
            catch: startPrerenderHostError(
              "create-directory",
              `Could not create ${relative(runOptions.root, dirname(absoluteOutputPath))}.`,
              page.path,
            ),
          });
          yield* Effect.tryPromise({
            try: () => writeFile(absoluteOutputPath, html),
            catch: startPrerenderHostError(
              "write-page",
              `Could not write ${relative(runOptions.root, absoluteOutputPath)}.`,
              page.path,
            ),
          });

          const event = {
            page,
            outputPath,
            status: renderOutcome.response.status,
          } satisfies StartPrerenderSuccessEvent;
          pages.push(event);
          yield* callSuccess(options, event);

          if (options.crawlLinks) {
            for (const link of extractStartStaticHtmlLinks(html, {
              origin: options.origin,
              fromPath: page.path,
            })) {
              if (queued.has(link)) {
                continue;
              }
              const crawled = { path: link, source: "crawl" as const };
              if (options.filter?.(crawled) === false) {
                continue;
              }
              queued.add(link);
              queue.push(crawled);
            }
          }
        }

        yield* Effect.sync(() => {
          if (pages.length > 0) {
            console.log(
              [
                `Start prerender wrote ${pages.length} pages.`,
                ...pages.map(
                  (page) => `- ${relative(runOptions.root, join(outDir, page.outputPath))}`,
                ),
              ].join("\n"),
            );
          }
        });

        return { pages, failures };
      }),
    );
  });
