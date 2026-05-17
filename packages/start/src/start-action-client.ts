import {
  ActionInterrupted,
  currentOrDefaultRuntime,
  getCurrentRuntime,
  makeActionSubmissionController,
  Server,
  Signal,
  type ActionSubmissionFiber,
  type ActionSubmissionRun,
  type ActionSubmissionState,
  type ActionDefinition,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type ReadableSignal
} from "@effect-ui/core";
import { Effect, Fiber } from "effect";
import type { StartHydrationPayload } from "./hydration.js";
import { executeStartClientTransportEffect } from "./start-client-transport.js";
import {
  applyStartActionInvalidationEffect,
  applyStartActionResponseEffect
} from "./start-action-response-application.js";
import { resolveStartActionEndpoint } from "./start-transport-endpoints.js";
import {
  encodeStartActionRequestEffect,
  startActionForm,
  type StartActionDefinition,
  type StartActionForm,
  type StartActionFormOptions,
  type StartActionRequest
} from "./start-action-request-codec.js";
import {
  decodeStartActionResponseEffect,
  parseStartActionResponse,
  type ActionDefinitionErrorValue,
  type ActionDefinitionOutputValue,
  type StartActionInvalidationPlan,
  type StartActionResponseBody,
  type StartActionResultFor
} from "./start-action-response-codec.js";
import {
  type ActionDefinitionInputValue,
  type StartActionClientOptions
} from "./start-transport-protocol.js";

interface SubmittedStartAction<D extends StartActionDefinition> {
  readonly result: StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;
  readonly response: Extract<
    StartActionResponseBody,
    { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
  >;
}

type StartActionTransportRuntime<FetchRequirements, RuntimeError> =
  | EffectUiRuntime<FetchRequirements, RuntimeError>
  | AnyEffectUiRuntime<RuntimeError>;

type StartActionResponseRuntime<RuntimeError> =
  | EffectUiRuntime<any, RuntimeError>
  | AnyEffectUiRuntime<RuntimeError>;

type StartActionClientOptionsWithRuntime<
  FetchError,
  FetchRequirements,
  RuntimeError
> =
  StartActionClientOptions<FetchError, FetchRequirements, RuntimeError> &
    (
      | { readonly runtime: StartActionTransportRuntime<FetchRequirements, RuntimeError> }
      | {
          readonly responseRuntime: StartActionResponseRuntime<RuntimeError>;
          readonly transportRuntime: StartActionTransportRuntime<FetchRequirements, RuntimeError>;
        }
    );

type StartActionSubmitResult<D extends StartActionDefinition> =
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;

const submitStartActionTransportEffect = <
  D extends StartActionDefinition,
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError> = {}
): Effect.Effect<SubmittedStartAction<D>, Server.ClientError | RuntimeError, FetchRequirements> => {
  const transportRuntime = options.transportRuntime ?? options.runtime;
  const workflow = Effect.gen(function* () {
    const request: StartActionRequest = yield* encodeStartActionRequestEffect(definition, input);
    const { body: actionResponse } = yield* executeStartClientTransportEffect({
      kind: "action",
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      endpoint: resolveStartActionEndpoint(options),
      request,
      init: {
        redirect: "manual"
      },
      parseResponse: parseStartActionResponse
    });

    const result = yield* decodeStartActionResponseEffect(definition, actionResponse);
    return {
      result,
      response: actionResponse
    };
  });

  return transportRuntime
    ? transportRuntime.provide(workflow) as Effect.Effect<SubmittedStartAction<D>, Server.ClientError | RuntimeError, FetchRequirements>
    : workflow;
};

/**
 * Submits a Start action over the action transport.
 *
 * The returned Effect encodes input, performs `fetch` when run, decodes the
 * action result, hydrates returned resources or collections, and invalidates
 * stale resources. Use this from Effect workflows; run it with a runtime at UI
 * or platform boundaries.
 *
 * @example
 * ```ts
 * const result = yield* submitStartActionEffect(RenameProject, {
 *   id: "atlas",
 *   name: "Atlas"
 * });
 * ```
 */
export function submitStartActionEffect<
  D extends StartActionDefinition,
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptionsWithRuntime<FetchError, FetchRequirements, RuntimeError>
): Effect.Effect<
  StartActionSubmitResult<D>,
  Server.ClientError | RuntimeError
>;
export function submitStartActionEffect<
  D extends StartActionDefinition,
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options?: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError>
): Effect.Effect<
  StartActionSubmitResult<D>,
  Server.ClientError | RuntimeError,
  FetchRequirements
>;
export function submitStartActionEffect<
  D extends StartActionDefinition,
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
>(
  definition: D,
  input: ActionDefinitionInputValue<D>,
  options: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError> = {}
): Effect.Effect<
  StartActionSubmitResult<D>,
  Server.ClientError | RuntimeError,
  FetchRequirements
> {
  return Effect.gen(function* () {
    const submitted = yield* submitStartActionTransportEffect(definition, input, options);
    yield* applyStartActionResponseEffect(submitted.response, options);
    return submitted.result;
  });
}

/** Stateful client helpers for Start actions. */
export namespace StartAction {
  /** Typed result emitted by a Start action definition. */
  export type Result<D extends StartActionDefinition> =
    StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>;

