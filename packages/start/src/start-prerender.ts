import { Cause, Console, Data, Duration, Effect, Schedule, type Scope } from "effect";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  type EffectInput,
} from "@sunfall/arc-core";
import { invokeEffectInput } from "@sunfall/arc-core/internal";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createServer, type InlineConfig, type ViteDevServer } from "vite";
import type { FileRouteManifest } from "./file-routes.js";
import { resolveStartHandler, type StartSsrHandlerModule } from "./start-vite-dev-ssr.js";
import { defaultServerEntry } from "./start-manifest-wall.js";
import {
  extractStartStaticHtmlLinks,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
} from "./static-export.js";

/** Explicit page entry added to the static prerender plan. */
export interface StartPrerenderPage {
  /** Root-relative page path to prerender. */
  readonly path: string;
  /** HTML output path relative to the build output directory. */
  readonly outputPath?: string;
  /** Set to `false` to drop this page from the plan, including discovered routes. Defaults to true. */
  readonly prerender?: boolean;
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

/** `true` for defaults, an option object to customize, or `false` to disable Start prerendering. */
export type StartPrerenderConfig = boolean | StartPrerenderOptions;

/** Runtime input for executing the Start prerender Effect. */
export interface StartPrerenderRunOptions {
  readonly root: string;
  readonly outDir: string;
  readonly manifest: FileRouteManifest;
  readonly prerender: StartPrerenderConfig;
  /** Vite `base`; prefixes the built asset URLs. Defaults to `/`. */
  readonly base?: string;
  /** Vite build manifest path relative to `outDir`. Defaults to `.vite/manifest.json`. */
  readonly buildManifest?: string;
  /** Inline Vite config used by the temporary prerender SSR server. */
  readonly vite?: InlineConfig;
  readonly serverEntry?: string;
  readonly handlerExport?: string;
  readonly configFile?: string | false;
  readonly mode?: string;
}

/** Summary returned by `runStartPrerender(...)`. */
export interface StartPrerenderResult {
  readonly pages: readonly StartPrerenderSuccessEvent[];
  readonly failures: readonly StartPrerenderFailureEvent[];
}

/** Typed failure reported by Start prerender planning, rendering, writing, and callbacks. */
export class StartPrerenderError extends Data.TaggedError("StartPrerenderError")<{
  readonly operation:
    | "read-assets"
    | "create-server"
    | "render-page"
    | "prepare-html"
    | "write-page"
    | "callback";
  readonly message: string;
  readonly path?: string | undefined;
  readonly cause?: unknown;
}> {}

type ResolvedStartPrerenderOptions = Required<
  Omit<StartPrerenderOptions, "filter" | "onSuccess" | "onError">
> &
  Pick<StartPrerenderOptions, "filter" | "onSuccess" | "onError">;

interface StartPrerenderPlannedPage extends StartPrerenderPageContext {
  readonly outputPath?: string;
}

const prerenderError = (
  operation: StartPrerenderError["operation"],
  message: string,
  options: { readonly path?: string | undefined; readonly cause?: unknown } = {},
): StartPrerenderError => new StartPrerenderError({ operation, message, ...options });

const nonNegativeInteger = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) || value < 0 ? 0 : Math.floor(value);

