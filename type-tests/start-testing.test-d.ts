import {
  extractStartStaticHtmlLinks,
  hydrationScriptId,
  serverActionPath,
  serverRpcPath,
  startStaticPageOutputPath,
  streamHydrationAttribute,
  type StartHydrationChunk,
} from "@sunfall/arc-start/testing";

const testingMarkers: ReadonlyArray<string> = [
  hydrationScriptId,
  streamHydrationAttribute,
  serverActionPath,
  serverRpcPath,
];
const staticLinks: readonly string[] = extractStartStaticHtmlLinks('<a href="/docs">Docs</a>', {
  origin: "https://docs.example",
  fromPath: "/",
});
const staticOutputPath: string = startStaticPageOutputPath("/docs", { autoSubfolderIndex: true });
declare const hydrationChunk: StartHydrationChunk;
const hydrationChunkTag: "StartHydrationChunk" = hydrationChunk._tag;
void testingMarkers;
void staticLinks;
void staticOutputPath;
void hydrationChunkTag;
