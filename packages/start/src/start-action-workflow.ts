import {
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import { Activity, Workflow, WorkflowEngine } from "effect/workflow";
import type { AnySunfallArcRuntime } from "@sunfall/arc-core";

/**
 * The response the action endpoint produced for one durable submission: the
 * Action's outcome (value, typed failure, validation, or redirect) encoded
 * with its schemas, plus the hydration and invalidation metadata it carried.
 * It is the workflow's success value, so a replay returns it unchanged.
 */
const ActionResponseRecord = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  body: Schema.String,
});
type ActionResponseRecord = typeof ActionResponseRecord.Type;

const SubmissionPayload = Schema.Struct({
  /**
   * The submitting browser's owner key (the digest of its submitter token).
   * With `id` it forms the idempotency key, so an execution belongs to the
   * browser that started it: the same id from another browser is a different
   * execution and never sees this one's response.
   */
  owner: Schema.String,
  /** The submission id, unique within its submitter. */
  id: Schema.String,
  /** The encoded Action input, as the client sent it. */
  input: Schema.Unknown,
});

type SubmissionWorkflow = Workflow.Workflow<
  string,
  typeof SubmissionPayload,
  typeof ActionResponseRecord,
  Schema.Never
>;

/** One Workflow per Action name (its tag), shared by every handler. */
const workflows = new Map<string, SubmissionWorkflow>();

type Engine = WorkflowEngine.WorkflowEngine["Service"];

/**
 * Per engine: the Actions registered with it, and the Activity bodies of its
 * in-flight executions (keyed by Action name and submission key). Handlers that
 * share an engine share both, so any of them can run an execution.
 */
interface EngineRegistrations {
  readonly actions: Set<string>;
  readonly producers: Map<string, Effect.Effect<ActionResponseRecord>>;
  /** Owns the registrations (and, for an in-memory generation, the engine). */
  readonly scope: Scope.Closeable;
}

/** Registrations on a server-provided engine live as long as the engine. */
const providedEngines = new WeakMap<object, EngineRegistrations>();

/**
 * One generation of a durable Action's in-memory engine.
 *
 * `WorkflowEngine.layerMemory` never forgets an execution, so the default
 * engine rotates: new submissions go to the newest generation, a generation
 * stops taking new submissions once it is `maxAge` old, and it is closed (with
 * every record it holds) once it has nothing in flight and its last execution
 * settled `maxAge` ago. A client replays a submission only within `maxAge` of
 * creating it, which is before the server first saw it, so every record lives
 * as long as a replay can still reach it, and memory holds at most about two
 * `maxAge` windows of submissions.
 */
interface MemoryGeneration {
  readonly engine: Engine;
  readonly registrations: EngineRegistrations;
  readonly openedAt: number;
  /** The submission keys (owner and id) this generation holds. */
  readonly keys: Set<string>;
  inFlight: number;
  settledAt: number;
}

/** A durable Action's in-memory engine generations, oldest first. */
interface MemoryLane {
  readonly generations: Array<MemoryGeneration>;
  /** The generation holding each live submission, by submission key. */
  readonly byKey: Map<string, MemoryGeneration>;
}

/** Per-handler state: the in-memory engines used when the server Layer provides none. */
export interface StartActionWorkflows {
  readonly lanes: Map<string, MemoryLane>;
  readonly lock: Semaphore.Semaphore;
}

export const makeStartActionWorkflows = (): StartActionWorkflows => ({
  lanes: new Map(),
  lock: Semaphore.makeUnsafe(1),
});

/** The durability facts of the Action a submission belongs to. */
export interface DurableSubmissionAction {
  readonly name: string;
  readonly durable: { readonly maxAge: Duration.Input };
}

/** One submitter's submission: its owner key and id. */
export interface SubmissionKey {
  readonly owner: string;
  readonly id: string;
}

const submissionKey = (key: SubmissionKey): string => `${key.owner}\u0000${key.id}`;

const producerKey = (actionName: string, key: SubmissionKey): string =>
  `${actionName}\u0000${submissionKey(key)}`;

const workflowFor = (actionName: string): SubmissionWorkflow => {
  const existing = workflows.get(actionName);
  if (existing !== undefined) {
    return existing;
  }
  const workflow: SubmissionWorkflow = Workflow.make(`sunfall-arc/action/${actionName}`, {
    payload: SubmissionPayload,
    idempotencyKey: submissionKey,
    success: ActionResponseRecord,
  });
  workflows.set(actionName, workflow);
  return workflow;
};

