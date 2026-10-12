import { Effect, Option, type Layer, Schema } from "effect";
import type { ActionResultInvalidationRequirements } from "./action-result.js";
import { ActionInterrupted, type ActionState } from "./action-submission.js";
import {
  ActionOutbox,
  emptyActionOutboxView,
  type ActionDurablePolicy,
  type ActionOutboxEntry,
  type ActionOutboxFailure,
  type ActionOutboxOptions,
  type ActionOutboxRestoreOptions,
  type ActionOutboxView,
  type ActionQueued,
} from "./action-outbox.js";
import { makeActionOutboxLayer } from "./action-outbox-layer.js";
import type {
  ActionClientError,
  ActionTransportResponse,
  ActionTransportSubmission,
} from "./action-transport.js";
import type { KeyValueStore } from "effect/persistence";
import {
  makeActionOptimisticPlanRuntime,
  type ActionOptimisticChange,
  type ActionOptimisticRowUpdate,
  type ActionOptimisticTransaction,
} from "./action-optimistic.js";
import { applyActionOptimistic, invalidationsFor } from "./action-execution-workflow.js";
import { makeActionInstance } from "./action-instance.js";
import { registerActionDefinition } from "./definition-registry.js";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput,
} from "./effect-like.js";
import {
  Resource,
  type ResourceInvalidation,
  type ResourceInvalidationPlan,
  type RetrySchedule,
} from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";
import type { AnySunfallArcRuntime, SunfallArcRuntime } from "./runtime.js";
import type { ReadableSignal } from "./signal.js";

/** Expert-public structural marker used to recognize Action Definitions. */
export const ActionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/Action",
) as typeof ActionTypeId;

/**
 * Submission concurrency mode for one stateful Action Instance.
 *
 * `latest` interrupts the previous submission, `parallel` allows every
 * submission to run, and `exhaust` reuses the current in-flight submission
 * until it completes.
 */
export type ActionConcurrency = "latest" | "parallel" | "exhaust";

/** Runtime policy for submissions, including concurrency and retry behavior. */
export interface ActionPolicy<E = never> {
  /**
   * Submission policy for one action instance.
   *
   * `latest` interrupts older submissions, `parallel` allows all submissions,
   * and `exhaust` joins the in-flight submission while one is pending.
   */
  readonly concurrency?: ActionConcurrency;
  /** Effect retry schedule applied around the action `run` Effect. */
  readonly retry?: RetrySchedule<E>;
}

/**
 * Registered action definition used by core actions and Start action transport.
 *
 * Schema metadata is shared with clients for input/output/error validation.
 * `run` stays Effect-first; Promise-shaped callbacks are rejected by the
 * public types. `optimistic` patches Signals, Resource entries, and Resource rows through its
 * transaction before `run`; the patches fold in on success and roll back on
 * failure or interruption.
 */
export interface ActionDefinition<I, A, E = never, R = never> {
  readonly [ActionTypeId]: typeof ActionTypeId;
  /** Stable registry and transport name for this action. */
  readonly name: string;
  /** Optional schema used to decode submitted input. */
  readonly input?: unknown;
  /** Optional schema used to encode successful output. */
  readonly output?: unknown;
  /** Optional schema used to encode typed failures. */
  readonly error?: unknown;
  /** Concurrency and retry policy for stateful submissions. */
  readonly policy?: ActionPolicy<E>;
  /**
   * Makes submissions durable: each is persisted in the runtime's Action
   * Outbox before it is sent and replayed in order until it settles. Requires
   * an `input` schema (submissions are stored schema-encoded); submitting can
   * then also fail with `ActionQueued`.
   */
  readonly durable?: ActionDurablePolicy;
  /**
   * Effect-first action implementation. Absent on a served Action (defined
   * without `run`): its `run` is the server's `Action.implement(...)`, and
   * clients submit it through the runtime's `ActionTransport`.
   *
   * Direct Effect values are interpreted as work. If the domain value itself is
   * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
   * Interface as data.
   */
  readonly run?: (input: I) => EffectInput<A, E, R>;
  /**
   * Patches Signals, Resource entries, and Resource rows before `run`. The transaction owns
   * every patch: success folds them in, failure or interruption rolls them back.
   */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction,
  ) => Effect.Effect<void, never, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (value: A, input: I) => ReadonlyArray<ResourceInvalidation<R>>;
}

