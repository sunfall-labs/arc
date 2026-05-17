import { Effect } from "effect";
import { EffectInputCallbackError } from "./effect-like.js";
import { rejectPromiseLikeSyncCallbackValue } from "./effect-input-sync.js";
import { ResourceTagIdentityTypeId, ResourceTagTypeId, ResourceTypeId } from "./resource-identifiers.js";
import type {
  AnyResourceRef,
  ResourceInvalidation,
  ResourceInvalidationCause,
  ResourceInvalidationPlan,
  ResourceInvalidationTarget,
  ResourceRef,
  ResourceTag,
  ResourceTagIdentity
} from "./resource.js";
import type { MutableResourceStore as ResourceStoreState } from "./resource-store.js";

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

export const resourceRefStoreKey = (ref: AnyResourceRef<any>): string =>
  `${familyStoreId(ref.family)}:${ref.key}`;

export const isResourceTag = (value: unknown): value is ResourceTag =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTagTypeId]?: unknown })[ResourceTagTypeId] === ResourceTagTypeId &&
  typeof (value as { readonly key?: unknown }).key === "string";

const resourceTagStoreKey = (tag: ResourceTag): string => {
  const identity = (tag as { readonly [ResourceTagIdentityTypeId]?: ResourceTagIdentity })[ResourceTagIdentityTypeId];
  if (identity === undefined) {
    return JSON.stringify(["Legacy", tag.key]);
  }

  return identity._tag === "Unkeyed"
    ? JSON.stringify(["Unkeyed", identity.name])
    : JSON.stringify(["Keyed", identity.name, identity.key]);
};

export const isResourceRef = (value: unknown): value is AnyResourceRef<any> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ResourceTypeId]?: unknown })[ResourceTypeId] === ResourceTypeId;

export const removeResourceRefFromTagIndex = (ref: AnyResourceRef<any>, store: ResourceStoreState): void => {
  const storeKey = resourceRefStoreKey(ref);
  const tags = store.refTags.get(storeKey);
  if (!tags) {
    return;
  }

  for (const tagStoreKey of tags) {
    const refs = store.tagIndex.get(tagStoreKey);
    refs?.delete(storeKey);
    if (refs?.size === 0) {
      store.tagIndex.delete(tagStoreKey);
    }
  }

  store.refTags.delete(storeKey);
};

export const recordResourceProvidedTags = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  tags: readonly ResourceTag[],
  store: ResourceStoreState
): void => {
  removeResourceRefFromTagIndex(ref, store);

  if (tags.length === 0) {
    return;
  }

  const storeKey = resourceRefStoreKey(ref);
  const keys = new Set<string>();
  for (const tag of tags) {
    const tagStoreKey = resourceTagStoreKey(tag);
    let refs = store.tagIndex.get(tagStoreKey);
    if (!refs) {
      refs = new Map();
      store.tagIndex.set(tagStoreKey, refs);
    }
    refs.set(storeKey, ref);
    keys.add(tagStoreKey);
  }

  store.refTags.set(storeKey, keys);
};

export const resourceProvidedTagsEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  value: A
): Effect.Effect<readonly ResourceTag[], EffectInputCallbackError> =>
  Effect.try({
    try: () => {
      const operation = `Resource.provides(${ref.family.options.name})`;
      return ref.family.options.provides === undefined
        ? []
        : rejectPromiseLikeSyncCallbackValue(
            operation,
            ref.family.options.provides(value, ref.input),
            "Resource provides callbacks must return tag metadata synchronously. Move host Promise work into the resource load Effect."
          );
    },
    catch: (cause) =>
      cause instanceof EffectInputCallbackError
        ? cause
        : new EffectInputCallbackError({
            operation: `Resource.provides(${ref.family.options.name})`,
            cause,
            guidance: "Resource provides callbacks must be pure and total. Synchronous callback throws are reported in the Effect error channel."
          })
  });

export const recordResourceProvidedTagsEffect = <I, A, E, R>(
  ref: ResourceRef<I, A, E, R>,
  value: A,
  store: ResourceStoreState
): Effect.Effect<void, EffectInputCallbackError> =>
  Effect.gen(function* () {
    const tags = yield* resourceProvidedTagsEffect(ref, value);
    recordResourceProvidedTags(ref, tags, store);
  });

export const resourceRefsForTag = (
  tag: ResourceTag,
  store: ResourceStoreState
): ReadonlyArray<AnyResourceRef<any>> =>
  Array.from(store.tagIndex.get(resourceTagStoreKey(tag))?.values() ?? []) as ReadonlyArray<AnyResourceRef<any>>;

const freezeArray = <A>(values: Iterable<A>): ReadonlyArray<A> =>
  Object.freeze(Array.from(values));

export const planResourceInvalidationTargets = <R = never>(
  target: ResourceInvalidationTarget<R>,
  store: ResourceStoreState
): ResourceInvalidationPlan<R> => {
  const targets = freezeArray(Array.isArray(target) ? target : [target]) as ReadonlyArray<ResourceInvalidation<R>>;
  const entries = new Map<string, { readonly ref: AnyResourceRef<R>; readonly causes: Array<ResourceInvalidationCause> }>();
  const addCause = (ref: AnyResourceRef<R>, cause: ResourceInvalidationCause): void => {
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
      addCause(candidate as AnyResourceRef<R>, { _tag: "Ref", ref: candidate });
      continue;
    }

    if (isResourceTag(candidate)) {
      const taggedRefs = store.tagIndex.get(resourceTagStoreKey(candidate));
      if (!taggedRefs) {
        continue;
      }

      for (const ref of taggedRefs.values() as Iterable<AnyResourceRef<any>>) {
        addCause(ref as AnyResourceRef<R>, { _tag: "Tag", tag: candidate });
      }
    }
  }

  return Object.freeze({
    targets,
    entries: freezeArray(Array.from(entries.values()).map((entry) =>
      Object.freeze({
        ref: entry.ref,
        causes: freezeArray(entry.causes)
      })
    ))
  });
};