/** Resolves boolean or partial prerender config into defaulted options. */
export const resolveStartPrerenderOptions = (
  config: StartPrerenderConfig | undefined,
): ResolvedStartPrerenderOptions | undefined => {
  if (config === undefined || config === false) {
    return undefined;
  }
  const options = config === true ? {} : config;
  return {
    ...options,
    origin: options.origin ?? "https://sunfall-arc.static",
    autoSubfolderIndex: options.autoSubfolderIndex ?? true,
    autoStaticPathsDiscovery: options.autoStaticPathsDiscovery ?? true,
    crawlLinks: options.crawlLinks ?? true,
    pages: options.pages ?? [],
    retryCount: nonNegativeInteger(options.retryCount),
    retryDelay: nonNegativeInteger(options.retryDelay),
    failOnError: options.failOnError ?? true,
  };
};

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
    if (!disabled.has(page.path) && options.filter?.(page) !== false) {
      pages.set(page.path, page);
    }
  };

  if (options.autoStaticPathsDiscovery) {
    for (const entry of manifest.entries) {
      if (entry.params.length === 0) {
        addPage({ path: normalizeStartStaticPath(entry.routePath), source: "static-route" });
      }
    }
  } else {
    addPage({ path: "/", source: "root" });
  }

  for (const input of options.pages) {
    const page = typeof input === "string" ? { path: input } : input;
    const path = normalizeStartStaticPath(page.path);
    if (page.prerender === false) {
      disabled.add(path);
      pages.delete(path);
      continue;
    }
    addPage({
      path,
      source: "page",
      ...(page.outputPath === undefined ? {} : { outputPath: page.outputPath }),
    });
  }

  return [...pages.values()];
};

/** The parts of Vite's build manifest (`build.manifest`) that prerendering reads. */
interface ViteManifestChunk {
  readonly file: string;
  readonly isEntry?: boolean;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
}

type ViteManifest = Readonly<Record<string, ViteManifestChunk>>;

const devStylesheetPattern =
  /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="\/(?:src|@fs)\/[^"]+\.css(?:\?[^"]*)?")[^>]*>\s*/g;
const devModuleScriptPattern =
  /<script\b(?=[^>]*\btype="module")[^>]*\bsrc="\/((?:src|@fs)\/[^"]+)"[^>]*><\/script>/g;

const manifestCss = (manifest: ViteManifest, key: string, seen = new Set<string>()): string[] => {
  const chunk = manifest[key];
  if (chunk === undefined || seen.has(key)) {
    return [];
  }
  seen.add(key);
  return [
    ...(chunk.imports ?? []).flatMap((imported) => manifestCss(manifest, imported, seen)),
    ...(chunk.css ?? []),
  ];
};

/**
 * Swaps the dev entry script and dev stylesheets the SSR handler renders under
 * the temporary Vite server for the built entry chunk and its CSS.
 */
const injectProductionAssets = (
  html: string,
  manifest: ViteManifest,
  base: string,
  path: string,
): Effect.Effect<string, StartPrerenderError> =>
  Effect.suspend(() => {
    const devEntry = [...html.matchAll(devModuleScriptPattern)][0]?.[1];
    const entryKey = [devEntry, "index.html"].find(
      (key) => key !== undefined && manifest[key] !== undefined,
    );
    const key = entryKey ?? Object.keys(manifest).find((name) => manifest[name]?.isEntry);
    if (key === undefined || (devEntry === undefined && !html.includes("</body>"))) {
      return Effect.fail(
        prerenderError(
          "prepare-html",
          "Could not match the rendered page to a Vite build manifest entry.",
          { path },
        ),
      );
    }
    const stylesheets = [...new Set(manifestCss(manifest, key))]
      .map((file) => `<link rel="stylesheet" crossorigin href="${base}${file}">`)
      .join("");
    const script = `<script type="module" crossorigin src="${base}${manifest[key]!.file}"></script>`;
    const withStyles = html
      .replace(devStylesheetPattern, "")
      .replace("</head>", `${stylesheets}</head>`);
    let replaced = false;
    const withScript = withStyles.replace(devModuleScriptPattern, () =>
      replaced ? "" : ((replaced = true), script),
    );
    return Effect.succeed(
      replaced ? withScript : withScript.replace("</body>", `${script}</body>`),
    );
  });

