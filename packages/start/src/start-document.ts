import type { Route } from "@sunfall/arc-core";

/** DOM id of the element the app root renders into and `App.launch` hydrates. */
export const startRootElementId = "root";

/** Default browser entry module referenced by the document shell. */
export const defaultStartClientEntry = "/src/main.tsx";

/** Attributes of one `<meta>` or `<link>` tag. Values are HTML-escaped. */
export type StartDocumentTagAttributes = Readonly<Record<string, string>>;

/**
 * The parts of the HTML document a Start app owns besides its head.
 *
 * The head (`<title>` and `<meta>` tags) is the matched route's `head`
 * through the app's `App.define({ head })`, so the browser can keep it in
 * step on navigation. Start renders the rest: the doctype, charset and
 * viewport, Solid's hydration bootstrap, the app root element, the Resource
 * chunks and root hydration payload, and the browser entry script, in the order
 * hydration needs.
 */
export interface StartDocument {
  /** `<html lang>`. Defaults to `"en"`. */
  readonly lang?: string;
  /** `<link>` tags, e.g. `{ rel: "stylesheet", href: "/src/styles.css" }`. */
  readonly links?: ReadonlyArray<StartDocumentTagAttributes>;
  /**
   * Browser entry module (the file that calls `App.launch(app)`). Defaults to
   * `/src/main.tsx`; production builds and prerendering rewrite it to the built asset.
   */
  readonly clientEntry?: string;
  /** Response headers for the rendered page. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** What a `document` function sees for one rendered request. */
export interface StartDocumentContext<
  Routes extends readonly Route.Definition<string, unknown, unknown, any>[] =
    readonly Route.Definition<string, unknown, unknown, any>[],
> {
  readonly request: Request;
  /** The matched route, if any. */
  readonly match: Route.Match<Routes[number]> | undefined;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const attributeNamePattern = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/u;

/**
 * Marks the `<meta>` tags rendered from the page's head, which `App.launch`
 * replaces when the head changes.
 */
export const startHeadAttribute = "data-arc-head";

/** The `<meta>` tags of a head: its description first, then its `meta`. */
export const startHeadMetaTags = (head: Route.Head): ReadonlyArray<Route.HeadTag> => [
  ...(head.description === undefined ? [] : [{ name: "description", content: head.description }]),
  ...(head.meta ?? []),
];

const renderTag = (tag: "meta" | "link", attributes: StartDocumentTagAttributes): string =>
  `<${tag}${Object.entries(attributes)
    .filter(([name]) => attributeNamePattern.test(name))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("")} />`;

/** The document shell around the rendered app markup. */
export interface StartDocumentShell {
  /** Everything up to and including the opening app root element. */
  readonly open: string;
  /** Closes the app root element; the Resource hydration chunks follow it. */
  readonly closeRoot: string;
  /** The root hydration payload, the browser entry, and the closing tags. */
  readonly close: string;
}

/** Renders the document shell around the app markup. */
export const renderStartDocumentShell = (
  document: StartDocument,
  head: Route.Head,
  scripts: {
    /** Solid's hydration bootstrap (`generateHydrationScript()`). */
    readonly solidHydration: string;
    /** Start's root hydration payload script. */
    readonly rootHydration: string;
  },
): StartDocumentShell => {
  const headHtml = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    ...startHeadMetaTags(head).map((attributes) =>
      renderTag("meta", { ...attributes, [startHeadAttribute]: "" }),
    ),
    ...(head.title === undefined ? [] : [`<title>${escapeHtml(head.title)}</title>`]),
    ...(document.links ?? []).map((attributes) => renderTag("link", attributes)),
    scripts.solidHydration,
  ].join("");
  const clientEntry = escapeHtml(document.clientEntry ?? defaultStartClientEntry);
  return {
    open: `<!doctype html><html lang="${escapeHtml(document.lang ?? "en")}"><head>${headHtml}</head><body><div id="${startRootElementId}">`,
    closeRoot: "</div>",
    close: `${scripts.rootHydration}<script type="module" src="${clientEntry}"></script></body></html>`,
  };
};
