import {
  ActionInterrupted,
  currentOrDefaultRuntime,
  makeActionSubmissionController,
  Server,
  ServerTransportError,
  Signal,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
  type ActionSubmissionState,
  type ReadableSignal
} from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import type { StartHydrationPayload } from "./hydration.js";
import { serverActionPath } from "./rpc.js";
import {
  callStartFetchEffect,
  getStartTransportHeadersEffect as getRpcHeadersEffect,
  resolveStartFetchEffect
} from "./start-fetch.js";
import {
  decodeStartActionResponseEffect,
  encodeWithSchema,
  hydrateActionResponseEffect,
  parseStartActionResponse,
  type ActionDefinitionErrorValue,
  type ActionDefinitionInputValue,
  type ActionDefinitionOutputValue,
  type StartActionClientOptions,
  type StartActionDefinition,
  type StartActionInvalidationPlan,
  type StartActionRequest,
  type StartActionResultFor
} from "./start-transport-protocol.js";

/**
 * Submits a Start action over the action transport.
 *
 * The returned Effect encodes input, performs `fetch` when run, decodes the
 * result, hydrates any returned resources or collections, and invalidates stale
 * resources. Use this from Effect workflows; run it with a runtime at UI or
 * platform boundaries.
 *
 * @example
 * ```ts
 * const result = yield* submitStartActionEffect(RenameProject, {
 *   id: "atlas",
 *   name: "Atlas"
 * });
 * ```
 */
export const submitStartActionEffect = <D extends StartActionDefinition>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptions = {}
): Effect.Effect<
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>,
  Server.ClientError,
  unknown
> =>
  Effect.gen(function* () {
    const fetcher = yield* resolveStartFetchEffect(
      options.fetch,
      "No fetch implementation is available for Start actions."
    );

    const encodedInput = yield* encodeWithSchema(definition.input, input);
    const request: StartActionRequest = {
      name: definition.name,
      input: encodedInput
    };
    const body = yield* Effect.try({
      try: () => JSON.stringify(request),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          message: "Could not encode the action request body.",
          cause,
          payload: request
        })
    });
    const headers = yield* getRpcHeadersEffect(options);
    const response = yield* callStartFetchEffect(
      fetcher,
      options.endpoint ?? serverActionPath,
      {
        method: "POST",
        headers,
        body,
        redirect: "manual"
      },
      (cause) =>
        new ServerTransportError({
          reason: "Network",
          message: "Start action request failed.",
          cause
        })
    );
    const actionResponse = yield* parseStartActionResponse(response);

    if (actionResponse._tag === "ServerError") {
      return yield* Effect.fail(Server.deserializeServerError(actionResponse.error));
    }

    if (actionResponse._tag === "Defect") {
      return yield* new ServerTransportError({
        reason: "Defect",
        status: response.status,
        message: "Start action failed with a defect.",
        payload: actionResponse.defect
      });
    }

    const decoded = yield* decodeStartActionResponseEffect(definition, actionResponse);
    yield* hydrateActionResponseEffect(actionResponse, options);
    return decoded;
  });

/** Stateful client helpers for Start actions. */
export namespace StartAction {
  /** Typed result emitted by a Start action definition. */
  export type Result<D extends StartActionDefinition> =
    StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;

  /** Signal state used by a Start action client instance. */
  export type State<D extends StartActionDefinition> =
    ActionSubmissionState<
      ActionDefinitionInputValue<D>,
      Result<D>,
      Server.ClientError,
      StartActionInvalidationPlan
    >;

  /** Client-side action instance with state, metadata, and submissions. */
  export interface Instance<D extends StartActionDefinition> {
    readonly definition: D;
    readonly state: ReadableSignal<State<D>>;
    readonly invalidation: ReadableSignal<StartActionInvalidationPlan | undefined>;
    readonly hydration: ReadableSignal<StartHydrationPayload | undefined>;
    /** Submit through the action transport and update instance signals. */
    submitEffect(input: ActionDefinitionInputValue<D>): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown>;
    /** Reset state and clear response metadata. */
    resetEffect(): Effect.Effect<void>;
    /** Interrupt an in-flight submission, then reset synchronously. */
    reset(): void;
  }

  /**
   * Creates a stateful Start action client.
   *
   * `submitEffect` honors the core action concurrency policy and updates
   * signals for pending, success, failure, invalidation, and hydration.
   *
   * @example
   * ```ts
   * const rename = StartAction.use(RenameProject);
   * const result = yield* rename.submitEffect({ id: "atlas", name: "Atlas" });
   * ```
   */
  export const use = <D extends StartActionDefinition>(
    definition: D,
    options: StartActionClientOptions = {}
  ): Instance<D> => {
    const runtime = options.runtime ?? currentOrDefaultRuntime();
    const hydration = Signal.make<StartHydrationPayload | undefined>(undefined);
    const submissions = makeActionSubmissionController<
      ActionDefinitionInputValue<D>,
      Result<D>,
      Server.ClientError,
      StartActionInvalidationPlan
    >({
      actionName: definition.name,
      concurrency: definition.policy?.concurrency
    });

    const runWorkflow = (
      input: ActionDefinitionInputValue<D>,
      submission: ActionSubmissionRun<Result<D>, Server.ClientError>
    ): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown> =>
      Effect.gen(function* () {
        yield* submissions.pendingEffect(submission, input);
        yield* Effect.sync(() => {
          if (submissions.acceptsStateUpdate(submission)) {
            hydration.set(undefined);
          }
        });

        const value = yield* submitStartActionEffect(definition, input, {
          ...options,
          runtime
        });
        yield* submissions.interruptStaleEffect(submission);

        yield* Effect.sync(() => {
          if (submissions.acceptsStateUpdate(submission)) {
            hydration.set(value.hydration);
          }
        });
        yield* submissions.successEffect(submission, input, value, value.invalidation);

        return value;
      }).pipe(
        Effect.catch((error: Server.ClientError | ActionInterrupted): Effect.Effect<never, Server.ClientError | ActionInterrupted> => {
          if (error instanceof ActionInterrupted) {
            return Effect.fail(error);
          }

          return submissions.failureEffect(submission, input, error).pipe(
            Effect.andThen(Effect.fail(error))
          );
        })
      );

    const submitEffect = (
      input: ActionDefinitionInputValue<D>
    ): Effect.Effect<Result<D>, Server.ClientError | ActionInterrupted, unknown> =>
      Effect.suspend(() => {
        return Effect.withFiber((fiber) => {
          const submissionFiber = fiber as ActionSubmissionFiber<Result<D>, Server.ClientError>;

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
            })
          );
        });
      });

    const resetEffect = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* submissions.resetEffect();
        yield* Effect.sync(() => {
          hydration.set(undefined);
        });
      });

    return {
      definition,
      state: submissions.state,
      invalidation: submissions.invalidationPlan,
      hydration,
      submitEffect,
      resetEffect,
      reset: () => {
        submissions.reset(runtime);
        hydration.set(undefined);
      }
    };
  };
}
