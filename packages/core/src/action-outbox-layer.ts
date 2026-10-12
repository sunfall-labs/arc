import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Schedule,
  Schema,
  Semaphore,
  type Fiber,
  type Scope,
} from "effect";
import { KeyValueStore } from "effect/persistence";
import type { ActionDefinition } from "./action.js";
import { applyActionOptimisticEffect, executeActionEffect } from "./action-execution-workflow.js";
import {
  makeActionOptimisticTransactionRuntime,
  type ActionOptimisticTransactionRuntime,
} from "./action-optimistic.js";
import {
  ActionOutbox,
  ActionQueued,
  ActionSubmissionExpired,
  ActionSubmissionUnrestorable,
  isRetryableActionFailure,
  type ActionOutboxEntry,
  type ActionOutboxFailure,
  type ActionOutboxOptions,
  type ActionOutboxRestoreOptions,
} from "./action-outbox.js";
import { getActionDefinition } from "./definition-registry.js";
import { Signal } from "./signal.js";
import type { TimelineActionCause } from "./timeline.js";

/**
 * The outbox's namespace in the runtime's `KeyValueStore`: the version lives
 * in the prefix, so a future record format moves to `arc/actions/v2/`.
 */
export const actionOutboxKeyPrefix = "arc/actions/v1/";
/** The key (under the prefix) holding the queue. */
const queueKey = "queue";

const defaultReplaySchedule: Schedule.Schedule<unknown, unknown> = Schedule.exponential(
  "1 second",
).pipe(Schedule.upTo({ times: 10 }));

const StoredSubmission = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  input: Schema.Unknown,
  createdAt: Schema.Number,
  attempts: Schema.Number,
});
type StoredSubmission = typeof StoredSubmission.Type;

const StoredQueue = Schema.Struct({
  submissions: Schema.Array(StoredSubmission),
});

type AnyDurableDefinition = ActionDefinition<any, any, any, any>;

/** A pending submission this runtime owns: its record, decoded input, and live patch. */
interface LiveSubmission {
  record: StoredSubmission;
  readonly definition: AnyDurableDefinition;
  readonly input: unknown;
  readonly transaction: ActionOptimisticTransactionRuntime;
  /** The caller waiting on the outcome, until it is queued or stops waiting. */
  waiter: Deferred.Deferred<unknown, unknown> | undefined;
}

const retryableCause = (cause: Cause.Cause<unknown>): boolean =>
  Cause.findErrorOption(cause).pipe(Option.exists(isRetryableActionFailure));

