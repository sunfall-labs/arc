import type { Route } from "@sunfall/arc-core";
import { Context } from "effect";
import type { StartDocument, StartDocumentTagAttributes } from "./start-document.js";

/** The built browser assets one page needs. URLs include Vite's `base`. */
export interface StartPageAssets {
  /** Stylesheets, in dependency order. */
  readonly stylesheets: ReadonlyArray<string>;
  /** JS chunks to `modulepreload`, so the browser fetches them with the entry. */
  readonly modulepreload: ReadonlyArray<string>;
}

/**
 * The production client build, as the server renders it into documents: the
 * entry chunk with its static imports and CSS, plus, per route path, the lazy
 * route chunks (and their imports and CSS) the matched route loads, so the
 * page preloads them instead of discovering them after the entry runs.
 */
export interface StartClientAssets extends StartPageAssets {
  /** The built browser entry chunk. */
  readonly entry: string;
  /** Extra assets per route path (`Route.define`'s path), beyond the entry's. */
  readonly routes: Readonly<Record<string, StartPageAssets>>;
}

/**
 * The client build the server renders documents for. Unset in development and
 * in tests: the document then references the source entry, which Vite serves.
 * Start's production server (`serve` from `@sunfall/arc-start/node`) provides
 * it from the build.
 */
export const ClientAssets = Context.Reference<StartClientAssets | undefined>(
  "@sunfall/arc-start/ClientAssets",
  { defaultValue: () => undefined },
);

/** The parts of a Vite build manifest (`build.manifest`) Start reads. */
export interface ViteManifestChunk {
  readonly file: string;
  readonly src?: string;
  readonly isEntry?: boolean;
  readonly css?: ReadonlyArray<string>;
  readonly imports?: ReadonlyArray<string>;
}

/** A Vite build manifest, keyed by source path relative to the Vite root. */
export type ViteManifest = Readonly<Record<string, ViteManifestChunk>>;

/** A chunk and its static imports, depth first, each once. */
const staticClosure = (manifest: ViteManifest, key: string, seen: Set<string>): string[] => {
  const chunk = manifest[key];
  if (chunk === undefined || seen.has(key)) {
    return [];
  }
  seen.add(key);
  return [
    key,
    ...(chunk.imports ?? []).flatMap((imported) => staticClosure(manifest, imported, seen)),
  ];
};

const pageAssets = (
  manifest: ViteManifest,
  keys: ReadonlyArray<string>,
  base: string,
  skip: ReadonlySet<string>,
): { readonly assets: StartPageAssets; readonly keys: ReadonlyArray<string> } => {
  const seen = new Set(skip);
  const closure = keys.flatMap((key) => staticClosure(manifest, key, seen));
  const stylesheets = [...new Set(closure.flatMap((key) => manifest[key]?.css ?? []))];
  return {
    assets: {
      stylesheets: stylesheets.map((file) => `${base}${file}`),
      modulepreload: closure.map((key) => `${base}${manifest[key]!.file}`),
    },
    keys: closure,
  };
};

/**
 * Derives the document assets from a client build manifest.
 *
 * `entry` is the manifest key of the browser entry (the first `isEntry` chunk
 * when omitted). `routeModules` maps each route path to the manifest keys of
 * the modules its page loads lazily (its `*.component.tsx` and layouts);
 * modules the build did not emit as chunks are ignored.
 */
export const clientAssetsFromViteManifest = (
  manifest: ViteManifest,
  options: {
    readonly base: string;
    readonly entry?: string;
    readonly routeModules?: Readonly<Record<string, ReadonlyArray<string>>>;
  },
): StartClientAssets => {
  const entryKey =
    options.entry !== undefined && manifest[options.entry] !== undefined
      ? options.entry
      : Object.keys(manifest).find((key) => manifest[key]?.isEntry === true);
  if (entryKey === undefined) {
    throw new Error("The Vite client build manifest has no entry chunk.");
  }
  const entry = pageAssets(manifest, [entryKey], options.base, new Set());
  const entryKeys = new Set(entry.keys);
  const entryStylesheets = new Set(entry.assets.stylesheets);
  const routes: Record<string, StartPageAssets> = {};
  for (const [path, modules] of Object.entries(options.routeModules ?? {})) {
    const emitted = modules.filter((key) => manifest[key] !== undefined);
    if (emitted.length === 0) {
      continue;
    }
    const route = pageAssets(manifest, emitted, options.base, entryKeys).assets;
    routes[path] = {
      stylesheets: route.stylesheets.filter((href) => !entryStylesheets.has(href)),
      modulepreload: route.modulepreload,
    };
  }
  return {
    entry: `${options.base}${manifest[entryKey]!.file}`,
    // The entry script comes after the page body; preloading it from the
    // head starts its download before the body has streamed.
    modulepreload: entry.assets.modulepreload,
    stylesheets: entry.assets.stylesheets,
    routes,
  };
};

// Dev stylesheets (`/src/...`, `/@fs/...`) only exist under the Vite dev server.
const isDevStylesheet = (link: StartDocumentTagAttributes): boolean =>
  link.rel === "stylesheet" && /^\/(?:src|@fs)\//.test(link.href ?? "");

/**
 * The document with the built entry, its stylesheets, and modulepreload links
 * for the entry's imports and the matched route's chunks. An explicit
 * `clientEntry` in `document` wins; dev stylesheet links are dropped.
 */
export const documentWithClientAssets = (
  document: StartDocument,
  assets: StartClientAssets,
  match: Route.Match | undefined,
): StartDocument => {
  const route = match === undefined ? undefined : assets.routes[match.route.path];
  const stylesheets = [...assets.stylesheets, ...(route?.stylesheets ?? [])];
  const modulepreload = [...assets.modulepreload, ...(route?.modulepreload ?? [])];
  return {
    ...document,
    clientEntry: document.clientEntry ?? assets.entry,
    links: [
      ...stylesheets.map((href) => ({ rel: "stylesheet", href })),
      ...(document.links ?? []).filter((link) => !isDevStylesheet(link)),
      ...modulepreload.map((href) => ({ rel: "modulepreload", href })),
    ],
  };
};
