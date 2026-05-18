import type { BrowserHistoryAdapter, Route } from "@sunfall/arc-core";
import {
  currentStartStaticHref,
  makeStartStaticHistoryAdapter,
  type StartStaticHistoryAdapterOptions,
} from "@sunfall/arc-start";
import { normalizeDocsSiteBasePath, withDocsSiteBasePath } from "./base-path.js";

type AnyRoute = Route.Definition<string, unknown, unknown, any>;

export type DocsSiteHistoryAdapterOptions<Routes extends readonly AnyRoute[]> = Omit<
  StartStaticHistoryAdapterOptions<Routes>,
  "basePath"
>;

export const docsSiteBasePath = normalizeDocsSiteBasePath(import.meta.env.BASE_URL);

export const docsSiteHref = (href: string): string => withDocsSiteBasePath(href, docsSiteBasePath);

export const currentDocsSiteHref = (fallback = "/"): string =>
  currentStartStaticHref({ basePath: docsSiteBasePath, fallback });

export const makeDocsSiteHistoryAdapter = <const Routes extends readonly AnyRoute[]>(
  options: DocsSiteHistoryAdapterOptions<Routes>,
): BrowserHistoryAdapter =>
  makeStartStaticHistoryAdapter({ ...options, basePath: docsSiteBasePath });
