import { Deferred, Effect, Exit, Queue, Scope } from "effect";
import type {
  CollectionChange,
  CollectionKey,
  CollectionWriteOptions
} from "./collection-contract.js";

export interface CollectionChangeFeedDispatch<A extends object, K extends CollectionKey> {
  readonly changes: ReadonlyArray<CollectionChange<A, K>>;
  readonly options: CollectionWriteOptions | undefined;
  readonly completed?: Deferred.Deferred<void, unknown>;
}

export type CollectionChangeFeedLateEmitPolicy = "drop";

export interface CollectionChangeFeedDispatchPolicy {
  readonly lateEmit?: CollectionChangeFeedLateEmitPolicy;
}

export interface CollectionChangeFeedDispatcher<A extends object, K extends CollectionKey> {
  readonly policy: Required<CollectionChangeFeedDispatchPolicy>;
  emitChanges(
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): boolean;
  emitEffect(
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ): Effect.Effect<void, unknown>;
  takeEffect(): Effect.Effect<CollectionChangeFeedDispatch<A, K>>;
  shutdownEffect(): Effect.Effect<void>;
}

const defaultPolicy: Required<CollectionChangeFeedDispatchPolicy> = {
  lateEmit: "drop"
};

const normalizePolicy = (
  policy: CollectionChangeFeedDispatchPolicy = {}
): Required<CollectionChangeFeedDispatchPolicy> => ({
  lateEmit: policy.lateEmit ?? defaultPolicy.lateEmit
});

export const makeCollectionChangeFeedDispatcherEffect = <
  A extends object,
  K extends CollectionKey
>(
  policy?: CollectionChangeFeedDispatchPolicy
): Effect.Effect<CollectionChangeFeedDispatcher<A, K>> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<CollectionChangeFeedDispatch<A, K>>();
    const normalized = normalizePolicy(policy);
    let closed = false;

    const emitDispatch = (
      dispatch: CollectionChangeFeedDispatch<A, K>
    ): boolean => {
      if (closed) {
        return false;
      }
      const accepted = Queue.offerUnsafe(queue, dispatch);
      if (!accepted && normalized.lateEmit === "drop") {
        closed = true;
      }
      return accepted;
    };

    const shutdownEffect = Effect.gen(function* () {
      if (closed) {
        return;
      }
      closed = true;
      while (true) {
        const pending = Queue.takeUnsafe(queue);
        if (!pending || Exit.isFailure(pending)) {
          break;
        }
        if (pending.value.completed) {
          yield* Deferred.succeed(pending.value.completed, undefined).pipe(Effect.asVoid);
        }
      }
      yield* Queue.shutdown(queue).pipe(Effect.asVoid);
    });

    return {
      policy: normalized,
      emitChanges: (changes, options) => emitDispatch({ changes, options }),
      emitEffect: (changes, options) =>
        Effect.gen(function* () {
          const completed = yield* Deferred.make<void, unknown>();
          if (!emitDispatch({ changes, options, completed })) {
            return;
          }
          yield* Deferred.await(completed);
        }),
      takeEffect: () => Queue.take(queue),
      shutdownEffect: () => shutdownEffect
    };
  });

export const scopedCollectionChangeFeedDispatcherEffect = <
  A extends object,
  K extends CollectionKey
>(
  policy?: CollectionChangeFeedDispatchPolicy
): Effect.Effect<CollectionChangeFeedDispatcher<A, K>, never, Scope.Scope> =>
  Effect.acquireRelease(
    makeCollectionChangeFeedDispatcherEffect<A, K>(policy),
    (dispatcher) => dispatcher.shutdownEffect()
  );