const makeRegistrations = (scope: Scope.Closeable): EngineRegistrations => ({
  actions: new Set(),
  producers: new Map(),
  scope,
});

const providedRegistrationsFor = (engine: object): EngineRegistrations => {
  let registrations = providedEngines.get(engine);
  if (registrations === undefined) {
    registrations = makeRegistrations(Scope.makeUnsafe());
    providedEngines.set(engine, registrations);
  }
  return registrations;
};

const openMemoryGeneration = (now: number): Effect.Effect<MemoryGeneration> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(WorkflowEngine.layerMemory, scope);
    return {
      engine: Context.get(context, WorkflowEngine.WorkflowEngine),
      registrations: makeRegistrations(scope),
      openedAt: now,
      keys: new Set(),
      inFlight: 0,
      settledAt: now,
    };
  });

/**
 * Picks the in-memory generation for one submission and counts it in flight:
 * the generation already holding it (a replay or a duplicate), else the
 * newest open one. Closes generations whose records no client can still replay.
 */
const acquireMemoryGeneration = (
  state: StartActionWorkflows,
  action: DurableSubmissionAction,
  submission: SubmissionKey,
): Effect.Effect<MemoryGeneration> =>
  state.lock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const maxAge = Duration.toMillis(action.durable.maxAge);
      let lane = state.lanes.get(action.name);
      if (lane === undefined) {
        lane = { generations: [], byKey: new Map() };
        state.lanes.set(action.name, lane);
      }
      const newest = lane.generations.at(-1);
      if (newest === undefined || now - newest.openedAt >= maxAge) {
        lane.generations.push(yield* openMemoryGeneration(now));
      }
      const current = lane.generations.at(-1)!;
      for (const generation of lane.generations.slice(0, -1)) {
        if (generation.inFlight === 0 && now - generation.settledAt >= maxAge) {
          lane.generations.splice(lane.generations.indexOf(generation), 1);
          for (const retired of generation.keys) {
            lane.byKey.delete(retired);
          }
          yield* Scope.close(generation.registrations.scope, Exit.void);
        }
      }
      const key = submissionKey(submission);
      const generation = lane.byKey.get(key) ?? current;
      generation.keys.add(key);
      lane.byKey.set(key, generation);
      generation.inFlight++;
      return generation;
    }),
  );

const releaseMemoryGeneration = (generation: MemoryGeneration): Effect.Effect<void> =>
  Effect.map(Clock.currentTimeMillis, (now) => {
    generation.inFlight--;
    generation.settledAt = Math.max(generation.settledAt, now);
  });

const providedEngineOf = (
  runtime: AnySunfallArcRuntime<unknown>,
): Effect.Effect<Option.Option<Engine>> =>
  runtime
    .provide(Effect.serviceOption(WorkflowEngine.WorkflowEngine))
    .pipe(Effect.catchCause(() => Effect.succeedNone));

/**
 * The engine one submission runs on: the server Layer's `WorkflowEngine`, or
 * the handler's in-memory generation for the submission's Action.
 */
const withSubmissionEngine = <A, R>(
  state: StartActionWorkflows,
  runtime: AnySunfallArcRuntime<unknown>,
  action: DurableSubmissionAction,
  submission: SubmissionKey,
  use: (engine: Engine, registrations: EngineRegistrations) => Effect.Effect<A, never, R>,
): Effect.Effect<A, never, R> =>
  Effect.gen(function* () {
    const provided = yield* providedEngineOf(runtime);
    if (Option.isSome(provided)) {
      return yield* use(provided.value, providedRegistrationsFor(provided.value));
    }
    return yield* Effect.acquireUseRelease(
      acquireMemoryGeneration(state, action, submission),
      (generation) => use(generation.engine, generation.registrations),
      releaseMemoryGeneration,
    );
  });

const registerOnce = (
  engine: Engine,
  registrations: EngineRegistrations,
  actionName: string,
  workflow: SubmissionWorkflow,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (registrations.actions.has(actionName)) {
      return Effect.void;
    }
    registrations.actions.add(actionName);
    // The Activity is the Action's side effect: running it at the endpoint
    // and encoding the response. An engine that already completed this
    // execution (same idempotency key) returns the recorded response without
    // running it again.
    return engine
      .register(workflow, (payload) =>
        Activity.make({
          name: `${actionName}.run`,
          success: ActionResponseRecord,
          execute: Effect.suspend(
            () =>
              registrations.producers.get(producerKey(actionName, payload)) ??
              Effect.die(
                new Error(
                  `Durable submission ${payload.id} of Action "${actionName}" resumed without a request to run it.`,
                ),
              ),
          ),
        }),
      )
      .pipe(Effect.provideService(Scope.Scope, registrations.scope));
  });

