import { readFileSync } from "node:fs";
import {
  Resource,
  createBrowserRouterHostController,
  makeRuntime,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  extractStartStaticHtmlLinks,
  hydrateFromDocumentEffect,
  startStaticPageOutputPath,
  streamHydrationAttribute,
  type StartHydrationChunk,
  type StartHydrationDocument,
} from "@sunfall/arc-start";
import {
  DocsContentApiStaticClient,
  makeRecipeSlug,
  RecipeBySlug,
  RecipeIndexRef,
} from "./content.js";
import {
  hrefById,
  hrefByPath,
  routeById,
  routeByPath,
  routes,
  type FileRouteHrefOptionsById,
} from "./routeTree.gen.js";
import { handleRequest, serverApp } from "./server.js";
import {
  normalizeDocsSiteBasePath,
  stripDocsSiteBasePath,
  withDocsSiteBasePath,
} from "./base-path.js";
import { docsSitePrerenderPages, docsSiteStartOptions } from "./start-options.js";
import { DocsContentApiLive } from "./content-live.js";
import { makeDocsSiteHistoryAdapter } from "./site-base.js";

const htmlJsonScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const visibleTextFromHtml = (html: string): string =>
  html
    .replace(htmlJsonScriptPattern, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const streamHydrationChunksFrom = (html: string): ReadonlyArray<StartHydrationChunk> =>
  Array.from(html.matchAll(htmlJsonScriptPattern))
    .filter((match) => match[1]?.includes(streamHydrationAttribute))
    .map((match) => JSON.parse(match[2] ?? "") as StartHydrationChunk);

const resourcePairs = (chunks: ReadonlyArray<StartHydrationChunk>): ReadonlySet<string> =>
  new Set(
    chunks.flatMap((chunk) =>
      chunk.payload.resources.map((resource) => JSON.stringify([resource.name, resource.key])),
    ),
  );

const expectedDocsSiteCrawlLinks = (): boolean =>
  normalizeDocsSiteBasePath(
    process.env.DOCS_SITE_BASE_PATH ?? process.env.VITE_DOCS_SITE_BASE_PATH ?? "/",
  ) === "/";

describe("docs site", () => {
  it("renders the home page with public-facing Arc copy", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          serverApp.runtime.provide(handleRequest(new Request("https://docs.test/"))),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const pairs = resourcePairs(streamHydrationChunksFrom(html));

        expect(response.status).toBe(200);
        expect(html).toContain("Built with Arc");
        expect(html).toContain("Sunfall Arc docs and cookbook.");
        expect(html).toContain("Capability-backed Resource");
        expect(html).not.toContain("Dogfooded");
        expect([...pairs]).toContain(
          JSON.stringify([RecipeIndexRef.family.options.name, RecipeIndexRef.key]),
        );
      }),
    ));

  it("renders the cookbook index through route-owned Resource preload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          serverApp.runtime.provide(handleRequest(new Request("https://docs.test/cookbook"))),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const pairs = resourcePairs(streamHydrationChunksFrom(html));

        expect(response.status).toBe(200);
        expect(response.headers.get("x-sunfall-arc-docs")).toBe("cookbook");
        expect(html).toContain('href="/src/styles.css"');
        expect(html).toContain("Working Sunfall Arc recipes");
        expect(html).toContain("Resource from a server function");
        expect(html).toContain("Progressive Start action form");
        expect([...pairs]).toContain(
          JSON.stringify([RecipeIndexRef.family.options.name, RecipeIndexRef.key]),
        );
      }),
    ));

  it("renders a recipe detail page and streams the recipe Resource", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const slug = makeRecipeSlug("semantic-invalidation");
        const ref = RecipeBySlug(slug);
        const response = yield* Effect.scoped(
          serverApp.runtime.provide(
            handleRequest(new Request("https://docs.test/cookbook/semantic-invalidation")),
          ),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const pairs = resourcePairs(streamHydrationChunksFrom(html));

        expect(response.status).toBe(200);
        expect(html).toContain("Semantic invalidation tags");
        expect(html).toContain("Tags describe domain concepts");
        expect(html).toContain('aria-label="On this page"');
        expect(html).toContain('href="#describe-domain-tags"');
        expect(html).toContain('id="invalidate-after-mutation"');
        expect(html).toContain("Related recipes");
        expect([...pairs]).toContain(
          JSON.stringify([RecipeIndexRef.family.options.name, RecipeIndexRef.key]),
        );
        expect([...pairs]).toContain(JSON.stringify([ref.family.options.name, ref.key]));
      }),
    ));

  it("renders the introductory blog post with preloaded docs navigation", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          serverApp.runtime.provide(
            handleRequest(new Request("https://docs.test/blog/introducing-sunfall-arc")),
          ),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const visibleText = visibleTextFromHtml(html);
        const pairs = resourcePairs(streamHydrationChunksFrom(html));

        expect(response.status).toBe(200);
        expect(html).toContain("Correctness by construction for agent-operated TypeScript apps.");
        expect(html).toContain("What conventional stacks would do");
        expect(html).toContain('href="#what-conventional-stacks-would-do"');
        expect(html).toContain("In Arc, a definition is a named typed declaration");
        expect(html).toContain("Effect gives Arc dependency injection and testability");
        expect(html).toContain('href="#effect-gives-arc-dependency-injection-and-testability"');
        expect(html).toContain("What Arc replaces");
        expect(html).toContain('href="#what-arc-replaces"');
        expect(html).toContain("The hero slice: route, resource, action, graph");
        expect(html).toContain('href="#the-hero-slice-route-resource-action-graph"');
        expect(html).toContain("The running demo is an issue tracker");
        expect(visibleText).toContain("export const IssueId");
        expect(visibleText).toContain("const IssueApiTest = IssueApi.layer");
        expect(html).toContain("Built by an agent, verified in public");
        expect(html).toContain("For durable app behavior");
        expect(html).toContain('class="shiki github-dark-default"');
        expect(html).toContain('data-language="Shell"');
        expect(visibleText).toContain("queryClient.invalidateQueries");
        expect(visibleText).toContain("const useIssueStore = create");
        expect(visibleText).toContain("sunfall-arc-start graph route /issues/:id");
        expect(html).toContain("Resource from a server function");
        expect([...pairs]).toContain(
          JSON.stringify([RecipeIndexRef.family.options.name, RecipeIndexRef.key]),
        );
      }),
    ));

  it("renders public docs overview and concept pages", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const overviewResponse = yield* Effect.scoped(
          serverApp.runtime.provide(handleRequest(new Request("https://docs.test/docs"))),
        );
        const overviewHtml = yield* Effect.tryPromise(() => overviewResponse.text());
        const gettingStartedResponse = yield* Effect.scoped(
          serverApp.runtime.provide(
            handleRequest(new Request("https://docs.test/docs/getting-started")),
          ),
        );
        const gettingStartedHtml = yield* Effect.tryPromise(() => gettingStartedResponse.text());
        const gettingStartedText = visibleTextFromHtml(gettingStartedHtml);
        const referenceResponse = yield* Effect.scoped(
          serverApp.runtime.provide(handleRequest(new Request("https://docs.test/docs/reference"))),
        );
        const referenceHtml = yield* Effect.tryPromise(() => referenceResponse.text());

        expect(overviewResponse.status).toBe(200);
        expect(overviewHtml).toContain("Docs for agent-operated TypeScript apps.");
        expect(overviewHtml).toContain("Getting started");
        expect(overviewHtml).toContain("Troubleshooting");
        expect(gettingStartedResponse.status).toBe(200);
        expect(gettingStartedHtml).toContain("Install the alpha packages");
        expect(gettingStartedHtml).toContain('href="#install-the-core-packages"');
        expect(gettingStartedHtml).toContain('id="run-a-checked-starter"');
        expect(gettingStartedHtml).toContain('class="shiki github-dark-default"');
        expect(gettingStartedText).toContain(
          "pnpm add @sunfall/arc-core @sunfall/arc-start @sunfall/arc-solid effect solid-js",
        );
        expect(gettingStartedHtml).toContain("Use the project console example");
        expect(referenceResponse.status).toBe(200);
        expect(referenceHtml).toMatch(/<code[^>]*class="inlineCode"[^>]*>@sunfall\/arc-core/);
        expect(referenceHtml).toMatch(/<code[^>]*class="inlineCode"[^>]*>@sunfall\/arc-react/);
      }),
    ));

  it("pins the generated docs route artifact", () => {
    const blogHrefOptions: FileRouteHrefOptionsById["route_blog_introducing_sunfall_arc"] = {};
    const cookbookHrefOptions: FileRouteHrefOptionsById["route_cookbook"] = {};
    const docsHrefOptions: FileRouteHrefOptionsById["route_docs"] = {};
    const docsPageHrefOptions: FileRouteHrefOptionsById["route_docs_$slug"] = {
      params: { slug: "getting-started" },
    };
    const recipeHrefOptions: FileRouteHrefOptionsById["route_cookbook_$slug"] = {
      params: { slug: makeRecipeSlug("resource-from-server-function") },
    };
    const source = readFileSync(new URL("./routeTree.gen.ts", import.meta.url), "utf8");

    expect(source).toContain("// This file is generated by @sunfall/arc-start. Do not edit.");
    expect(routes).toEqual([
      routeById.route_root,
      routeById.route_blog_introducing_sunfall_arc,
      routeById.route_cookbook,
      routeById.route_cookbook_$slug,
      routeById.route_docs,
      routeById.route_docs_$slug,
    ]);
    expect(routeByPath["/blog/introducing-sunfall-arc"]).toBe(
      routeById.route_blog_introducing_sunfall_arc,
    );
    expect(routeByPath["/cookbook/:slug"]).toBe(routeById.route_cookbook_$slug);
    expect(routeByPath["/docs"]).toBe(routeById.route_docs);
    expect(routeByPath["/docs/:slug"]).toBe(routeById.route_docs_$slug);
    expect(blogHrefOptions).toEqual({});
    expect(cookbookHrefOptions).toEqual({});
    expect(docsHrefOptions).toEqual({});
    expect(docsPageHrefOptions.params.slug).toBe("getting-started");
    expect(recipeHrefOptions.params.slug).toBe("resource-from-server-function");
    expect(hrefById("route_blog_introducing_sunfall_arc")).toBe("/blog/introducing-sunfall-arc");
    expect(hrefById("route_cookbook")).toBe("/cookbook");
    expect(hrefById("route_docs")).toBe("/docs");
    expect(hrefById("route_docs_$slug", docsPageHrefOptions)).toBe("/docs/getting-started");
    expect(hrefByPath("/blog/introducing-sunfall-arc", blogHrefOptions)).toBe(
      "/blog/introducing-sunfall-arc",
    );
    expect(hrefByPath("/docs/:slug", docsPageHrefOptions)).toBe("/docs/getting-started");
    expect(hrefByPath("/cookbook/:slug", recipeHrefOptions)).toBe(
      "/cookbook/resource-from-server-function",
    );
  });

  it("uses Start prerender as the docs static output contract", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          serverApp.runtime.provide(
            handleRequest(new Request("https://docs.test/cookbook/resource-from-server-function")),
          ),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const links = extractStartStaticHtmlLinks(html, {
          origin: "https://docs.test",
          fromPath: "/cookbook/resource-from-server-function",
        });
        const prerender = docsSiteStartOptions.prerender;

        expect(prerender).toMatchObject({
          enabled: true,
          autoSubfolderIndex: true,
          autoStaticPathsDiscovery: true,
          crawlLinks: expectedDocsSiteCrawlLinks(),
          failOnError: true,
        });
        expect(docsSitePrerenderPages).toEqual(
          expect.arrayContaining([
            "/docs/getting-started",
            "/docs/troubleshooting",
            "/cookbook/resource-from-server-function",
            "/cookbook/route-preload-hydration",
          ]),
        );
        expect(response.status).toBe(200);
        expect(html).toContain("Resource from a server function");
        expect(links).toEqual(
          expect.arrayContaining([
            "/",
            "/blog/introducing-sunfall-arc",
            "/cookbook",
            "/docs",
            "/docs/getting-started",
            "/docs/troubleshooting",
            "/cookbook/route-preload-hydration",
            "/cookbook/capability-mocks",
          ]),
        );
        expect(
          startStaticPageOutputPath("/cookbook/resource-from-server-function", {
            autoSubfolderIndex: prerender.autoSubfolderIndex,
          }),
        ).toBe("cookbook/resource-from-server-function/index.html");
      }),
    ));

  it("maps typed route hrefs to the GitHub Pages project base path", () => {
    const basePath = "/project-docs/";

    expect(normalizeDocsSiteBasePath("project-docs")).toBe(basePath);
    expect(normalizeDocsSiteBasePath("/project-docs")).toBe(basePath);
    expect(withDocsSiteBasePath("/", basePath)).toBe(basePath);
    expect(withDocsSiteBasePath("/docs/getting-started", basePath)).toBe(
      "/project-docs/docs/getting-started",
    );
    expect(stripDocsSiteBasePath("/project-docs/docs/getting-started?tab=install", basePath)).toBe(
      "/docs/getting-started?tab=install",
    );
  });

  it("hydrates static recipe documents before browser route preload needs recipe data", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const slug = makeRecipeSlug("resource-from-server-function");
          const response = yield* Effect.scoped(
            serverApp.runtime.provide(
              handleRequest(
                new Request("https://docs.test/cookbook/resource-from-server-function"),
              ),
            ),
          );
          const html = yield* Effect.tryPromise(() => response.text());
          const window = new Window({ url: "https://docs.test/cookbook" });
          const fetch = vi.fn(
            async (_input: RequestInfo | URL) => new Response(html, { status: 200 }),
          );
          const runtime = makeRuntime(DocsContentApiLive);
          yield* Effect.addFinalizer(() =>
            runtime.disposeEffect.pipe(Effect.catchCause(() => Effect.void)),
          );

          vi.stubGlobal("window", window);
          vi.stubGlobal("document", window.document);
          vi.stubGlobal("DOMParser", window.DOMParser);
          vi.stubGlobal("fetch", fetch);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              vi.unstubAllGlobals();
            }),
          );

          const history = makeDocsSiteHistoryAdapter({ runtime, routes });
          yield* history.prepareHrefEffect!("/cookbook/resource-from-server-function");
          const recipe = yield* runtime.provide(Resource.prefetchEffect(RecipeBySlug(slug)));

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(String(fetch.mock.calls[0]?.[0])).toBe(
            "https://docs.test/cookbook/resource-from-server-function",
          );
          expect(recipe.title).toBe("Resource from a server function");
        }),
      ),
    ));

  it("uses static page hydration for recipe-to-recipe router navigation without production RPC", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const slug = makeRecipeSlug("resource-from-server-function");
          const targetHref = "/cookbook/resource-from-server-function";
          const currentHref = "/cookbook/semantic-invalidation";
          const currentResponse = yield* Effect.scoped(
            serverApp.runtime.provide(
              handleRequest(new Request(`https://docs.test${currentHref}`)),
            ),
          );
          const currentHtml = yield* Effect.tryPromise(() => currentResponse.text());
          const recipeResponse = yield* Effect.scoped(
            serverApp.runtime.provide(handleRequest(new Request(`https://docs.test${targetHref}`))),
          );
          const recipeHtml = yield* Effect.tryPromise(() => recipeResponse.text());
          const window = new Window({ url: `https://docs.test${currentHref}` });
          window.document.write(currentHtml);
          window.document.close();
          const fetch = vi.fn(
            async (_input: RequestInfo | URL) => new Response(recipeHtml, { status: 200 }),
          );
          const runtime = makeRuntime(DocsContentApiLive);
          yield* Effect.addFinalizer(() =>
            runtime.disposeEffect.pipe(Effect.catchCause(() => Effect.void)),
          );

          vi.stubGlobal("window", window);
          vi.stubGlobal("document", window.document);
          vi.stubGlobal("DOMParser", window.DOMParser);
          vi.stubGlobal("fetch", fetch);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              vi.unstubAllGlobals();
            }),
          );

          const routerRuntime = runtime as unknown as AnySunfallArcRuntime;
          const history = makeDocsSiteHistoryAdapter({ runtime: routerRuntime, routes });
          const router = createBrowserRouterHostController(routes, {
            history,
            initialHref: currentHref,
            runtime: routerRuntime,
          });
          yield* Effect.addFinalizer(() =>
            router.disposeEffect().pipe(Effect.catchCause(() => Effect.void)),
          );

          router.navigateHref(targetHref);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({ _tag: "Ready", href: targetHref }),
            ),
          );
          const recipe = yield* runtime.provide(Resource.prefetchEffect(RecipeBySlug(slug)));

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(String(fetch.mock.calls[0]?.[0])).toBe(
            "https://docs.test/cookbook/resource-from-server-function",
          );
          expect(window.location.pathname).toBe(targetHref);
          expect(recipe.title).toBe("Resource from a server function");
        }),
      ),
    ));

  it("uses static page hydration for cookbook index-to-recipe router navigation without production RPC", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const slug = makeRecipeSlug("resource-from-server-function");
          const targetHref = "/cookbook/resource-from-server-function";
          const currentHref = "/cookbook";
          const currentResponse = yield* Effect.scoped(
            serverApp.runtime.provide(
              handleRequest(new Request(`https://docs.test${currentHref}`)),
            ),
          );
          const currentHtml = yield* Effect.tryPromise(() => currentResponse.text());
          const recipeResponse = yield* Effect.scoped(
            serverApp.runtime.provide(handleRequest(new Request(`https://docs.test${targetHref}`))),
          );
          const recipeHtml = yield* Effect.tryPromise(() => recipeResponse.text());
          const window = new Window({ url: `https://docs.test${currentHref}` });
          window.document.write(currentHtml);
          window.document.close();
          const fetch = vi.fn(
            async (_input: RequestInfo | URL) => new Response(recipeHtml, { status: 200 }),
          );
          const runtime = makeRuntime(DocsContentApiStaticClient);
          yield* Effect.addFinalizer(() =>
            runtime.disposeEffect.pipe(Effect.catchCause(() => Effect.void)),
          );

          vi.stubGlobal("window", window);
          vi.stubGlobal("document", window.document);
          vi.stubGlobal("DOMParser", window.DOMParser);
          vi.stubGlobal("fetch", fetch);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              vi.unstubAllGlobals();
            }),
          );

          yield* runtime.provide(
            hydrateFromDocumentEffect(window.document as unknown as StartHydrationDocument),
          );

          const routerRuntime = runtime as unknown as AnySunfallArcRuntime;
          const history = makeDocsSiteHistoryAdapter({ runtime: routerRuntime, routes });
          const router = createBrowserRouterHostController(routes, {
            history,
            initialHref: currentHref,
            runtime: routerRuntime,
          });
          yield* Effect.addFinalizer(() =>
            router.disposeEffect().pipe(Effect.catchCause(() => Effect.void)),
          );

          router.navigateHref(targetHref);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(router.state.get()).toMatchObject({ _tag: "Ready", href: targetHref }),
            ),
          );
          const recipe = yield* runtime.provide(Resource.prefetchEffect(RecipeBySlug(slug)));

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(String(fetch.mock.calls[0]?.[0])).toBe(
            "https://docs.test/cookbook/resource-from-server-function",
          );
          expect(window.location.pathname).toBe(targetHref);
          expect(recipe.title).toBe("Resource from a server function");
        }),
      ),
    ));

  it("keeps internal docs navigation on router-owned typed links", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const historySource = readFileSync(new URL("./site-base.ts", import.meta.url), "utf8");
    const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

    expect(source).toContain("RouterLink");
    expect(source).not.toMatch(/href={docsSiteHref\(Route\.href/);
    expect(historySource).toContain("docsSiteHref");
    expect(historySource).toContain("makeStartStaticHistoryAdapter");
    expect(historySource).toContain("basePath: docsSiteBasePath");
    expect(historySource).not.toContain("hydrateFromDocumentEffect");
    expect(historySource).not.toContain('"Docs.recipe"');
    expect(mainSource).toContain("import.meta.env.DEV");
    expect(mainSource).toContain("BrowserRpcLive");
    expect(mainSource).toContain("DocsContentApiStaticClient");
    expect(mainSource).toContain('await import("./content-live.js")');
    expect(mainSource).toContain("hydratedHref={hydratedHref}");
    expect(mainSource).toContain('import { hydrate, render } from "solid-js/web";');
    expect(mainSource).toContain("hydrate(Root, root)");
    expect(mainSource).not.toContain("root.textContent =");
  });
});
