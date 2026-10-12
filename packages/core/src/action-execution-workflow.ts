import { Effect, Exit, Fiber, Option } from "effect";
import {
  ActionResult,
  type ActionResultInvalidationRequirements,
  type AnyActionResult,
} from "./action-result.js";
import {
  ActionInterrupted,
  type ActionSubmissionController,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
} from "./action-submission.js";
import {
  makeActionOptimisticTransactionRuntime,
  type ActionOptimisticSettle,
} from "./action-optimistic.js";
import {
  catchEffectInputPromiseDefect,
  EffectInputCallbackError,
  invokeEffectInput,
  toEffect,
} from "./effect-like.js";
import { validateResourceInvalidationsArraySync } from "./resource-dependency-graph.js";
import type { ResourceInvalidation, ResourceInvalidationPlan } from "./resource.js";
import {
  planResourceInvalidationEffect,
  runResourceInvalidationPlanEffect,
} from "./resource-runtime.js";
import type { ActionDefinition } from "./action.js";
import { ActionTransport } from "./action-transport.js";
import type { ServerClientError } from "./server.js";

const actionCallbackError = (operation: string, cause: unknown): EffectInputCallbackError =>
  cause instanceof EffectInputCallbackError
    ? cause
    : new EffectInputCallbackError({
        operation,
        cause,
        guidance:
          "Action callbacks must return values or Effects. A synchronous throw or a Promise-shaped return is a defect; fail the returned Effect for a typed failure.",
      });

/**
 * Breaking an Action callback's contract (a synchronous throw, a Promise-shaped
 * return or patch) is a defect, so submissions fail only with the Action's
 * declared error.
 */
const callbackContractDefects = <A, E, R>(
  effect: Effect.Effect<A, E | EffectInputCallbackError, R>,
): Effect.Effect<A, Exclude<E, EffectInputCallbackError>, R> =>
  Effect.catch(effect, (error) =>
    error instanceof EffectInputCallbackError
      ? Effect.die(error)
      : Effect.fail(error as Exclude<E, EffectInputCallbackError>),
  );

const resultInvalidations = <A>(
  value: A,
): ReadonlyArray<ResourceInvalidation<ActionResultInvalidationRequirements<A>>> =>
  ActionResult.is(value) ? ActionResult.invalidations(value as AnyActionResult) : [];

export const invalidationsForEffect = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  value: A,
  input: I,
): Effect.Effect<
  ReadonlyArray<ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>>
> =>
  Effect.map(
    Effect.try({
      try: () => {
        const operation = `Action.invalidates(${definition.name})`;
        return definition.invalidates === undefined
          ? []
          : validateResourceInvalidationsArraySync(
              operation,
              definition.invalidates(value, input),
              "Action invalidates callbacks must return Resource refs or tags synchronously. Move host Promise work into the action run Effect.",
            );
      },
      catch: (cause) => actionCallbackError(`Action.invalidates(${definition.name})`, cause),
    }).pipe(callbackContractDefects),
    (invalidations) =>
      [...invalidations, ...resultInvalidations(value)] as ReadonlyArray<
        ResourceInvalidation<R | ActionResultInvalidationRequirements<A>>
      >,
  );

export interface ActionExecutionWorkflowOptions<I, A, E, R, ER> {
  readonly definition: ActionDefinition<I, A, E, R>;
  readonly submissions: ActionSubmissionController<
    I,
    A,
    E | ER | ServerClientError,
    ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>>
  >;
  readonly runAtActionBoundary: <Value, Error, Requirements>(
    effect: Effect.Effect<Value, Error, Requirements>,
  ) => Effect.Effect<Value, Error | ER, Requirements>;
}

export interface ActionExecutionWorkflow<I, A, E, R, ER> {
  readonly submit: (
    input: I,
  ) => Effect.Effect<
    A,
    E | ER | ServerClientError | ActionInterrupted,
    R | ActionResultInvalidationRequirements<A>
  >;
  readonly captureReset: () => Effect.Effect<void>;
  readonly reset: () => Effect.Effect<void>;
}

/**
 * Build the Effect-first execution workflow behind one live Action instance.
 *
 * The workflow owns callback normalization, retry, optimistic commit/rollback,
 * stale-submission interruption, invalidation planning/execution, and visible
 * submission state updates. `Action.use(...)` keeps runtime binding and public
 * type subtraction local to the facade.
 */
