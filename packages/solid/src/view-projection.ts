import { createProjection, type Accessor } from "solid-js";

/** Identity a projection reconciles plain objects by; `null` is positional. */
export type ViewKey = string | ((item: object) => unknown) | null;

/**
 * Projects an Arc-owned value into a fine-grained Solid view: the one way
 * Arc state (a State model, a Resource value) reaches render code.
 *
 * The value is boxed so primitives, nullable values, and unions share one
 * path: `box.value` re-notifies only when the root changes identity (a
 * primitive change, an object/array swap, or a different keyed entity),
 * while reconcile adopts each new value as the store's backing and notifies
 * only the leaves that changed. A subtree whose object is unchanged is
 * skipped by identity, so Arc's structural sharing keeps reconciles cheap.
 *
 * `read` returns `undefined` to keep the current view (no new value yet).
 *
 * A projection (not a plain store) is required: plain stores share one
 * proxy per raw object across every store, so two views over immutable
 * values that share objects would see each other's reconciles. A
 * projection's proxies belong to its own family.
 */
export const projectView = <T>(
  read: () => { readonly value: T } | undefined,
  key: ViewKey,
): Accessor<T> => {
  const view = createProjection<{ value: T }>(read as () => { value: T }, {}, { key });
  return () => view.value;
};