/**
 * Configuration for a mutation-like workflow.
 *
 * `run` may return a value or an Effect, but the action executes it through Effect
 * so retries, interruption, optimistic rollback, and resource invalidation compose.
 */
export interface ActionOptions<I, A, E = never, R = never> {
  /** Stable registry and transport name for this action. */
  readonly name: string;
  /** Optional schema used to decode submitted input. */
  readonly input?: unknown;
  /** Optional schema used to encode successful output. */
  readonly output?: unknown;
  /** Optional schema used to encode typed failures. */
  readonly error?: unknown;
  /** Concurrency and retry policy for stateful submissions. */
  readonly policy?: ActionPolicy<E>;
  /**
   * Effect-first action implementation.
   *
   * Direct Effect values are interpreted as work. If the domain value itself is
   * an Effect, wrap it with `Effect.succeed(effectValue)` so it crosses this
   * Interface as data.
   */
  readonly run: (input: I) => EffectInput<A, E, R>;
  /**
   * Patches Signals, Resource entries, and Resource rows before `run`. The transaction owns
   * every patch: success folds them in, failure or interruption rolls them back.
   */
  readonly optimistic?: (
    input: I,
    transaction: ActionOptimisticTransaction,
  ) => Effect.Effect<void, never, R>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (value: A, input: I) => ReadonlyArray<ResourceInvalidation<R>>;
}

/**
 * Live action controller returned by Action.use.
 *
 * Read state in UI code and submit through submit.
 */
export interface ActionInstance<
  I,
  A,
  E = never,
  R = never,
  DefinitionError = E,
  DefinitionRequirements = R,
  InvalidationRequirements = DefinitionRequirements | ActionResultInvalidationRequirements<A>,
> {
  readonly definition: ActionDefinition<I, A, DefinitionError, DefinitionRequirements>;
  /**
   * Submission state. Failures include `ActionClientError`: a runtime that
   * provides an `ActionTransport` serving this Action submits it remotely. A
   * callback that breaks its contract (throws synchronously) is a defect.
   */
  readonly state: ReadableSignal<ActionState<I, A, E | ActionClientError>>;
  readonly invalidationPlan: ReadableSignal<
    ResourceInvalidationPlan<InvalidationRequirements> | undefined
  >;
  /** Runs the action workflow as an Effect, preserving typed errors and requirements. */
  submit(input: I): Effect.Effect<A, E | ActionClientError | ActionInterrupted, R>;
  /** Resets visible action state as an Effect. */
  reset(): Effect.Effect<void>;
}

/** Runtime options for constructing an Action Instance from a definition. */
export interface ActionUseOptions<R = never, ER = never> {
  /** Runtime that provides action services, the Resource Store, and runtime errors. */
  readonly runtime: SunfallArcRuntime<R, ER>;
}

type AnyActionDefinition = ActionDefinition<any, any, any, any>;
type ActionRuntimeProvidedRequirements<R> = R | ResourceStoreState;
type ActionRuntimeRemainingRequirements<RIn, RProvided> = Exclude<
  RIn,
  ActionRuntimeProvidedRequirements<RProvided>
>;
type CheckedActionRun<I, Definition> = Definition extends {
  readonly run: (input: I) => infer Out;
}
  ? { readonly run: (input: I) => EnsureEffectInput<Out> }
  : never;

type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;
type IsAny<T> = 0 extends 1 & T ? true : false;
type NormalizeRequirements<R> = IsAny<R> extends true ? never : R;

