import {
  invokeEffectInput,
  type EffectInput,
  type EffectInputCallbackError
} from "@effect-ui/core";
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect";
import {
  scopedCollectionChangeFeedDispatcherEffect,
  type CollectionChangeFeedDispatch
} from "./change-feed-dispatcher.js";
import type {
  CollectionChange,
  CollectionKey,
  CollectionRuntimeError,
  CollectionWriteOptions
} from "./collection-contract.js";
import type {
  CollectionChangeFeedAdapter,
  CollectionChangeFeedSubscribeOptions,
  CollectionChangeFeedSubscription,
  CollectionChangeFeedUnsubscribe
} from "./sync-adapter.js";

/**
 * Store-local dependencies required to run a scoped collection change feed.
 *
 * The Collection Runtime supplies row-application and failure-publication
 * Effects so this module can own subscription lifecycle without owning mutable
 * Collection Store state.
 */
export interface CollectionChangeFeedRuntimeOptions<
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError,
  FeedRequirements
> {
  /** Public collection name passed to adapter contexts and diagnostics. */
  readonly collection: string;
  /** Adapter that subscribes to a remote feed and receives Effect-first emitters. */
  readonly adapter: CollectionChangeFeedAdapter<A, K, FeedError, FeedRequirements, E, R>;
  /** Default write and dispatcher policies for emitted change batches. */
  readonly options?: CollectionChangeFeedSubscribeOptions;
  /** Apply one accepted change-feed batch to the subscribed Collection Store. */
  readonly applyChanges: (
    changes: ReadonlyArray<CollectionChange<A, K>>,
    options?: CollectionWriteOptions
  ) => Effect.Effect<void, CollectionRuntimeError<E>, R>;
  /** Publish an asynchronous emission failure without failing the subscription fiber. */
  readonly publishFailure: (error: unknown) => Effect.Effect<void>;
}

const collectionChangeFeedInputCallbackEffect = <A, E, R>(
  callback: () => EffectInput<A, E, R>
): Effect.Effect<A, E | EffectInputCallbackError, R> =>
  invokeEffectInput("collection callback", callback);

const changeFeedUnsubscribe = <E, R>(
  subscription: CollectionChangeFeedSubscription<E, R>
): CollectionChangeFeedUnsubscribe<E, R> | undefined =>
  typeof subscription === "function"
    ? subscription
    : subscription?.unsubscribe;

const changeFeedFailureError = (cause: Cause.Cause<unknown>): unknown =>
  cause.reasons.find(Cause.isFailReason)?.error ?? Cause.squash(cause);

const completeChangeFeedEmission = <
  A extends object,
  K extends CollectionKey,
  E
>(
  emission: CollectionChangeFeedDispatch<A, K, E>,
  exit: Exit.Exit<void, E>
): Effect.Effect<void> =>
  emission.completed
    ? Deferred.done(emission.completed, exit).pipe(
        Effect.asVoid,
        Effect.catchCause(() => Effect.void)
      )
    : Effect.void;

const interruptChangeFeedEmission = <
  A extends object,
  K extends CollectionKey,
  E
>(
  emission: CollectionChangeFeedDispatch<A, K, E>
): Effect.Effect<void> =>
  emission.completed
    ? Deferred.interrupt(emission.completed).pipe(
        Effect.asVoid,
        Effect.catchCause(() => Effect.void)
      )
    : Effect.void;

/**
 * Subscribe a change-feed adapter into one Collection Store runtime.
 *
 * `emit(...)` returns an Effect for composed adapters. `emitChanges(...)` is
 * the host-callback helper for websocket, worker, and observer feeds; it queues
 * into a scoped dispatcher and deterministically drops late emissions after the
 * subscription Scope closes.
 */
export const subscribeCollectionChangeFeedRuntimeEffect = <
  A extends object,
  K extends CollectionKey,
  E,
  R,
  FeedError = never,
  FeedRequirements = never
>(
  runtime: CollectionChangeFeedRuntimeOptions<A, K, E, R, FeedError, FeedRequirements>
): Effect.Effect<void, CollectionRuntimeError<E> | FeedError, R | FeedRequirements | Scope.Scope> =>
  Effect.gen(function* () {
    const options = runtime.options ?? {};
    const dispatcher = yield* scopedCollectionChangeFeedDispatcherEffect<A, K, CollectionRuntimeError<E>>(options.dispatch);

    const consumerFiber = yield* dispatcher.takeEffect().pipe(
      Effect.flatMap((emission) =>
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            runtime.applyChanges(emission.changes, emission.options ?? options.write)
          );
          if (Exit.isFailure(exit)) {
            yield* runtime.publishFailure(changeFeedFailureError(exit.cause));
          }
          yield* completeChangeFeedEmission(emission, exit);
        }).pipe(Effect.ensuring(interruptChangeFeedEmission(emission)))
      ),
      Effect.forever,
      Effect.forkScoped
    );

    const shutdownSetup = Effect.all([
      Fiber.interrupt(consumerFiber).pipe(Effect.asVoid, Effect.catchCause(() => Effect.void)),
      dispatcher.shutdownEffect().pipe(Effect.catchCause(() => Effect.void))
    ], { discard: true });

    yield* Effect.acquireRelease(
      collectionChangeFeedInputCallbackEffect<CollectionChangeFeedSubscription<FeedError, FeedRequirements>, FeedError, FeedRequirements>(() =>
        runtime.adapter.subscribe({
          collection: runtime.collection,
          emit: (changes, writeOptions) => dispatcher.emitEffect(changes, writeOptions),
          emitChanges: (changes, writeOptions) => {
            dispatcher.emitChanges(changes, writeOptions);
          }
        })
      ).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? shutdownSetup
            : Effect.void
        )
      ),
      (subscription) => {
        const unsubscribe = changeFeedUnsubscribe(subscription);
        return unsubscribe
          ? collectionChangeFeedInputCallbackEffect<void, FeedError, FeedRequirements>(() => unsubscribe()).pipe(
              Effect.catchCause((cause) =>
                runtime.publishFailure(changeFeedFailureError(cause)).pipe(
                  Effect.catchCause(() => Effect.void)
                )
              )
            )
          : Effect.void;
      }
    );
  }).pipe(Effect.asVoid);