export const makeActionExecutionWorkflow = <I, A, E, R, ER>(
  options: ActionExecutionWorkflowOptions<I, A, E, R, ER>,
): ActionExecutionWorkflow<I, A, E, R, ER> => {
  const { definition, submissions, runAtActionBoundary } = options;

  const runEffect = (input: I): Effect.Effect<A, E, R> => {
    const operation = `Action.run(${definition.name})`;
    return Effect.flatMap(
      Effect.try({
        try: () => definition.run(input),
        catch: (cause) => actionCallbackError(operation, cause),
      }),
      (result) => {
        const effect = toEffect(result as never) as Effect.Effect<A, E, R>;
        const retry = definition.policy?.retry;
        return catchEffectInputPromiseDefect(
          operation,
          retry === undefined ? effect : Effect.retry(effect, retry),
        );
      },
    ).pipe(callbackContractDefects) as Effect.Effect<A, E, R>;
  };

  const applyOptimistic = (
    input: I,
    transaction: ReturnType<typeof makeActionOptimisticTransactionRuntime>,
  ): Effect.Effect<void, never, R> =>
    definition.optimistic === undefined
      ? Effect.void
      : invokeEffectInput(
          `Action.optimistic(${definition.name})`,
          definition.optimistic,
          input,
          transaction.api,
        ).pipe(Effect.asVoid, callbackContractDefects);

  const runWorkflow = (
    input: I,
    submission: ActionSubmissionRun<A, E | ER | ServerClientError>,
  ): Effect.Effect<
    A,
    E | ER | ServerClientError | ActionInterrupted,
    R | ActionResultInvalidationRequirements<A>
  > =>
    Effect.suspend(() => {
      let rollback: ActionOptimisticSettle = Effect.void;
      let plan: ResourceInvalidationPlan<R | ActionResultInvalidationRequirements<A>> | undefined;

      return Effect.ensuring(
        Effect.gen(function* () {
          yield* submissions.pendingEffect(submission, input);

          const transaction = makeActionOptimisticTransactionRuntime(definition.name);
          rollback = transaction.rollback;
          yield* applyOptimistic(input, transaction);

          // A transport that serves this Action runs it remotely and applies
          // the response (hydration and invalidations) itself.
          const remote = Option.flatMap(yield* Effect.serviceOption(ActionTransport), (transport) =>
            transport.submit(definition, input),
          );
          if (Option.isSome(remote)) {
            const response = yield* remote.value;
            yield* submissions.interruptStaleEffect(submission);
            // The server committed: fold the optimistic patches in before the
            // response's invalidations reload their sources.
            if (Exit.isSuccess(response.exit)) {
              yield* transaction.commit;
              rollback = Effect.void;
            }
            yield* response.apply(submissions.acceptsStateUpdate(submission));
            return yield* response.exit;
          }

          const value = yield* runEffect(input);
          yield* submissions.interruptStaleEffect(submission);

          const invalidations = yield* invalidationsForEffect(definition, value, input);
          const planned = yield* planResourceInvalidationEffect(invalidations);
          yield* transaction.commit;
          rollback = Effect.void;

          if (invalidations.length > 0) {
            yield* runResourceInvalidationPlanEffect(planned);
            plan = planned;
          }

          return value;
        }),
        Effect.suspend(() => rollback.pipe(Effect.catchCause(() => Effect.void))),
      ).pipe(
        // Every exit settles visible state: success, typed failure, defect, or
        // interruption (which restores the prior settled state).
        Effect.onExit((exit) => submissions.settleEffect(submission, exit, plan)),
      );
    });

  const submitEffect = (
    input: I,
  ): Effect.Effect<
    A,
    E | ER | ServerClientError | ActionInterrupted,
    R | ActionResultInvalidationRequirements<A>
  > =>
    runAtActionBoundary(
      Effect.suspend(() => {
        return Effect.withFiber((fiber) => {
          const submissionFiber = fiber as ActionSubmissionFiber<A, E | ER | ServerClientError>;

          return submissions.beginEffect(submissionFiber).pipe(
            Effect.flatMap((submission) => {
              if (submission._tag === "Join") {
                return Fiber.join(submission.fiber);
              }

              return Effect.gen(function* () {
                if (submission.previousFiber && submission.previousFiber !== submissionFiber) {
                  yield* Fiber.interrupt(submission.previousFiber);
                }

                return yield* runWorkflow(input, submission);
              }).pipe(Effect.ensuring(submissions.clearCurrentEffect(submission.clearToken)));
            }),
          );
        });
      }),
    );

  return {
    submit: submitEffect,
    captureReset: submissions.captureReset,
    reset: submissions.reset,
  };
};
