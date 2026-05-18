import type { BrowserHistoryAdapter } from "@sunfall/arc-core";
import {
  normalizeDocsSiteBasePath,
  stripDocsSiteBasePath,
  withDocsSiteBasePath,
} from "./base-path.js";

export const docsSiteBasePath = normalizeDocsSiteBasePath(import.meta.env.BASE_URL);

export const docsSiteHref = (href: string): string => withDocsSiteBasePath(href, docsSiteBasePath);

const currentBrowserHref = (): string => `${window.location.pathname}${window.location.search}`;

export const makeDocsSiteHistoryAdapter = (): BrowserHistoryAdapter => ({
  currentHref: (fallback = "/") =>
    typeof window === "undefined"
      ? stripDocsSiteBasePath(fallback, docsSiteBasePath)
      : stripDocsSiteBasePath(currentBrowserHref(), docsSiteBasePath),
  listen: (onChange) => {
    if (typeof window === "undefined") {
      return () => undefined;
    }

    const listener = (): void => {
      onChange(stripDocsSiteBasePath(currentBrowserHref(), docsSiteBasePath));
    };
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  },
  commit: (href, options = {}) => {
    if (typeof window === "undefined") {
      return href;
    }

    const browserHref = docsSiteHref(href);
    if (browserHref !== currentBrowserHref()) {
      if (options.replace) {
        window.history.replaceState(null, "", browserHref);
      } else {
        window.history.pushState(null, "", browserHref);
      }
    }

    return stripDocsSiteBasePath(currentBrowserHref(), docsSiteBasePath);
  },
});
