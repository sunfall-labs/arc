/**
 * Setup-time Component bindings for Sunfall Arc collections and live queries:
 * `yield* SolidDb.collection(Projects)` and `yield* SolidDb.liveQuery(query)`
 * inside `Component.define(...)`.
 */
export { collection, type CollectionBindingOptions, type CollectionHandle } from "./collection.js";
export { liveQuery, type LiveQueryBindingOptions, type LiveQueryHandle } from "./live-query.js";
