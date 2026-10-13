import { Cause, Deferred, Effect, Exit, Option, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import {
  Machine,
  type ActorRef,
  type Durability,
  type Inspector,
  type Recovery,
} from "effect-machine";
import { EffectInputCallbackError } from "./effect-like.js";
import {
  StateDefect,
  StateDisposed,
  StateRefTypeId,
  type StateDefinition,
  type StateDispatchError,
  type StateError,
  type StateFailure,
  type StateInstance,
  type StatePhase,
  type StateTagged,
} from "./state-contract.js";
import { makeStateFailure, validateStateMessage } from "./state-primitives.js";
import type { AnySunfallArcRuntime } from "./runtime.js";
import { SignalWrites } from "./signal.js";
import { readSignalOptimisticBase, writeSignalOptimisticBase } from "./signal-optimistic-layer.js";
import type { TimelineStateCause } from "./timeline.js";
import { batchSignalWrites, recordSignalEvent } from "./signal-transaction.js";

/** How an instance starts: its machine's initial state, or a model hydrated from a server render. */
export type StateStartModel<Model> =
  | { readonly _tag: "Initial" }
  | { readonly _tag: "Hydrated"; readonly model: Model }
  | { readonly _tag: "Rejected"; readonly error: Schema.SchemaError };

export interface StateRuntimeInstanceOptions<Model, Message, R, ER> {
  readonly definition: StateDefinition<Model, Message, R>;
  readonly runtime: AnySunfallArcRuntime<ER>;
  readonly scope:
    | {
        addFinalizer(finalizer: () => Effect.Effect<void>): void;
      }
    | undefined;
  readonly start?: StateStartModel<Model>;
  /**
   * Leave the machine unstarted until `beginState(instance)`: a hydrating
   * renderer starts it once hydration settles, so a restored model or work
   * that sends at once cannot change the model under the server's markup.
   * Messages sent before then wait for it.
   */
  readonly deferred?: boolean;
}

const pendingStarts = new WeakMap<object, () => void>();

/** Starts a State created with `deferred` (once); a started State is left alone. */
export const beginState = (instance: object): void => {
  const begin = pendingStarts.get(instance);
  pendingStarts.delete(instance);
  begin?.();
};

let instanceSequence = 0;

const persistKey = (definition: StateDefinition<any, any, any>): string | undefined =>
  definition.persist === undefined
    ? undefined
    : `arc/states/v${definition.persist.version ?? 1}/${definition.persist.key}`;

/**
 * Runs a State's machine as an effect-machine actor and makes Arc the owner
 * of what it commits: every processed message lands on the model signal in
 * one Timeline entry named by the message (through the actor's durability
 * hook, which runs inside the actor's transition before `call` settles), so
 * Timeline travel, Action optimistic overlays, the fine-grained Solid view,
 * and devtools all read one cell. Persistence and SSR hydration use the
 * actor's own `recovery` and `hydrate` seams.
 */
export const makeStateRuntimeInstance = <
  Model extends StateTagged,
  Message extends StateTagged,
  R = never,
  ER = never,
>(
  options: StateRuntimeInstanceOptions<Model, Message, R, ER>,
): StateInstance<Model, Message, ER> => {
  const { definition, runtime, scope } = options;
  const { machine } = definition;
  const instance = ++instanceSequence;
  const start = options.start ?? { _tag: "Initial" };
  const initial = machine.initial as Model;
  const startModel = start._tag === "Hydrated" ? start.model : initial;
  const model = SignalWrites.make<Model>(startModel, { name: definition.name });
  const failures = SignalWrites.make<ReadonlyArray<StateFailure<Message, StateError<ER>>>>([], {
    name: `${definition.name}.failures`,
  });
  const key = persistKey(definition);
  const disposedSignal = Effect.runSync(Deferred.make<void>());
  let disposed = false;

  type RuntimeFailure = StateError<ER>;
  type DispatchFailure = StateDispatchError<ER>;

  /** Timeline cause for this instance's entries. */
  const cause = (
    event: TimelineStateCause["event"],
    fields: { readonly message?: Message; readonly model?: Model } = {},
  ): TimelineStateCause => ({
    _tag: "State",
    state: definition.name,
    instance,
    event,
    ...fields,
  });

  const recordFailure = (failure: StateFailure<Message, RuntimeFailure>): void => {
    if (disposed) {
      return;
    }
    batchSignalWrites(
      () => failures.update((current) => [...current, failure]),
      cause("failure", failure.message === undefined ? {} : { message: failure.message }),
    );
  };

  /** Commits what the machine committed: one entry, named by the message. */
  const commit = (next: Model, message: Message): void => {
    if (disposed) {
      return;
    }
    if (Object.is(readSignalOptimisticBase(model), next)) {
      recordSignalEvent(cause("message", { message }));
      return;
    }
    // Messages land on the base; in-flight optimistic patches re-apply over it.
    batchSignalWrites(() => writeSignalOptimisticBase(model, next), cause("message", { message }));
  };

  const save = (next: Model): Effect.Effect<void> =>
    key === undefined
      ? Effect.void
      : Effect.gen(function* () {
          const store = yield* Effect.serviceOption(KeyValueStore.KeyValueStore);
          if (Option.isNone(store)) {
            return;
          }
          const encoded = yield* Schema.encodeUnknownEffect(machine.stateSchema)(next);
          yield* store.value.set(key, JSON.stringify(encoded));
        }).pipe(
          Effect.catchCause((failure) =>
            Effect.logWarning(`State "${definition.name}": could not persist its model.`, failure),
          ),
        );

  const durability: Durability<Model, Message> = {
    save: (committed) =>
      Effect.sync(() => commit(committed.nextState, committed.event)).pipe(
        Effect.andThen(save(committed.nextState)),
      ),
  };

  const recovery: Recovery<Model> | undefined =
    key === undefined
      ? undefined
      : {
          resolve: () =>
            Effect.gen(function* () {
              const store = yield* Effect.serviceOption(KeyValueStore.KeyValueStore);
              if (Option.isNone(store)) {
                return Option.none<Model>();
              }
              const stored = yield* store.value.get(key);
              if (typeof stored !== "string") {
                return Option.none<Model>();
              }
              const parsed = yield* Effect.try(() => JSON.parse(stored) as unknown);
              const restored = yield* Schema.decodeUnknownEffect(machine.stateSchema)(parsed);
              return Option.some(restored as Model);
            }).pipe(
              Effect.catchCause((failure) =>
                Effect.as(
                  Effect.logWarning(
                    `State "${definition.name}": ignoring an unreadable persisted model.`,
                    failure,
                  ),
                  Option.none<Model>(),
                ),
              ),
            ),
        };

  const inspect: Inspector<Model, Message> = {
    onInspect: (event) => {
      if (event.type === "@machine.error") {
        recordFailure(
          makeStateFailure<Message, RuntimeFailure>(
            event.phase === "spawn" ? "Work" : "Update",
            new StateDefect({ phase: event.phase, description: event.error }),
            event.event,
          ),
        );
      } else if (event.type === "@machine.task" && event.phase === "defect") {
        recordFailure(
          makeStateFailure<Message, RuntimeFailure>(
            "Work",
            new StateDefect({ phase: "spawn", description: event.error ?? "task defect" }),
          ),
        );
      }
    },
  };

  const startupFailure = (phase: StatePhase, failure: Cause.Cause<unknown>): void =>
    recordFailure(
      makeStateFailure<Message, RuntimeFailure>(
        phase,
        Cause.hasFails(failure)
          ? (Cause.squash(failure) as RuntimeFailure)
          : new EffectInputCallbackError({
              operation: "State.start",
              cause: Cause.squash(failure),
              guidance: "The State's machine could not start on this runtime.",
            }),
      ),
    );

  recordSignalEvent(cause("start", { model: startModel }));
  if (start._tag === "Rejected") {
    recordFailure(makeStateFailure<Message, RuntimeFailure>("Hydrate", start.error));
  }

  // The actor captures the runtime's services when it is spawned: its
  // transitions, work, and persistence run with them.
  const spawned = Effect.runSyncExit(
    runtime.provide(
      Machine.spawn(machine, {
        id: `${definition.name}#${instance}`,
        ...(start._tag === "Hydrated" ? { hydrate: start.model } : {}),
        lifecycle: { durability, ...(recovery === undefined ? {} : { recovery }) },
        inspect,
      }) as Effect.Effect<ActorRef<Model, Message>>,
    ),
  );
  const actor = Exit.isSuccess(spawned) ? spawned.value : undefined;
  if (Exit.isFailure(spawned)) {
    startupFailure("Update", spawned.cause);
  }

  const begin = (): void => {
    if (actor === undefined || disposed) {
      return;
    }
    Effect.runFork(
      actor.start.pipe(
        Effect.andThen(
          Effect.sync(() => {
            // A restored model: the actor recovered it before processing any message.
            const restored = actor.sync.snapshot();
            if (!disposed && !Object.is(restored, readSignalOptimisticBase(model))) {
              batchSignalWrites(
                () => writeSignalOptimisticBase(model, restored),
                cause("restore", { model: restored }),
              );
            }
          }),
        ),
        Effect.catchCause((failure) => Effect.sync(() => startupFailure("Update", failure))),
      ),
    );
  };

  const disposedFailure = (message: Message): StateFailure<Message, DispatchFailure> =>
    makeStateFailure(
      "Update",
      new StateDisposed({ reason: "State was disposed before the message was processed." }),
      message,
    );

  const dispatch = (
    message: Message,
  ): Effect.Effect<void, StateFailure<Message, DispatchFailure>> =>
    Effect.suspend(() => {
      if (disposed || actor === undefined) {
        return Effect.fail(disposedFailure(message));
      }
      const invalid = validateStateMessage(definition, message);
      if (invalid !== undefined) {
        const failure = makeStateFailure<Message, RuntimeFailure>("Update", invalid, message);
        recordFailure(failure);
        return Effect.fail(failure);
      }
      return actor.call(message).pipe(
        Effect.raceFirst(Deferred.await(disposedSignal).pipe(Effect.as(undefined))),
        Effect.exit,
        Effect.flatMap((exit) => {
          if (Exit.isFailure(exit)) {
            const failure = makeStateFailure<Message, RuntimeFailure>(
              "Update",
              new StateDefect({
                phase: "transition",
                description: String(Cause.squash(exit.cause)),
              }),
              message,
            );
            recordFailure(failure);
            return Effect.fail(failure);
          }
          if (exit.value === undefined) {
            return Effect.fail(disposedFailure(message));
          }
          if (!exit.value.transitioned && !disposed) {
            recordSignalEvent(cause("ignored", { message }));
          }
          return Effect.void;
        }),
      );
    });

  const dispose = Effect.suspend(() => {
    if (disposed) {
      return Effect.void;
    }
    disposed = true;
    return Deferred.succeed(disposedSignal, undefined).pipe(
      Effect.andThen(actor === undefined ? Effect.void : actor.stop),
      Effect.catchCause(() => Effect.void),
      Effect.asVoid,
    );
  });

  scope?.addFinalizer(() => dispose);

  const instanceHandle: StateInstance<Model, Message, ER> = {
    [StateRefTypeId]: model,
    model,
    failures,
    dispatch,
    can: (message) => {
      // Read the model so the answer is reactive.
      model.get();
      return actor !== undefined && !disposed && actor.sync.can(message);
    },
    clearFailures: () => batchSignalWrites(() => failures.set([]), cause("clearFailures")),
    dispose,
  };
  if (options.deferred === true) {
    pendingStarts.set(instanceHandle, begin);
  } else {
    begin();
  }
  return instanceHandle;
};
