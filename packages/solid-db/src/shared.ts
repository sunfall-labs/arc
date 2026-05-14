import { runWithRuntime, type EffectUiRuntime } from "@effect-ui/core";
import type { AnyCollection, CollectionLoadState, LiveQueryState } from "@effect-ui/db";

export const subscribeCollection = (
  runtime: EffectUiRuntime<unknown, never>,
  collection: AnyCollection,
  notify: () => void
): (() => void) => {
  const version = runWithRuntime(runtime, () => collection.version());
  const state = runWithRuntime(runtime, () => collection.state());
  const unsubscribeVersion = version.subscribe(notify);
  const unsubscribeState = state.subscribe(notify);
  return () => {
    unsubscribeVersion();
    unsubscribeState();
  };
};

export const collectionStateError = <E>(state: CollectionLoadState<E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;

export const liveQueryStateError = <T, E>(state: LiveQueryState<T, E>): E | undefined =>
  state._tag === "Failure" ? state.error : undefined;
