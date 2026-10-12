/**
 * Internal plumbing shared by Sunfall Arc adapter packages (`@sunfall/arc-solid`
 * and tests).
 *
 * Not public API: no stability guarantees, and application code should not
 * import from `@sunfall/arc-db/internal`.
 */
export { buildQuery } from "./query-builder.js";
export { currentQueryStore, runWithQueryStore } from "./query-source-adapter.js";
