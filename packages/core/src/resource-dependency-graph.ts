import { ResourceTagTypeId, ResourceTypeId } from "./resource-identifiers.js";
import type {
  AnyResourceRef,
  ResourceInvalidationCause,
  ResourceInvalidationPlan,
  ResourceInvalidationTarget,
  ResourceRef,
  ResourceTag
} from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";

const familyIds = new WeakMap<object, number>();
let nextFamilyId = 0;

const familyStoreId = (family: object): number => {
  const existing = familyIds.get(family);
  if (existing !== undefined) {
    return existing;
  }

  const id = nextFamilyId++;
  familyIds.set(family, id);
  return id;
};

export const resourceRefStoreKey = (ref: AnyResourceRef): string =>
  `${familyStoreId(ref.family)}:${ref.key}`;

export const isResourceTag = (value: unknown): value is ResourceTag =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTagTypeId]?: unknown })[ResourceTagTypeId] === ResourceTagTypeId &&
  typeof (value as { readonly key?: unknown }).key === "string";

export const isResourceRef = (value: unknown): value is AnyResourceRef =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTypeId]?: unknown })[ResourceTypeId] === ResourceTypeId;

export const removeResourceRefFromTagIndex = (ref: AnyResourceRef, store: ResourceStoreState): void => {
  const storeKey = resourceRefStoreKey(ref);
  const tags = store.refTags.get(storeKey);
  if (!tags) {
    return;
  }

  for (const tagKey of tags) {
    const refs = store.tagIndex.get(tagKey);
    refs?.delete(storeKey);
    if (refs?.size === 0) {
      store.tagIndex.delete(tagKey);
    }
  }

  store.refTags.delete(storeKey);
};

export const recordResourceProvidedTags = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  value: A,
  store: ResourceStoreState
): void => {
  const tags = ref.family.options.provides?.(value, ref.input) ?? [];
  removeResourceRefFromTagIndex(ref, store);

  if (tags.length === 0) {
    return;
  }

  const storeKey = resourceRefStoreKey(ref);
  const keys = new Set<string>();
  for (const tag of tags) {
    let refs = store.tagIndex.get(tag.key);
    if (!refs) {
      refs = new Map();
      store.tagIndex.set(tag.key, refs);
    }
    refs.set(storeKey, ref);
    keys.add(tag.key);
  }

  store.refTags.set(storeKey, keys);
};

export const resourceRefsForTag = (
  tag: ResourceTag,
  store: ResourceStoreState
): ReadonlyArray<AnyResourceRef> =>
  Array.from(store.tagIndex.get(tag.key)?.values() ?? []) as ReadonlyArray<AnyResourceRef>;

export const planResourceInvalidationTargets = (
  target: ResourceInvalidationTarget,
  store: ResourceStoreState
): ResourceInvalidationPlan => {
  const targets = Array.isArray(target) ? target : [target];
  const entries = new Map<string, { readonly ref: AnyResourceRef<any>; readonly causes: Array<ResourceInvalidationCause> }>();
  const addCause = (ref: AnyResourceRef<any>, cause: ResourceInvalidationCause): void => {
    const storeKey = resourceRefStoreKey(ref);
    const existing = entries.get(storeKey);
    if (existing) {
      existing.causes.push(cause);
    } else {
      entries.set(storeKey, { ref, causes: [cause] });
    }
  };

  for (const candidate of targets) {
    if (isResourceRef(candidate)) {
      addCause(candidate, { _tag: "Ref", ref: candidate });
      continue;
    }

    if (isResourceTag(candidate)) {
      const taggedRefs = store.tagIndex.get(candidate.key);
      if (!taggedRefs) {
        continue;
      }

      for (const ref of taggedRefs.values() as Iterable<AnyResourceRef<any>>) {
        addCause(ref, { _tag: "Tag", tag: candidate });
      }
    }
  }

  return {
    targets,
    entries: Array.from(entries.values()).map((entry) => ({
      ref: entry.ref,
      causes: entry.causes
    }))
  };
};