type ActionInvalidatesRequirements<Definition> = Definition extends {
  readonly invalidates?: (...args: any) => infer Invalidations;
}
  ? Invalidations extends ReadonlyArray<infer Invalidation>
    ? Invalidation extends ResourceInvalidation<infer Requirements>
      ? NormalizeRequirements<Requirements>
      : never
    : never
  : never;

type ActionInferredRequirements<Out, Definition, InvalidationRequirements = never> =
  | EffectInputRequirements<Out>
  | NormalizeRequirements<InvalidationRequirements>
  | ActionInvalidatesRequirements<Definition>
  | ActionResultInvalidationRequirements<EffectInputValue<Out>>;

type ActionDefinitionCommonOptions<I, A, E, R, InvalidationRequirements = never> = Omit<
  ActionOptions<I, A, E, R>,
  "input" | "output" | "run" | "invalidates"
> & {
  readonly invalidates?: (
    value: A,
    input: I,
  ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
};

/**
 * Options of a served Action: `Action.define` without `run`. The schemas are
 * the wire contract (`input` is required; `output` defaults to `Schema.Void`
 * and `error` to no typed failure); `run` is the server's
 * `Action.implement(definition, run)`.
 */
export interface ServedActionOptions<
  Input extends Schema.Top,
  Output extends Schema.Top,
  ErrorSchema extends Schema.Top,
  Durable extends ActionDurablePolicy | undefined,
  OptimisticRequirements,
  InvalidationRequirements,
> {
  /** Stable registry and transport name for this action. */
  readonly name: string;
  /** Schema of the submitted input, decoded by the server. */
  readonly input: Input;
  /** Schema of the value `run` succeeds with. */
  readonly output?: Output;
  /** Schema of the typed failures `run` reports. */
  readonly error?: ErrorSchema;
  /** Concurrency and retry policy for stateful submissions. */
  readonly policy?: ActionPolicy<Schema.Schema.Type<ErrorSchema>>;
  /** Makes submissions durable; see `ActionDefinition.durable`. */
  readonly durable?: Durable;
  /** Patches state on the submitting client before the server runs the Action. */
  readonly optimistic?: (
    input: Schema.Schema.Type<Input>,
    transaction: ActionOptimisticTransaction,
  ) => Effect.Effect<void, never, OptimisticRequirements>;
  /** Computes resource invalidations after a successful action value. */
  readonly invalidates?: (
    value: Schema.Schema.Type<Output>,
    input: Schema.Schema.Type<Input>,
  ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
  readonly run?: never;
}

/** The Action a served definition declares: its types come from its schemas. */
export type ServedActionDefinition<
  Input extends Schema.Top,
  Output extends Schema.Top,
  ErrorSchema extends Schema.Top,
  Durable extends ActionDurablePolicy | undefined,
  OptimisticRequirements,
  InvalidationRequirements,
> = ActionDefinition<
  Schema.Schema.Type<Input>,
  Schema.Schema.Type<Output>,
  Schema.Schema.Type<ErrorSchema> | ([Durable] extends [undefined] ? never : ActionQueued),
  | NormalizeRequirements<OptimisticRequirements>
  | NormalizeRequirements<InvalidationRequirements>
  | ActionResultInvalidationRequirements<Schema.Schema.Type<Output>>
>;

type ImplementedActionRun<A, E, Out> =
  EnsureEffectInput<Out> extends never
    ? never
    : [EffectInputValue<Out>] extends [A]
      ? [EffectInputError<Out>] extends [E]
        ? Out
        : never
      : never;

/** Returns true when a value is an Sunfall Arc Action Definition. */
export const isActionDefinition = (value: unknown): value is ActionDefinition<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionTypeId]?: unknown })[ActionTypeId] === ActionTypeId;