  /** Signal state used by a Start action client instance. */
  export type State<D extends StartActionDefinition, RuntimeError = never> =
    ActionSubmissionState<
      ActionDefinitionInputValue<D>,
      Result<D>,
      Server.ClientError | RuntimeError,
      StartActionInvalidationPlan
    >;

  /** Progressive POST form description for a Start action definition. */
  export type Form<D extends StartActionDefinition> = StartActionForm;

  /** Client-side action instance with state, metadata, and submissions. */
  export interface Instance<D extends StartActionDefinition, RuntimeError = never, Requirements = never> {
    readonly definition: D;
    readonly state: ReadableSignal<State<D, RuntimeError>>;
    readonly invalidation: ReadableSignal<StartActionInvalidationPlan | undefined>;
    readonly hydration: ReadableSignal<StartHydrationPayload | undefined>;
    /** Submit through the action transport and update instance signals. */
    submitEffect(input: ActionDefinitionInputValue<D>): Effect.Effect<Result<D>, Server.ClientError | RuntimeError | ActionInterrupted, Requirements>;
    /** Reset state and clear response metadata. */
    resetEffect(): Effect.Effect<void>;
    /** Interrupt an in-flight submission, then reset synchronously. */
    reset(): void;
  }

  /**
   * Creates the hidden POST fields needed to submit a Start action from HTML.
   *
   * Alias for `startActionForm(...)` that keeps action-related helpers together.
   */
  export const form = <I, A, E, R>(
    definition: ActionDefinition<I, A, E, R>,
    options: StartActionFormOptions<I> = {}
  ): StartActionForm => startActionForm(definition, options);

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
  export function use<
    D extends StartActionDefinition,
    FetchError = never,
    FetchRequirements = never,
    RuntimeError = never
  >(
    definition: D,
    options: StartActionClientOptionsWithRuntime<FetchError, FetchRequirements, RuntimeError>
  ): Instance<D, RuntimeError>;
  export function use<
    D extends StartActionDefinition,
    FetchError = never,
    FetchRequirements = never,
    RuntimeError = never
  >(
    definition: D,
    options?: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError>
  ): Instance<D, RuntimeError, FetchRequirements>;
  export function use<
    D extends StartActionDefinition,
    FetchError = never,
    FetchRequirements = never,
    RuntimeError = never
  >(
    definition: D,
    options: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError> = {}
  ): Instance<D, RuntimeError, FetchRequirements> {
    const ambientRuntime = getCurrentRuntime() as AnyEffectUiRuntime<RuntimeError> | undefined;
    const responseRuntime = options.responseRuntime ?? options.runtime ?? ambientRuntime;
    const resetRuntime = responseRuntime ?? currentOrDefaultRuntime();
    const transportRuntime = options.transportRuntime ?? options.runtime;
    const hydration = Signal.make<StartHydrationPayload | undefined>(undefined);
    const submissions = makeActionSubmissionController<
      ActionDefinitionInputValue<D>,
      Result<D>,
      Server.ClientError | RuntimeError,
      StartActionInvalidationPlan
    >({
      actionName: definition.name,
      concurrency: definition.policy?.concurrency
    });

    const runWorkflow = (
      input: ActionDefinitionInputValue<D>,
      submission: ActionSubmissionRun<Result<D>, Server.ClientError | RuntimeError>
    ): Effect.Effect<Result<D>, Server.ClientError | RuntimeError | ActionInterrupted, FetchRequirements> =>
      Effect.gen(function* () {
        yield* submissions.pendingEffect(submission, input);
        yield* Effect.sync(() => {
          if (submissions.acceptsStateUpdate(submission)) {
            hydration.set(undefined);
          }
        });

        const submitted = yield* submitStartActionTransportEffect(definition, input, {
          ...options,
          ...(transportRuntime === undefined ? {} : { transportRuntime })
        });
        yield* submissions.interruptStaleEffect(submission);

        const value = submitted.result;
        const acceptsStateUpdate = submissions.acceptsStateUpdate(submission);
        const responseOptions = {
          ...options,
          ...(responseRuntime === undefined ? {} : { responseRuntime })
        };
        if (acceptsStateUpdate) {
          yield* applyStartActionResponseEffect(submitted.response, {
            ...responseOptions
          });
        } else {
          yield* applyStartActionInvalidationEffect(submitted.response, {
            ...responseOptions
          });
        }

        yield* Effect.sync(() => {
          if (acceptsStateUpdate) {
            hydration.set(value.hydration);
          }
        });
        yield* submissions.successEffect(submission, input, value, value.invalidation);

        return value;
      }).pipe(
        Effect.catch((error: Server.ClientError | RuntimeError | ActionInterrupted): Effect.Effect<never, Server.ClientError | RuntimeError | ActionInterrupted> => {
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
    ): Effect.Effect<Result<D>, Server.ClientError | RuntimeError | ActionInterrupted, FetchRequirements> =>
      Effect.suspend(() => {
        return Effect.withFiber((fiber) => {
          const submissionFiber = fiber as ActionSubmissionFiber<Result<D>, Server.ClientError | RuntimeError>;

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
        void resetRuntime.runFork(resetEffect().pipe(Effect.catch(() => Effect.void)));
      }
    };
  }
}
