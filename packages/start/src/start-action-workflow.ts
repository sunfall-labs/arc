import { Context, Deferred, Effect, Layer, Option, Schema, Scope } from "effect";
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
  /** The submission id: the workflow's idempotency key. */
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

/**
 * Per engine: the Actions registered with it, and the Activity bodies of its
 * in-flight executions (keyed by Action name and submission id). Handlers that
 * share an engine share both, so any of them can run an execution.
 */
interface EngineRegistrations {
  readonly actions: Set<string>;
  readonly producers: Map<string, Effect.Effect<ActionResponseRecord>>;
  /** Registrations live as long as the process. */
  readonly scope: Scope.Closeable;
}
const engines = new WeakMap<object, EngineRegistrations>();

/** Per-handler state: the in-memory engine used when the server Layer provides none. */
export interface StartActionWorkflows {
  readonly scope: Scope.Closeable;
  readonly defaultEngine: Deferred.Deferred<WorkflowEngine.WorkflowEngine["Service"]>;
  defaultEngineStarted: boolean;
}

export const makeStartActionWorkflows = (): StartActionWorkflows => ({
  scope: Scope.makeUnsafe(),
  defaultEngine: Deferred.makeUnsafe(),
  defaultEngineStarted: false,
});

const producerKey = (actionName: string, id: string): string => `${actionName}\u0000${id}`;

const workflowFor = (actionName: string): SubmissionWorkflow => {
  const existing = workflows.get(actionName);
  if (existing !== undefined) {
    return existing;
  }
  const workflow: SubmissionWorkflow = Workflow.make(`sunfall-arc/action/${actionName}`, {
    payload: SubmissionPayload,
    idempotencyKey: (payload) => payload.id,
    success: ActionResponseRecord,
  });
  workflows.set(actionName, workflow);
  return workflow;
};

const registrationsFor = (engine: object): EngineRegistrations => {
  let registrations = engines.get(engine);
  if (registrations === undefined) {
    registrations = { actions: new Set(), producers: new Map(), scope: Scope.makeUnsafe() };
    engines.set(engine, registrations);
  }
  return registrations;
};

/** The server Layer's `WorkflowEngine`, or the handler's in-memory one. */
const engineFor = (
  state: StartActionWorkflows,
  runtime: AnySunfallArcRuntime<unknown>,
): Effect.Effect<WorkflowEngine.WorkflowEngine["Service"]> =>
  Effect.gen(function* () {
    const provided = yield* runtime
      .provide(Effect.serviceOption(WorkflowEngine.WorkflowEngine))
      .pipe(Effect.catchCause(() => Effect.succeedNone));
    if (Option.isSome(provided)) {
      return provided.value;
    }
    if (!state.defaultEngineStarted) {
      state.defaultEngineStarted = true;
      yield* Layer.buildWithScope(WorkflowEngine.layerMemory, state.scope).pipe(
        Effect.map((context) => Context.get(context, WorkflowEngine.WorkflowEngine)),
        Effect.flatMap((engine) => Deferred.succeed(state.defaultEngine, engine)),
      );
    }
    return yield* Deferred.await(state.defaultEngine);
  });

const registerOnce = (
  engine: WorkflowEngine.WorkflowEngine["Service"],
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
              registrations.producers.get(producerKey(actionName, payload.id)) ??
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
 * Runs one durable submission as a Workflow execution keyed by its id:
 * `produce` (decode, run the Action, encode the response) is the Activity,
 * so a replayed id returns the original response without running it again,
 * and a duplicate that arrives mid-run joins the running execution.
 */
export const runActionSubmissionWorkflow = <E, R>(
  state: StartActionWorkflows,
  runtime: AnySunfallArcRuntime<unknown>,
  actionName: string,
  submission: { readonly id: string; readonly input: unknown },
  produce: Effect.Effect<Response, E, R>,
): Effect.Effect<Response, never, R> =>
  Effect.gen(function* () {
    const workflow = workflowFor(actionName);
    const engine = yield* engineFor(state, runtime);
    const registrations = registrationsFor(engine);
    const producers = registrations.producers;
    yield* registerOnce(engine, registrations, actionName, workflow);

    const key = producerKey(actionName, submission.id);
    // The engine runs the Activity on its own fiber: hand it the request's
    // context, so `run` sees the request runtime's services.
    const context = yield* Effect.context<R>();
    const producer = produce.pipe(
      Effect.orDie,
      Effect.flatMap(toRecord),
      Effect.provideContext(context),
    ) as Effect.Effect<ActionResponseRecord>;
    const owns = !producers.has(key);
    if (owns) {
      producers.set(key, producer);
    }
    const record = yield* workflow.execute({ id: submission.id, input: submission.input }).pipe(
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
  });
