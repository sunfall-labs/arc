import {
  extractStartStaticHtmlLinks,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
} from "@effect-ui/start";
import { Effect } from "effect";
import { docsSiteRecipeHref } from "./App.js";
import { listRecipeSummariesServer } from "./content.server.js";
import { handleRequest, serverApp } from "./server.js";

export interface DocsSiteStaticRenderedPage {
  readonly path: string;
  readonly status: number;
  readonly html: string;
}

export const docsSiteStaticOrigin = "https://docs.effect-ui.local";

export const docsSiteStaticSeedPathsEffect: Effect.Effect<readonly string[], unknown> = Effect.gen(
  function* () {
    const recipes = yield* listRecipeSummariesServer.local("all");
    return ["/", "/cookbook", ...recipes.map((recipe) => docsSiteRecipeHref(recipe.slug))] as const;
  },
);

export const renderDocsSiteStaticPageEffect = (
  path: string,
): Effect.Effect<DocsSiteStaticRenderedPage, unknown> => {
  const normalizedPath = normalizeStartStaticPath(path);
  const request = new Request(new URL(normalizedPath, docsSiteStaticOrigin).href);

  return Effect.gen(function* () {
    const response = yield* Effect.scoped(serverApp.runtime.provide(handleRequest(request)));
    const html = yield* Effect.tryPromise(() => response.text());
    return {
      path: normalizedPath,
      status: response.status,
      html,
    };
  });
};

export const docsSiteStaticLinks = (html: string, fromPath: string): readonly string[] =>
  extractStartStaticHtmlLinks(html, {
    origin: docsSiteStaticOrigin,
    fromPath,
  });

export const docsSiteStaticOutputPath = (path: string): string =>
  startStaticPageOutputPath(path, { autoSubfolderIndex: true });