/** Helpers for defining and running Effect-first actions. */
export namespace Action {
  /** Public namespace alias for an Action Definition. */
  export type Definition<I, A, E = never, R = never> = ActionDefinition<I, A, E, R>;
  /** Public namespace alias for a live Action Instance. */
  export type Instance<
    I,
    A,
    E = never,
    R = never,
    DefinitionError = E,
    DefinitionRequirements = R,
  > = ActionInstance<I, A, E, R, DefinitionError, DefinitionRequirements>;
  /** Public namespace alias for Action submission state. */
  export type State<I, A, E = never> = ActionState<I, A, E>;
  /** Public namespace alias for Action concurrency modes. */
  export type Concurrency = ActionConcurrency;
  /** Public namespace alias for Action retry and concurrency policy. */
  export type Policy<E = never> = ActionPolicy<E>;
  /** Public namespace alias for the optimistic Action transaction object. */
  export type OptimisticTransaction = ActionOptimisticTransaction;
  /** Partial patch or pure updater for `transaction.update`. */
  export type OptimisticRowUpdate<Row> = ActionOptimisticRowUpdate<Row>;
  /** Public namespace alias for one change `Action.planOptimistic` reports. */
  export type OptimisticChange = ActionOptimisticChange;

  /** Public namespace alias for the durability policy of `Action.define({ durable })`. */
  export type DurablePolicy = ActionDurablePolicy;
  /** Public namespace alias for `Action.outboxLayer` options. */
  export type OutboxOptions = ActionOutboxOptions;
  /** Public namespace alias for `Action.restoreOutbox` options. */
  export type RestoreOutboxOptions = ActionOutboxRestoreOptions;
  /** Public namespace alias for the Action Outbox read side. */
  export type Outbox = ActionOutboxView;
  /** One pending durable submission in the Action Outbox. */
  export type OutboxEntry = ActionOutboxEntry;
  /** One durable submission that finally failed while nobody was waiting. */
  export type OutboxFailure = ActionOutboxFailure;
  /** Options accepted by `Action.define(...)`. */
  export type Options<I, A, E = never, R = never> = ActionOptions<I, A, E, R>;
  /** Runtime options for constructing an Action Instance from a definition. */
  export type UseOptions<R = never, ER = never> = ActionUseOptions<R, ER>;
  /** Submission an `ActionTransport` sends for one Action run. */
  export type TransportSubmission = ActionTransportSubmission;
  /** Response an `ActionTransport` returns for one Action submission. */
  export type TransportResponse<A, E> = ActionTransportResponse<A, E>;
  /** Failures a submission reports beside the Action's own (transport, protocol, wire schema). */
  export type ClientError = ActionClientError;

  /**
   * Layer providing the runtime's Action Outbox, which persists durable Action
   * submissions in the runtime's `KeyValueStore` (`effect/persistence`) and
   * replays them in order (global FIFO) with the `retry` backoff, on `online`
   * events, and on new durable submissions. Start's `App.launch` provides one
   * over the client Layer's `KeyValueStore`; core hosts provide it themselves
   * and run `Action.restoreOutbox` once their state is hydrated.
   *
   * @example
   * ```ts
   * const runtime = makeRuntime(
   *   Action.outboxLayer().pipe(
   *     Layer.provideMerge(KeyValueStore.layerStorage(() => localStorage)),
   *   ),
   * );
   * ```
   */
  export const outboxLayer = (
    options: ActionOutboxOptions = {},
  ): Layer.Layer<ActionOutbox, never, KeyValueStore.KeyValueStore> =>
    makeActionOutboxLayer(options);

  /**
   * The runtime's Action Outbox read side: pending durable submissions and the
   * final failures nobody was waiting on. A runtime without an outbox (a
   * server render) reports nothing pending.
   *
   * @example
   * ```tsx
   * const outbox = yield* Action.outbox;
   * return () => <Show when={outbox.pending.get().length > 0}>{outbox.pending.get().length} waiting to sync</Show>;
   * ```
   */
  export const outbox: Effect.Effect<ActionOutboxView> = Effect.map(
    Effect.serviceOption(ActionOutbox),
    Option.getOrElse((): ActionOutboxView => emptyActionOutboxView),
  );