const readBuildManifest = (file: string): Effect.Effect<ViteManifest, StartPrerenderError> =>
  Effect.tryPromise({
    try: () => readFile(file, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((text) => Effect.try(() => JSON.parse(text) as ViteManifest)),
    Effect.mapError((cause) =>
      prerenderError("read-assets", `Could not read the Vite build manifest at ${file}.`, {
        cause,
      }),
    ),
  );

const acquirePrerenderServer = (
  runOptions: StartPrerenderRunOptions,
): Effect.Effect<ViteDevServer, StartPrerenderError, Scope.Scope> => {
  const { configFile, logLevel, mode, server, ...viteConfig } = runOptions.vite ?? {};
  const selectedConfigFile = runOptions.configFile ?? configFile;
  const selectedMode = runOptions.mode ?? mode;
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        createServer({
          ...viteConfig,
          root: runOptions.root,
          ...(selectedConfigFile === undefined ? {} : { configFile: selectedConfigFile }),
          ...(selectedMode === undefined ? {} : { mode: selectedMode }),
          appType: "custom",
          logLevel: logLevel ?? "warn",
          server: { ...server, hmr: false, middlewareMode: true, watch: null, ws: false },
        }),
      catch: (cause) =>
        prerenderError("create-server", "Could not create the Vite prerender server.", { cause }),
    }),
    (vite) =>
      Effect.tryPromise(() => vite.close()).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not close the Vite prerender server.", cause),
        ),
      ),
  );
};

/** Calls the app's SSR handler in-process through the Vite server and reads the page HTML. */
const renderPage = (
  server: ViteDevServer,
  page: StartPrerenderPlannedPage,
  runOptions: StartPrerenderRunOptions,
  options: ResolvedStartPrerenderOptions,
): Effect.Effect<{ readonly status: number; readonly html: string }, StartPrerenderError> => {
  const serverEntry = runOptions.serverEntry ?? defaultServerEntry;
  const fail = (message: string, cause?: unknown) =>
    prerenderError("render-page", message, { path: page.path, cause });
  return Effect.scoped(
    Effect.gen(function* () {
      const module = yield* Effect.tryPromise({
        try: () => server.ssrLoadModule(serverEntry),
        catch: (cause) => fail(`Could not load the prerender server entry ${serverEntry}.`, cause),
      });
      const handler = (yield* resolveStartHandler(
        module as StartSsrHandlerModule<unknown, unknown>,
        runOptions.handlerExport === undefined ? {} : { handlerExport: runOptions.handlerExport },
      )) as unknown as (request: Request) => EffectInput<unknown, unknown, Scope.Scope>;
      const request = new Request(new URL(page.path, options.origin).href, {
        headers: { accept: "text/html" },
      });
      const response: unknown = yield* invokeEffectInput("Start prerender", handler, request);
      if (!(response instanceof Response)) {
        return yield* Effect.fail(fail("Prerender handlers must return a Response.", response));
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          fail(`Prerendering ${page.path} returned HTTP ${response.status}.`),
        );
      }
      return { status: response.status, html: yield* Effect.tryPromise(() => response.text()) };
    }),
  ).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      return Effect.fail(
        error instanceof StartPrerenderError
          ? error
          : fail(`Could not prerender ${page.path}.`, error),
      );
    }),
    Effect.retry({
      times: options.retryCount,
      schedule: Schedule.spaced(Duration.millis(options.retryDelay)),
    }),
  );
};

const callbackFailure = (error: unknown): string =>
  !(error instanceof EffectInputCallbackError)
    ? "Effect failed."
    : error.cause instanceof EffectInputPromiseRejected
      ? "returned Promise-shaped work; wrap async host work in Effect.tryPromise(...) before prerendering."
      : "failed.";

const runCallback = <Event extends { readonly page: StartPrerenderPageContext }>(
  name: "onSuccess" | "onError",
  callback: ((event: Event) => EffectInput<void, unknown, never>) | undefined,
  event: Event,
): Effect.Effect<void, StartPrerenderError> =>
  callback === undefined
    ? Effect.void
    : invokeEffectInput(`Start prerender ${name}`, callback, event).pipe(
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);
          return Effect.fail(
            prerenderError(
              "callback",
              `Start prerender ${name} callback ${callbackFailure(error)}`,
              {
                path: event.page.path,
                cause: error,
              },
            ),
          );
        }),
      );

