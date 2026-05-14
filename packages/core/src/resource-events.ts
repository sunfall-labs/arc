import { Effect, PubSub } from "effect";
import type { ResourceInvalidationCause } from "./resource.js";
import type { ResourceStore, ResourceStoreEvent, ResourceStoreInvalidationCause } from "./resource-store.js";

export const publishResourceStoreEvent = (
  store: ResourceStore,
  event: ResourceStoreEvent
): Effect.Effect<void> =>
  PubSub.publish(store.events, event).pipe(Effect.asVoid);

export const describeResourceStoreInvalidationCause = (
  cause: ResourceInvalidationCause
): ResourceStoreInvalidationCause => {
  switch (cause._tag) {
    case "Ref":
      return {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      };
    case "Tag":
      return {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };
  }
};