const toRecord = (response: Response): Effect.Effect<ActionResponseRecord> =>
  Effect.map(
    Effect.promise(() => response.text()),
    (body) => {
      const headers: Array<readonly [string, string]> = [];
      response.headers.forEach((value, name) => headers.push([name, value]));
      return { status: response.status, headers, body };
    },
  );

const fromRecord = (record: ActionResponseRecord): Response =>
  new Response(record.body, {
    status: record.status,
    headers: record.headers.map(([name, value]) => [name, value] as [string, string]),
  });

/**
 * Runs one durable submission as a Workflow execution keyed by its submitter
 * and id: `produce` (decode, run the Action, encode the response) is the
 * Activity, so the same browser replaying an id gets the original response
 * without running it again, and a duplicate that arrives mid-run joins the
 * running execution. Another browser sending the same id starts its own.
 */
export const runActionSubmissionWorkflow = <E, R>(
  state: StartActionWorkflows,
  runtime: AnySunfallArcRuntime<unknown>,
  action: DurableSubmissionAction,
  submission: SubmissionKey & { readonly input: unknown },
  produce: Effect.Effect<Response, E, R>,
): Effect.Effect<Response, never, R> =>
  Effect.gen(function* () {
    const workflow = workflowFor(action.name);
    // The engine runs the Activity on its own fiber: hand it the request's
    // context, so `run` sees the request runtime's services.
    const context = yield* Effect.context<R>();
    const producer = produce.pipe(
      Effect.orDie,
      Effect.flatMap(toRecord),
      Effect.provideContext(context),
    ) as Effect.Effect<ActionResponseRecord>;
    const key = producerKey(action.name, submission);

    return yield* withSubmissionEngine(
      state,
      runtime,
      action,
      submission,
      (engine, registrations) =>
        Effect.gen(function* () {
          const producers = registrations.producers;
          yield* registerOnce(engine, registrations, action.name, workflow);
          const owns = !producers.has(key);
          if (owns) {
            producers.set(key, producer);
          }
          const record = yield* workflow
            .execute({ owner: submission.owner, id: submission.id, input: submission.input })
            .pipe(
              Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
              Effect.ensuring(
                Effect.sync(() => {
                  if (owns && producers.get(key) === producer) {
                    producers.delete(key);
                  }
                }),
              ),
            );
          return fromRecord(record);
        }),
    );
  });

/**
 * The ids among a browser's `pending` durable submissions that already
 * settled on this server: their outcome is in the state the server renders
 * next, so the client restores them without re-applying their patch. Only the
 * requesting browser's own executions (`owner`) count, so the answer never
 * confirms another browser's ids; a browser without a submitter owns none. A
 * submission still running, unknown, or unreadable counts as unsettled, which
 * keeps the client's patch.
 */
export const settledActionSubmissionsEffect = (
  state: StartActionWorkflows,
  runtime: AnySunfallArcRuntime<unknown>,
  actions: ReadonlyMap<string, { readonly durable?: unknown }>,
  owner: Option.Option<string>,
  pending: ReadonlyArray<{ readonly action: string; readonly id: string }>,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    if (pending.length === 0 || Option.isNone(owner)) {
      return [];
    }
    const provided = yield* providedEngineOf(runtime);
    const settled: Array<string> = [];
    for (const { action, id } of pending) {
      if (actions.get(action)?.durable === undefined) {
        continue;
      }
      const key = { owner: owner.value, id };
      const engine = Option.isSome(provided)
        ? provided.value
        : state.lanes.get(action)?.byKey.get(submissionKey(key))?.engine;
      if (engine === undefined) {
        continue;
      }
      const workflow = workflowFor(action);
      const result = yield* workflow.executionId({ ...key, input: null }).pipe(
        Effect.flatMap((executionId) => engine.poll(workflow, executionId)),
        Effect.catchCause(() => Effect.succeedNone),
      );
      if (Option.isSome(result) && result.value._tag === "Complete") {
        settled.push(id);
      }
    }
    return settled;
  });