const writePage = (
  outDir: string,
  outputPath: string,
  html: string,
  path: string,
): Effect.Effect<void, StartPrerenderError> => {
  const target = resolve(outDir, outputPath);
  const relativeTarget = relative(outDir, target);
  if (relativeTarget === "" || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    return Effect.fail(
      prerenderError(
        "write-page",
        `Refusing to write prerendered HTML outside the build output directory: ${outputPath}`,
        { path },
      ),
    );
  }
  const catchWrite = (cause: unknown) =>
    prerenderError("write-page", `Could not write ${outputPath}.`, { path, cause });
  return Effect.tryPromise({
    try: () => mkdir(dirname(target), { recursive: true }),
    catch: catchWrite,
  }).pipe(
    Effect.andThen(Effect.tryPromise({ try: () => writeFile(target, html), catch: catchWrite })),
  );
};

/** Runs static prerendering as an Effect for the Vite build hook and tests. */
export const runStartPrerender = (
  runOptions: StartPrerenderRunOptions,
): Effect.Effect<StartPrerenderResult, StartPrerenderError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const options = resolveStartPrerenderOptions(runOptions.prerender);
      if (options === undefined) {
        return { pages: [], failures: [] };
      }

      const outDir = resolve(runOptions.root, runOptions.outDir);
      const buildManifest = yield* readBuildManifest(
        resolve(outDir, runOptions.buildManifest ?? ".vite/manifest.json"),
      );
      const server = yield* acquirePrerenderServer(runOptions);
      const queue = [...planStartPrerenderPages(runOptions.manifest, runOptions.prerender)];
      const queued = new Set(queue.map((page) => page.path));
      const pages: StartPrerenderSuccessEvent[] = [];
      const failures: StartPrerenderFailureEvent[] = [];

      // The queue grows while crawling, so iterate by index.
      for (let index = 0; index < queue.length; index += 1) {
        const page = queue[index]!;
        const rendered = yield* renderPage(server, page, runOptions, options).pipe(
          Effect.flatMap(({ status, html }) =>
            Effect.map(
              injectProductionAssets(html, buildManifest, runOptions.base ?? "/", page.path),
              (prepared) => ({ status, html: prepared }),
            ),
          ),
          Effect.result,
        );
        if (rendered._tag === "Failure") {
          const event = { page, error: rendered.failure, attempts: options.retryCount + 1 };
          failures.push(event);
          yield* runCallback("onError", options.onError, event);
          if (options.failOnError) {
            return yield* Effect.fail(rendered.failure);
          }
          continue;
        }

        const { status, html } = rendered.success;
        const outputPath =
          page.outputPath?.replace(/^\/+/, "") ??
          startStaticPageOutputPath(page.path, { autoSubfolderIndex: options.autoSubfolderIndex });
        yield* writePage(outDir, outputPath, html, page.path);
        const event = { page, outputPath, status };
        pages.push(event);
        yield* runCallback("onSuccess", options.onSuccess, event);

        if (options.crawlLinks) {
          for (const link of extractStartStaticHtmlLinks(html, {
            origin: options.origin,
            fromPath: page.path,
          })) {
            const crawled = { path: link, source: "crawl" as const };
            if (!queued.has(link) && options.filter?.(crawled) !== false) {
              queued.add(link);
              queue.push(crawled);
            }
          }
        }
      }

      if (pages.length > 0) {
        yield* Console.log(
          [
            `Start prerender wrote ${pages.length} pages.`,
            ...pages.map((page) => `- ${relative(runOptions.root, join(outDir, page.outputPath))}`),
          ].join("\n"),
        );
      }
      return { pages, failures };
    }),
  );
