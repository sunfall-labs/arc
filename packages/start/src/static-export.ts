import { Data } from "effect";

/** Output path options for prerendered static HTML pages. */
export interface StartStaticOutputPathOptions {
  /**
   * Write `/docs` to `docs/index.html` instead of `docs.html`.
   *
   * This matches static hosts that serve directory indexes and keeps dynamic
   * route output inspectable beside any child pages.
   */
  readonly autoSubfolderIndex?: boolean;
}

/** Options for extracting crawlable links from prerendered HTML. */
export interface StartStaticLinkExtractionOptions {
  /** Absolute origin used to classify root-relative and relative links as internal. */
  readonly origin?: string;
  /** Current page path used to resolve relative links. */
  readonly fromPath?: string;
}

/** Error thrown when a static export path cannot map cleanly to one HTML file. */
export class StartStaticPathError extends Data.TaggedError("StartStaticPathError")<{
  readonly path: string;
  readonly reason: "empty" | "external-url" | "relative-url" | "query-or-hash" | "invalid-segment";
  readonly guidance: string;
}> {}

const defaultStaticOrigin = "https://sunfall-arc.static";

const pathError = (
  path: string,
  reason: StartStaticPathError["reason"],
  guidance: string,
): StartStaticPathError => new StartStaticPathError({ path, reason, guidance });

const htmlAttributeValue = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const staticPageBasePath = (path: string): string => {
  const normalized = normalizeStartStaticPath(path);
  return normalized === "/" ? "/" : `${normalized}/`;
};

/**
 * Normalizes a static page path to a root-relative pathname.
 *
 * Static export paths intentionally exclude queries and hashes because those do
 * not have a portable one-file mapping on ordinary static hosts.
 */
export const normalizeStartStaticPath = (path: string): string => {
  if (path.length === 0 || path.trim().length === 0) {
    throw pathError(
      path,
      "empty",
      "Provide a root-relative path such as '/' or '/cookbook/resource-from-server-function'.",
    );
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) || path.startsWith("//")) {
    throw pathError(
      path,
      "external-url",
      "Static page paths must be root-relative. Crawl external URLs separately before adding them as pages.",
    );
  }
  if (!path.startsWith("/")) {
    throw pathError(
      path,
      "relative-url",
      "Static page paths must start with '/'. Resolve relative links before planning output files.",
    );
  }
  if (path.includes("?") || path.includes("#")) {
    throw pathError(
      path,
      "query-or-hash",
      "Static page paths must not include query strings or hashes. Encode variants as concrete route paths.",
    );
  }

  const segments = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment === "." || segment === ".." || segment.includes("\\")) {
        throw pathError(
          path,
          "invalid-segment",
          "Static page path segments must not contain '.', '..', or backslashes.",
        );
      }
      return segment;
    });

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};

/** Returns the root-relative HTML output file for a static page path. */
export const startStaticPageOutputPath = (
  path: string,
  options: StartStaticOutputPathOptions = {},
): string => {
  const normalized = normalizeStartStaticPath(path);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "index.html";
  }

  return options.autoSubfolderIndex === false
    ? `${segments.join("/")}.html`
    : `${segments.join("/")}/index.html`;
};

/**
 * Extracts internal anchor paths from prerendered HTML.
 *
 * The crawler deliberately returns normalized page paths, not raw hrefs. Hashes
 * are dropped, query links are skipped, and external/protocol links stay out of
 * the static graph.
 */
export const extractStartStaticHtmlLinks = (
  html: string,
  options: StartStaticLinkExtractionOptions = {},
): readonly string[] => {
  const origin = options.origin ?? defaultStaticOrigin;
  const fromPath = staticPageBasePath(options.fromPath ?? "/");
  const base = new URL(fromPath, origin);
  const links = new Set<string>();
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = htmlAttributeValue(match[2] ?? "").trim();
    if (rawHref.length === 0 || rawHref.startsWith("#")) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(rawHref, base);
    } catch {
      continue;
    }

    if (url.origin !== origin || url.search.length > 0) {
      continue;
    }
    try {
      links.add(normalizeStartStaticPath(url.pathname));
    } catch {
      continue;
    }
  }

  return [...links];
};