const randomSubmissionId = (): string => {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const toEntry = (live: LiveSubmission): ActionOutboxEntry => ({
  id: live.record.id,
  action: live.record.action,
  input: live.input,
  createdAt: live.record.createdAt,
  attempts: live.record.attempts,
});

const encodeInput = (definition: AnyDurableDefinition, input: unknown) =>
  Schema.encodeUnknownEffect(definition.input as Schema.Encoder<unknown>)(input);

const decodeInput = (definition: AnyDurableDefinition, input: unknown) =>
  Schema.decodeUnknownEffect(definition.input as Schema.Decoder<unknown>)(input);

/**
 * Builds the Action Outbox service over the runtime's `KeyValueStore`.
 * Submissions, restore, and replay run with the context of the runtime fiber
 * that first submits or restores.
 */
export const makeActionOutboxLayer = (
  options: ActionOutboxOptions = {},
): Layer.Layer<ActionOutbox, never, KeyValueStore.KeyValueStore> =>
  Layer.effect(ActionOutbox)(
    Effect.gen(function* () {
      const key = queueKey;
      const replaySchedule = options.retry ?? defaultReplaySchedule;
      const store = KeyValueStore.toSchemaStore(
        KeyValueStore.prefix(yield* KeyValueStore.KeyValueStore, actionOutboxKeyPrefix),
        StoredQueue,
      );
      const scope: Scope.Scope = yield* Effect.scope;
      const storageLock = yield* Semaphore.make(1);
      const wake = yield* Queue.dropping<void>(1);

      const queue: Array<LiveSubmission> = [];
      const pending = Signal.make<ReadonlyArray<ActionOutboxEntry>>([], {
        name: "ActionOutbox.pending",
      });
      const failures = Signal.make<ReadonlyArray<ActionOutboxFailure>>([], {
        name: "ActionOutbox.failures",
      });
      let restored = false;
      let worker: Fiber.Fiber<never> | undefined;

      const commit = (
        action: string,
        event: TimelineActionCause["event"],
        nextFailure?: ActionOutboxFailure,
      ): void => {
        Signal.batch(
          () => {
            pending.set(queue.map(toEntry));
            if (nextFailure !== undefined) {
              failures.set([...failures.get(), nextFailure]);
            }
          },
          { cause: { _tag: "Action", action, event } },
        );
      };

      // ---- storage: read-modify-write under one lock, so concurrent
      // submissions (and other tabs' entries) are never dropped.
      const readStored: Effect.Effect<
        ReadonlyArray<StoredSubmission>,
        KeyValueStore.KeyValueStoreError
      > = store.get(key).pipe(
        Effect.map(
          Option.match({
            onNone: (): ReadonlyArray<StoredSubmission> => [],
            onSome: (stored) => stored.submissions,
          }),
        ),
        // A value this build cannot decode is replaced by the next write.
        Effect.catchTag("SchemaError", () =>
          Effect.as(
            Effect.logWarning(`Action outbox: ignoring unreadable stored queue at "${key}".`),
            [] as ReadonlyArray<StoredSubmission>,
          ),
        ),
      );

      const writeStored = (submissions: ReadonlyArray<StoredSubmission>) =>
        store.set(key, { submissions });

      const mutateStored = (
        f: (submissions: ReadonlyArray<StoredSubmission>) => ReadonlyArray<StoredSubmission>,
      ): Effect.Effect<void, KeyValueStore.KeyValueStoreError | Schema.SchemaError> =>
        Semaphore.withPermit(
          storageLock,
          Effect.flatMap(readStored, (submissions) => writeStored(f(submissions))),
        );

      // Bookkeeping writes after a submission settles must not fail replay:
      // the worst case is a stale entry, which the server deduplicates.
      const mutateStoredLogged = (
        f: (submissions: ReadonlyArray<StoredSubmission>) => ReadonlyArray<StoredSubmission>,
      ): Effect.Effect<void> =>
        mutateStored(f).pipe(
          Effect.catch((error) => Effect.logWarning("Action outbox: storage write failed.", error)),
        );

      const removeStored = (id: string) =>
        mutateStoredLogged((submissions) => submissions.filter((record) => record.id !== id));

      // ---- settling

      const remove = (live: LiveSubmission): void => {
        const index = queue.indexOf(live);
        if (index >= 0) {
          queue.splice(index, 1);
        }
      };

      const settleSuccess = (live: LiveSubmission, value: unknown) =>
        Effect.gen(function* () {
          remove(live);
          yield* removeStored(live.record.id);
          commit(live.record.action, "success");
          if (live.waiter !== undefined) {
            yield* Deferred.succeed(live.waiter, value);
          }
        });

      const settleFailure = (live: LiveSubmission, cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          yield* live.transaction.rollback;
          remove(live);
          yield* removeStored(live.record.id);
          const waiter = live.waiter;
          // A waiting caller receives its own failure; otherwise the outbox
          // reports it.
          commit(
            live.record.action,
            "failure",
            waiter === undefined ? { ...toEntry(live), cause } : undefined,
          );
          if (waiter !== undefined) {
            yield* Deferred.failCause(waiter, cause);
          }
        });

      const isExpired = (definition: AnyDurableDefinition, createdAt: number, now: number) =>
        definition.durable === undefined ||
        now - createdAt > Duration.toMillis(definition.durable.maxAge);

      // ---- replay

      /** Sends pending submissions in order; true when a retryable failure stalls the head. */
      const drainPass: Effect.Effect<boolean> = Effect.gen(function* () {
        while (queue.length > 0) {
          const live = queue[0]!;
          const now = yield* Clock.currentTimeMillis;
          if (isExpired(live.definition, live.record.createdAt, now)) {
            yield* settleFailure(
              live,
              Cause.fail(
                new ActionSubmissionExpired({
                  actionName: live.record.action,
                  id: live.record.id,
                  createdAt: live.record.createdAt,
                }),
              ),
            );
            continue;
          }

          live.record = { ...live.record, attempts: live.record.attempts + 1 };
          const attempted = live.record;
          yield* mutateStoredLogged((submissions) =>
            submissions.map((record) => (record.id === attempted.id ? attempted : record)),
          );
          commit(live.record.action, "replay");

          const exit = yield* Effect.exit(
            executeActionEffect({
              definition: live.definition,
              input: live.input,
              transaction: live.transaction,
              site: "client",
              submission: { id: live.record.id },
              beforeApply: Effect.void,
              current: () => true,
            }),
          );
          if (Exit.isSuccess(exit)) {
            yield* settleSuccess(live, exit.value.value);
            continue;
          }
          if (Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.interrupt;
          }
          if (retryableCause(exit.cause)) {
            // Everyone still waiting learns their submission is queued.
            for (const queued of queue) {
              const waiter = queued.waiter;
              queued.waiter = undefined;
              if (waiter !== undefined) {
                yield* Deferred.fail(
                  waiter,
                  new ActionQueued({ actionName: queued.record.action, id: queued.record.id }),
                );
              }
            }
            return true;
          }
          yield* settleFailure(live, exit.cause);
        }
        return false;
        // Replay runs with the runtime context it was triggered from: the
        // services an erased durable definition needs.
      }) as Effect.Effect<boolean>;

      /**
       * One replay loop per outbox: wait for a trigger, drain, and while the
       * head stalls, back off with the schedule (a new trigger restarts it).
       */
      const replayLoop: Effect.Effect<never> = Effect.forever(
        Effect.gen(function* () {
          yield* Queue.take(wake);
          let step = yield* Schedule.toStepWithSleep(replaySchedule);
          while (yield* drainPass) {
            const next = yield* Effect.raceFirst(
              step(undefined).pipe(
                Effect.as("retry" as const),
                Effect.catch(() => Effect.succeed("exhausted" as const)),
              ),
              Queue.take(wake).pipe(Effect.as("woken" as const)),
            );
            if (next === "exhausted") {
              break;
            }
            if (next === "woken") {
              step = yield* Schedule.toStepWithSleep(replaySchedule);
            }
          }
        }),
      );

      /** Starts the replay loop (with the caller's runtime context) and wakes it. */
      const trigger: Effect.Effect<void> = Effect.gen(function* () {
        if (worker === undefined) {
          worker = yield* Effect.forkIn(replayLoop, scope, { startImmediately: true });
        }
        yield* Queue.offer(wake, undefined);
      });

      // Connectivity returning is a replay trigger.
      const target = globalThis as {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      if (typeof target.addEventListener === "function") {
        const onOnline = (): void => {
          if (worker !== undefined) {
            Queue.offerUnsafe(wake, undefined);
          }
        };
        yield* Effect.acquireRelease(
          Effect.sync(() => target.addEventListener!("online", onOnline)),
          () => Effect.sync(() => target.removeEventListener?.("online", onOnline)),
        );
      }

      // ---- submit and restore

      const submit = <I, A, Err, Req>(definition: ActionDefinition<I, A, Err, Req>, input: I) =>
        Effect.gen(function* () {
          const encoded = yield* encodeInput(definition, input);
          const createdAt = yield* Clock.currentTimeMillis;
          const record: StoredSubmission = {
            id: randomSubmissionId(),
            action: definition.name,
            input: encoded,
            createdAt,
            attempts: 0,
          };
          const waiter = yield* Deferred.make<unknown, unknown>();
          const live: LiveSubmission = {
            record,
            definition,
            input,
            transaction: makeActionOptimisticTransactionRuntime(definition.name),
            waiter,
          };
          // Patch, persist, and enqueue as one step: a submission is either
          // fully pending (patch applied, record stored) or not at all.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* applyActionOptimisticEffect(definition, input, live.transaction);
              yield* mutateStored((submissions) => [...submissions, record]).pipe(
                Effect.catch((error) =>
                  Effect.andThen(live.transaction.rollback, Effect.die(error)),
                ),
              );
              queue.push(live);
              commit(definition.name, "queue");
              yield* trigger;
            }),
          );
          return (yield* Deferred.await(waiter).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                live.waiter = undefined;
              }),
            ),
          )) as A;
        }) as Effect.Effect<A, Err | Schema.SchemaError | ActionQueued>;

      const droppedFailure = (
        record: StoredSubmission,
        input: unknown,
        error: ActionSubmissionUnrestorable | ActionSubmissionExpired | Cause.Cause<unknown>,
      ): ActionOutboxFailure => ({
        id: record.id,
        action: record.action,
        input,
        createdAt: record.createdAt,
        attempts: record.attempts,
        cause: Cause.isCause(error) ? error : Cause.fail(error),
      });

      const unrestorable = (
        record: StoredSubmission,
        reason: ActionSubmissionUnrestorable["reason"],
        cause?: unknown,
      ): ActionOutboxFailure =>
        droppedFailure(
          record,
          record.input,
          new ActionSubmissionUnrestorable({
            actionName: record.action,
            id: record.id,
            reason,
            ...(cause === undefined ? {} : { cause }),
          }),
        );

      const restore = (options: ActionOutboxRestoreOptions = {}): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (restored) {
            return;
          }
          restored = true;
          const stored = yield* readStored.pipe(
            Effect.catch((error) =>
              Effect.as(
                Effect.logWarning("Action outbox: could not read pending submissions.", error),
                [] as ReadonlyArray<StoredSubmission>,
              ),
            ),
          );
          const now = yield* Clock.currentTimeMillis;
          const restoredLive: Array<LiveSubmission> = [];
          const dropped: Array<ActionOutboxFailure> = [];
          const owned = new Set(queue.map((live) => live.record.id));
          const settled = new Set(options.settled);

          for (const record of stored) {
            if (owned.has(record.id)) {
              continue;
            }
            const definition = getActionDefinition<AnyDurableDefinition>(record.action);
            if (definition === undefined || definition.durable === undefined) {
              dropped.push(unrestorable(record, "UnknownAction"));
              continue;
            }
            const decoded = yield* Effect.exit(decodeInput(definition, record.input));
            if (Exit.isFailure(decoded)) {
              dropped.push(unrestorable(record, "InvalidInput", Cause.squash(decoded.cause)));
              continue;
            }
            const input = decoded.value;
            if (isExpired(definition, record.createdAt, now)) {
              dropped.push(
                droppedFailure(
                  record,
                  input,
                  new ActionSubmissionExpired({
                    actionName: record.action,
                    id: record.id,
                    createdAt: record.createdAt,
                  }),
                ),
              );
              continue;
            }
            const transaction = makeActionOptimisticTransactionRuntime(definition.name);
            // Re-apply the patch on top of the hydrated state, in submission
            // order, unless the server settled the submission before rendering
            // that state: it already reflects the outcome, and the replay only
            // fetches the recorded response.
            const patched = yield* Effect.exit(
              settled.has(record.id)
                ? Effect.void
                : applyActionOptimisticEffect(definition, input, transaction),
            );
            if (Exit.isFailure(patched)) {
              yield* transaction.rollback;
              dropped.push(droppedFailure(record, input, patched.cause));
              continue;
            }
            restoredLive.push({ record, definition, input, transaction, waiter: undefined });
          }

          // Restored submissions are older than any made this session.
          queue.unshift(...restoredLive);
          if (dropped.length > 0) {
            const droppedIds = new Set(dropped.map((failure) => failure.id));
            yield* mutateStoredLogged((submissions) =>
              submissions.filter((record) => !droppedIds.has(record.id)),
            );
          }
          Signal.batch(
            () => {
              pending.set(queue.map(toEntry));
              if (dropped.length > 0) {
                failures.set([...failures.get(), ...dropped]);
              }
            },
            {
              cause: {
                _tag: "Action",
                action: restoredLive[0]?.record.action ?? dropped[0]?.action ?? "ActionOutbox",
                event: "restore",
              },
            },
          );
          if (queue.length > 0) {
            yield* trigger;
          }
          // Optimistic patches re-apply with the restoring runtime's context.
        }) as Effect.Effect<void>;

      const dismiss = (id: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const current = failures.get();
          const failure = current.find((entry) => entry.id === id);
          if (failure === undefined) {
            return;
          }
          Signal.batch(() => failures.set(current.filter((entry) => entry.id !== id)), {
            cause: { _tag: "Action", action: failure.action, event: "dismiss" },
          });
        });

      const outbox: ActionOutbox = {
        pending,
        failures,
        dismiss,
        submit: submit as ActionOutbox["submit"],
        restore,
      };
      return outbox;
    }),
  );
