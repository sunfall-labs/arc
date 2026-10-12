import { Cause, Clock, Data, Effect, Exit, Fiber, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { settleResult } from "./async-result-settle.js";
import type { ResourceInvalidationPlan } from "./resource.js";
import { Signal, type ReadableSignal } from "./signal.js";
import type { TimelineActionCause } from "./timeline.js";
import { batchSignalWrites } from "./signal-transaction.js";

/**
 * Submission concurrency policy shared by Core Actions and Start Actions.
 *
 * `latest` interrupts the previous run and only the newest run may update
 * state; `parallel` lets each run execute but only the latest state update is
 * accepted; `exhaust` joins the in-flight run instead of starting another.
 */
export type ActionSubmissionConcurrency = "latest" | "parallel" | "exhaust";

/** Typed interruption used when a stale `latest` submission tries to continue. */
export class ActionInterrupted extends Data.TaggedError("ActionInterrupted")<{
  readonly actionName: string;
}> {}

/**
 * Visible submission state exposed by action client instances.
 *
 * `result` is `Initial` while idle; a submission marks the current result
 * `waiting` and settles it to `Success` or a `Failure` carrying the full
 * `Cause` (typed errors and defects) with the latest success kept as
 * `previousSuccess`. An interrupted submission returns to the prior settled
 * state. `input` is the latest submission's input (`Option.none()` while idle).
 */
/** Submission state for one action instance: an `AsyncResult` plus the latest input. */
export interface ActionState<I, A, E = never> {
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly input: Option.Option<I>;
}

export type ActionSubmissionFiber<A, E> = Fiber.Fiber<A, E | ActionInterrupted>;

interface CurrentActionSubmission<A, E> {
  readonly token: object;
  readonly fiber: ActionSubmissionFiber<A, E>;
}

export interface ActionSubmissionRun<A, E> {
  readonly _tag: "Run";
  readonly version: number;
  readonly clearToken: object;
  readonly previousFiber?: ActionSubmissionFiber<A, E>;
  readonly interruptStale: boolean;
  readonly updateOnlyLatest: boolean;
}

export type ActionSubmissionDecision<A, E> =
  | { readonly _tag: "Join"; readonly fiber: ActionSubmissionFiber<A, E> }
  | ActionSubmissionRun<A, E>;

/**
 * State and concurrency controller for a stateful action client instance.
 *
 * The controller owns visible state, invalidation-plan state, current fiber
 * tracking, stale-submission checks, and reset behavior while callers keep the
 * domain-specific workflow local.
 */
export interface ActionSubmissionController<I, A, E, P = ResourceInvalidationPlan> {
  readonly state: ReadableSignal<ActionState<I, A, E>>;
  readonly invalidationPlan: ReadableSignal<P | undefined>;
  readonly beginEffect: (
    fiber: ActionSubmissionFiber<A, E>,
  ) => Effect.Effect<ActionSubmissionDecision<A, E>>;
  readonly acceptsStateUpdate: (submission: ActionSubmissionRun<A, E>) => boolean;
  readonly pendingEffect: (submission: ActionSubmissionRun<A, E>, input: I) => Effect.Effect<void>;
  readonly interruptStaleEffect: (
    submission: ActionSubmissionRun<A, E>,
  ) => Effect.Effect<void, ActionInterrupted>;
  /**
   * Settles the visible state from the submission's Exit, stamped with `Clock`
   * time. `plan` is committed with a successful result in the same batch.
   * Stale submissions and `ActionInterrupted` exits leave state untouched.
   */
  readonly settleEffect: (
    submission: ActionSubmissionRun<A, E>,
    exit: Exit.Exit<A, E | ActionInterrupted>,
    plan: P | undefined,
  ) => Effect.Effect<void>;
  readonly clearCurrentEffect: (token: object) => Effect.Effect<void>;
  /**
   * Synchronously clears visible state and captures currently active fibers.
   *
   * The returned Effect interrupts only the fibers that were active at capture
   * time. UI adapters use this host cleanup seam so later submissions cannot be
   * interrupted by a queued reset.
   */
  readonly captureReset: () => Effect.Effect<void>;
  /** Lazy Effect-first reset for callers already composing inside Effect. */
  readonly reset: () => Effect.Effect<void>;
}

export interface ActionSubmissionControllerOptions {
  /** Human-readable action name included in interruption diagnostics. */
  readonly actionName: string;
  /** Submission concurrency policy. Defaults to `latest`. */
  readonly concurrency?: ActionSubmissionConcurrency | undefined;
}

/** Creates the shared submission controller used by Action and StartAction clients. */
export const makeActionSubmissionController = <I, A, E, P = ResourceInvalidationPlan>(
  options: ActionSubmissionControllerOptions,
): ActionSubmissionController<I, A, E, P> => {
  const idle: ActionState<I, A, E> = {
    result: AsyncResult.initial(),
    input: Option.none(),
  };
  const state = Signal.make<ActionState<I, A, E>>(idle, { name: `${options.actionName}.state` });
  const invalidationPlan = Signal.make<P | undefined>(undefined, {
    name: `${options.actionName}.invalidationPlan`,
  });
  // Last settled state and plan, restored when the latest submission is interrupted.
  let settled: { readonly state: ActionState<I, A, E>; readonly plan: P | undefined } = {
    state: idle,
    plan: undefined,
  };
  const commit = (
    next: ActionState<I, A, E>,
    plan: P | undefined,
    event: TimelineActionCause["event"],
  ): void => {
    batchSignalWrites(
      () => {
        invalidationPlan.set(plan);
        state.set(next);
      },
      { _tag: "Action", action: options.actionName, event },
    );
  };
  let version = 0;
  let currentSubmission: CurrentActionSubmission<A, E> | undefined;
  const activeSubmissions = new Map<object, ActionSubmissionFiber<A, E>>();

  const concurrency = options.concurrency ?? "latest";
  const isLatest = (submission: ActionSubmissionRun<A, E>): boolean =>
    submission.version === version;
  const acceptsStateUpdate = (submission: ActionSubmissionRun<A, E>): boolean =>
    !submission.updateOnlyLatest || isLatest(submission);
  const interruptFibersEffect = (
    fibers: ReadonlyArray<ActionSubmissionFiber<A, E>>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (const fiber of fibers) {
        yield* Fiber.interrupt(fiber).pipe(Effect.catchCause(() => Effect.void));
      }
    });
  const captureResetEffect = (): Effect.Effect<void> => {
    const fibers = Array.from(activeSubmissions.values());
    version++;
    currentSubmission = undefined;
    activeSubmissions.clear();
    settled = { state: idle, plan: undefined };
    commit(idle, undefined, "reset");
    return interruptFibersEffect(fibers);
  };
  const resetEffect = (): Effect.Effect<void> => Effect.suspend(() => captureResetEffect());

  return {
    state,
    invalidationPlan,
    beginEffect: (fiber) =>
      Effect.sync(() => {
        const current = currentSubmission;
        if (concurrency === "exhaust" && current?.fiber) {
          return { _tag: "Join", fiber: current.fiber };
        }

        const previousFiber = concurrency === "latest" ? current?.fiber : undefined;
        const submission: ActionSubmissionRun<A, E> = {
          _tag: "Run",
          version: ++version,
          clearToken: {},
          ...(previousFiber === undefined ? {} : { previousFiber }),
          interruptStale: concurrency === "latest",
          updateOnlyLatest: true,
        };
        activeSubmissions.set(submission.clearToken, fiber);

        if (concurrency !== "parallel") {
          currentSubmission = {
            token: submission.clearToken,
            fiber,
          };
        }

        return submission;
      }),
    acceptsStateUpdate,
    pendingEffect: (submission, input) =>
      Effect.sync(() => {
        if (!acceptsStateUpdate(submission)) {
          return;
        }

        commit(
          { result: AsyncResult.waiting(state.get().result), input: Option.some(input) },
          undefined,
          "submit",
        );
      }),
    interruptStaleEffect: (submission) =>
      Effect.suspend(() =>
        !activeSubmissions.has(submission.clearToken) ||
        (submission.interruptStale && !isLatest(submission))
          ? Effect.fail(new ActionInterrupted({ actionName: options.actionName }))
          : Effect.void,
      ),
    settleEffect: (submission, exit, plan) =>
      Effect.gen(function* () {
        if (!acceptsStateUpdate(submission)) {
          return;
        }
        if (
          Exit.isFailure(exit) &&
          Cause.findErrorOption(exit.cause).pipe(
            Option.exists((error) => error instanceof ActionInterrupted),
          )
        ) {
          return;
        }

        const settledExit = exit as Exit.Exit<A, E>;
        if (Exit.isFailure(settledExit) && Cause.hasInterruptsOnly(settledExit.cause)) {
          commit(settled.state, settled.plan, "interrupt");
          return;
        }

        const now = yield* Clock.currentTimeMillis;
        const current = state.get();
        const next: ActionState<I, A, E> = {
          result: settleResult(settledExit, current.result, now),
          input: current.input,
        };
        const nextPlan = Exit.isSuccess(settledExit) ? plan : undefined;
        settled = { state: next, plan: nextPlan };
        commit(next, nextPlan, Exit.isSuccess(settledExit) ? "success" : "failure");
      }),
    clearCurrentEffect: (token) =>
      Effect.sync(() => {
        activeSubmissions.delete(token);
        if (currentSubmission?.token === token) {
          currentSubmission = undefined;
        }
      }),
    captureReset: captureResetEffect,
    reset: resetEffect,
  };
};
