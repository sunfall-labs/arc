/**
 * Test-only helpers for asserting on Start's rendered HTML and static output.
 *
 * Application code should not import this subpath; it exposes the wire-level
 * markers that app tests read from server-rendered documents.
 */
export {
  /** Default DOM id for the root Start hydration payload script. */
  hydrationScriptId,
  /** Attribute that marks streamed Start hydration chunk script elements. */
  streamHydrationAttribute,
  /** Streamed hydration chunk wire shape. */
  type StartHydrationChunk,
} from "./hydration.js";

export {
  /** Default action transport endpoint path. */
  serverActionPath,
  /** Default RPC transport endpoint path. */
  serverRpcPath,
} from "./rpc.js";

export {
  /** Extracts same-site links from rendered static HTML. */
  extractStartStaticHtmlLinks,
  /** Resolves the output file path for a prerendered static page. */
  startStaticPageOutputPath,
} from "./static-export.js";