  /**
   * Restores the runtime's persisted durable submissions (once): re-applies
   * their optimistic patches in order on top of the current state, then
   * replays them. Submissions in `settled` were already settled by the server
   * that rendered the current state, so their patch is not re-applied; their
   * replay only settles them. Run it after hydration; `App.launch` does. A
   * no-op without an outbox.
   */
  export const restoreOutbox = (options: ActionOutboxRestoreOptions = {}): Effect.Effect<void> =>
    Effect.flatMap(
      Effect.serviceOption(ActionOutbox),
      Option.match({ onNone: () => Effect.void, onSome: (outbox) => outbox.restore(options) }),
    );

  /** Plans the invalidations a successful value triggers; a throwing `invalidates` is a defect. */
  export const planInvalidation = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    value: A,
    input: I,
  ): Effect.Effect<ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>> =>
    Effect.flatMap(invalidationsFor(definition, value, input), Resource.planInvalidation);

  /**
   * Plans what a definition's `optimistic` patch changes for `input`, without
   * applying anything: nothing is written and no backend is involved. Each
   * `set` reports the value its Signal or Resource entry would read, computed
   * from the current value (a Resource entry the caller's store has not
   * loaded plans no change); each row change reports the store and the change
   * as given. A definition without `optimistic` plans nothing. This is how
   * optimistic patches are tested.
   *
   * @example
   * ```ts
   * const changes = yield* Action.planOptimistic(RenameProject, { id, name: "Atlas 2" });
   * // [{ _tag: "Update", rows: Projects, key: id, update: { name: "Atlas 2" } },
   * //  { _tag: "Set", target: ProjectById(id), value: { ...project, name: "Atlas 2" } }]
   * ```
   */
  export const planOptimistic = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    input: I,
  ): Effect.Effect<ReadonlyArray<ActionOptimisticChange>, never, R> =>
    Effect.suspend(() => {
      const plan = makeActionOptimisticPlanRuntime(definition.name);
      return applyActionOptimistic(definition, input, plan, "submit").pipe(
        Effect.map(() => plan.changes()),
      );
    });

  /**
   * Defines and registers a reusable action without binding it to UI state.
   *
   * With `run`, the Action runs where it is submitted. Without `run`, it is a
   * served Action: its schemas are the wire contract, its `run` is the
   * server's `Action.implement(definition, run)` (in a `*.server.ts` module),
   * and clients submit it through the runtime's `ActionTransport` (Start's
   * `App.launch` provides one). Use `Action.use(...)` or the renderer
   * adapter's binding to create an instance.
   *
   * @example
   * ```ts
   * // shared: browser-safe
   * const RenameProject = Action.define({
   *   name: "RenameProject",
   *   input: Schema.Struct({ id: ProjectId, name: Schema.String }),
   *   output: Project,
   *   error: ProjectNotFound,
   *   invalidates: (project) => [ProjectTag({ id: project.id })],
   * });
   *
   * // projects.server.ts
   * export const renameProject = Action.implement(RenameProject, (input) => renameInDb(input));
   * ```
   */
  export function define<
    const Input extends Schema.Top,
    const Output extends Schema.Top = typeof Schema.Void,
    const ErrorSchema extends Schema.Top = typeof Schema.Never,
    const Durable extends ActionDurablePolicy | undefined = undefined,
    OptimisticRequirements = never,
    InvalidationRequirements = never,
  >(
    definition: ServedActionOptions<
      Input,
      Output,
      ErrorSchema,
      Durable,
      OptimisticRequirements,
      InvalidationRequirements
    >,
  ): ServedActionDefinition<
    Input,
    Output,
    ErrorSchema,
    Durable,
    OptimisticRequirements,
    InvalidationRequirements
  >;
  export function define<
    const Input extends Schema.Top,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    InvalidationRequirements = never,
  >(
    definition: ActionDefinitionCommonOptions<
      Schema.Schema.Type<Input>,
      EffectInputValue<Out>,
      EffectInputError<Out>,
      EffectInputRequirements<Out>,
      InvalidationRequirements
    > & {
      readonly input: Input;
      readonly output: Output;
      readonly durable: ActionDurablePolicy;
      readonly run: (input: Schema.Schema.Type<Input>) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>,
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out> | ActionQueued,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    Run extends (input: Schema.Schema.Type<Input>) => unknown,
    InvalidationRequirements = never,
  >(
    definition: ActionDefinitionCommonOptions<
      Schema.Schema.Type<Input>,
      EffectInputValue<ReturnType<Run>>,
      EffectInputError<ReturnType<Run>>,
      EffectInputRequirements<ReturnType<Run>>,
      InvalidationRequirements
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly durable: ActionDurablePolicy;
      readonly run: Run &
        ((input: Schema.Schema.Type<Input>) => EnsureEffectInput<ReturnType<Run>>);
    } & RejectPromiseEffectInput<ReturnType<Run>>,
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>> | ActionQueued,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    InvalidationRequirements = never,
  >(
    definition: ActionDefinitionCommonOptions<
      Schema.Schema.Type<Input>,
      EffectInputValue<Out>,
      EffectInputError<Out>,
      EffectInputRequirements<Out>,
      InvalidationRequirements
    > & {
      readonly input: Input;
      readonly output: Output;
      readonly durable?: never;
      readonly run: (input: Schema.Schema.Type<Input>) => EnsureEffectInput<Out>;
    } & RejectPromiseEffectInput<Out>,
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    const Input extends Schema.Top,
    Run extends (input: Schema.Schema.Type<Input>) => unknown,
    InvalidationRequirements = never,
  >(
    definition: Omit<
      ActionOptions<
        Schema.Schema.Type<Input>,
        EffectInputValue<ReturnType<Run>>,
        EffectInputError<ReturnType<Run>>,
        EffectInputRequirements<ReturnType<Run>>
      >,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input: Input;
      readonly output?: never;
      readonly durable?: never;
      readonly run: Run &
        ((input: Schema.Schema.Type<Input>) => EnsureEffectInput<ReturnType<Run>>);
      readonly invalidates?: (
        value: EffectInputValue<ReturnType<Run>>,
        input: Schema.Schema.Type<Input>,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>,
  ): ActionDefinition<
    Schema.Schema.Type<Input>,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>>,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define<
    I,
    const Output extends Schema.Top,
    Out extends EffectInput<Schema.Schema.Type<Output>, any, any>,
    InvalidationRequirements = never,
  >(
    definition: Omit<
      ActionOptions<I, EffectInputValue<Out>, EffectInputError<Out>, EffectInputRequirements<Out>>,
      "input" | "output" | "run" | "invalidates"
    > & {
      readonly input?: never;
      readonly output: Output;
      readonly durable?: never;
      readonly run: (input: I) => EnsureEffectInput<Out>;
      readonly invalidates?: (
        value: EffectInputValue<Out>,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<Out>,
  ): ActionDefinition<
    I,
    EffectInputValue<Out>,
    EffectInputError<Out>,
    ActionInferredRequirements<Out, never, InvalidationRequirements>
  >;
  export function define<
    I,
    A,
    E = never,
    R = never,
    InvalidationRequirements = never,
    Definition extends Omit<ActionOptions<I, A, E, R>, "run" | "optimistic" | "invalidates"> & {
      readonly durable?: never;
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, R>;
      readonly invalidates?: (
        value: A,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } = Omit<ActionOptions<I, A, E, R>, "run" | "optimistic" | "invalidates"> & {
      readonly durable?: never;
      readonly run: (input: I) => EffectInput<A, E, R>;
      readonly optimistic?: (
        input: I,
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, R>;
      readonly invalidates?: (
        value: A,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    },
  >(
    definition: Definition & CheckedActionRun<I, Definition>,
  ): ActionDefinition<
    I,
    A,
    E,
    R | NormalizeRequirements<InvalidationRequirements> | ActionResultInvalidationRequirements<A>
  >;
  export function define<I, Run extends (input: I) => unknown, InvalidationRequirements = never>(
    definition: Omit<
      ActionOptions<
        I,
        EffectInputValue<ReturnType<Run>>,
        EffectInputError<ReturnType<Run>>,
        EffectInputRequirements<ReturnType<Run>>
      >,
      "output" | "run" | "invalidates"
    > & {
      readonly output?: never;
      readonly durable?: never;
      readonly run: Run & ((input: I) => EnsureEffectInput<ReturnType<Run>>);
      readonly invalidates?: (
        value: EffectInputValue<ReturnType<Run>>,
        input: I,
      ) => ReadonlyArray<ResourceInvalidation<InvalidationRequirements>>;
    } & RejectPromiseEffectInput<ReturnType<Run>>,
  ): ActionDefinition<
    I,
    EffectInputValue<ReturnType<Run>>,
    EffectInputError<ReturnType<Run>>,
    ActionInferredRequirements<ReturnType<Run>, never, InvalidationRequirements>
  >;
  export function define(definition: unknown): any {
    const options = definition as Omit<ActionOptions<any, any, any, any>, "run" | "optimistic"> & {
      readonly run: (input: any) => EffectInput<any, any, any>;
      readonly optimistic?: (
        input: any,
        transaction: ActionOptimisticTransaction,
      ) => Effect.Effect<void, never, any>;
    };
    const { run, optimistic, ...rest } = options;

    const action: AnyActionDefinition = {
      ...rest,
      run,
      ...(optimistic === undefined
        ? {}
        : {
            optimistic,
          }),
      [ActionTypeId]: ActionTypeId,
    };

    registerActionDefinition(action);
    return action;
  }

  /**
   * The server's `run` for a served Action (one defined without `run`): the
   * definition's name, schemas, `optimistic`, and `invalidates` with this
   * `run`. Keep it in a `*.server.ts` module and give it to Start's
   * `createRequestHandler(app, { implementations })`; the browser bundle
   * never sees it. `run` may succeed only with the definition's `output` and
   * fail only with its `error`; its services become the server Layer's to
   * provide.
   *
   * @example
   * ```ts
   * export const renameProject = Action.implement(RenameProject, ({ id, name }) =>
   *   Effect.gen(function* () {
   *     const db = yield* Database;
   *     return yield* db.renameProject(id, name);
   *   }),
   * );
   * ```
   */
  export const implement = <I, A, E, R, Out>(
    definition: ActionDefinition<I, A, E, R>,
    run: (input: I) => ImplementedActionRun<A, E, Out>,
  ): ActionDefinition<I, A, E, R | EffectInputRequirements<Out>> => {
    if (definition.run !== undefined) {
      throw new Error(
        `Action.implement(${definition.name}): the definition already has a run. Define a served Action without run to implement it on the server.`,
      );
    }
    return {
      ...definition,
      run: run as (input: I) => EffectInput<A, E, R | EffectInputRequirements<Out>>,
    } as ActionDefinition<I, A, E, R | EffectInputRequirements<Out>>;
  };

  /**
   * Creates a live action instance with state, optimistic updates, and invalidation.
   *
   * The instance runs on `runtime`: its services discharge the definition's
   * requirements, and a runtime-provided `ActionTransport` that serves the
   * definition submits it remotely. UI code binds Actions with its renderer
   * adapter (Solid's `Component.action(...)`), which supplies the runtime.
   */
  export function use<I, A, E = never, R = never, RRuntime = never, ER = never>(
    definition: ActionDefinition<I, A, E, R>,
    options: ActionUseOptions<RRuntime, ER>,
  ): ActionInstance<
    I,
    A,
    E | ER,
    ActionRuntimeRemainingRequirements<R | ActionResultInvalidationRequirements<A>, RRuntime>,
    E,
    R,
    R | ActionResultInvalidationRequirements<A>
  > {
    return makeActionInstance(definition, options.runtime as AnySunfallArcRuntime<ER>) as never;
  }
}
