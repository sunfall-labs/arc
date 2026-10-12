/**
 * Setup-time Component bindings for Sunfall Arc collections and live queries:
 * `yield* SolidDb.collection(Projects)` and `yield* SolidDb.liveQuery(query)`
 * inside `Component.define(...)`.
 */
export { collection } from "./collection.js";
export { liveQuery } from "./live-query.js";
