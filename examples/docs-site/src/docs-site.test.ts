import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  extractStartStaticHtmlLinks,
  startStaticPageOutputPath,
  streamHydrationAttribute,
  type StartHydrationChunk,
} from "@sunfall/arc-start";
import { makeRecipeSlug, RecipeBySlug, RecipeIndexRef } from "./content.js";
import {
  hrefById,
  hrefByPath,
  routeById,
  routeByPath,
  routes,
  type FileRouteHrefOptionsById,
} from "./routeTree.gen.js";
import { handleRequest, serverApp } from "./server.js";
import { docsSiteStartOptions } from "./start-options.js";

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

describe("docs site", () => {
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
        expect(html).toContain("Idiomatic Sunfall Arc examples");
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
        expect(html).toContain("Tags describe domain facts");
        expect(html).toContain('aria-label="On this page"');
        expect(html).toContain('href="#describe-domain-facts"');
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
        expect(html).toContain("One typed graph for your full-stack TypeScript app.");
        expect(html).toContain("What TanStack Query would do");
        expect(html).toContain('href="#what-tanstack-query-would-do"');
        expect(html).toContain("What React, Solid, Zustand, and Jotai would do");
        expect(html).toContain('href="#what-arc-gives-you-instead"');
        expect(html).toContain("A guided slice: route, resource, and UI");
        expect(html).toContain("Arc is meant to replace Zustand and Jotai for domain state");
        expect(html).toContain('class="shiki github-dark-default"');
        expect(html).toContain('data-language="Shell"');
        expect(visibleText).toContain("queryClient.invalidateQueries");
        expect(visibleText).toContain("const useProjectStore = create");
        expect(visibleText).toContain("sunfall-arc-start graph route /projects/:id");
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
        expect(overviewHtml).toContain("Public alpha docs for the typed app graph.");
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
          crawlLinks: true,
          failOnError: true,
        });
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

  it("keeps internal docs navigation on native typed anchors", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toMatch(/<a\s+href={Route\.href/);
    expect(source).not.toContain("RouterLink");
  });
});
