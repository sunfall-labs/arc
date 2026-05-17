import { Data, Effect, Fiber } from "effect";
import type { ResourceInvalidationPlan } from "./resource.js";
import { Signal, type ReadableSignal } from "./signal.js";

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

/** Visible submission state exposed by action client instances. */
export type ActionSubmissionState<I, A, E = never, P = ResourceInvalidationPlan> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Pending"; readonly input: I; readonly previous: A | undefined; readonly hasPrevious: boolean }
  | { readonly _tag: "Success"; readonly value: A; readonly input: I; readonly invalidationPlan?: P }
  | { readonly _tag: "Failure"; readonly error: E; readonly input: I; readonly previous: A | undefined; readonly hasPrevious: boolean };

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
  readonly state: ReadableSignal<ActionSubmissionState<I, A, E, P>>;
  readonly invalidationPlan: ReadableSignal<P | undefined>;
  readonly beginEffect: (
    fiber: ActionSubmissionFiber<A, E>
  ) => Effect.Effect<ActionSubmissionDecision<A, E>>;
  readonly acceptsStateUpdate: (
    submission: ActionSubmissionRun<A, E>
  ) => boolean;
  readonly pendingEffect: (
    submission: ActionSubmissionRun<A, E>,
    input: I
  ) => Effect.Effect<void>;
  readonly interruptStaleEffect: (
    submission: ActionSubmissionRun<A, E>
  ) => Effect.Effect<void, ActionInterrupted>;
  readonly successEffect: (
    submission: ActionSubmissionRun<A, E>,
    input: I,
    value: A,
    plan: P | undefined
  ) => Effect.Effect<void>;
  readonly failureEffect: (
    submission: ActionSubmissionRun<A, E>,
    input: I,
    error: E
  ) => Effect.Effect<void>;
  readonly clearCurrentEffect: (token: object) => Effect.Effect<void>;
  /**
   * Synchronously clears visible state and captures currently active fibers.
   *
   * The returned Effect interrupts only the fibers that were active at capture
   * time. UI adapters use this host cleanup seam so later submissions cannot be
   * interrupted by a queued reset.
   */
  readonly captureResetEffect: () => Effect.Effect<void>;
  /** Lazy Effect-first reset for callers already composing inside Effect. */
  readonly resetEffect: () => Effect.Effect<void>;
}

export interface ActionSubmissionControllerOptions {
  /** Human-readable action name included in interruption diagnostics. */
  readonly actionName: string;
  /** Submission concurrency policy. Defaults to `latest`. */
  readonly concurrency?: ActionSubmissionConcurrency | undefined;
}

const previousFromState = <I, A, E, P>(
  state: ActionSubmissionState<I, A, E, P>
): { readonly present: boolean; readonly value: A | undefined } => {
  switch (state._tag) {
    case "Success":
      return { present: true, value: state.value };
    case "Failure":
    case "Pending":
      return { present: state.hasPrevious, value: state.previous };
    case "Idle":
      return { present: false, value: undefined };
  }
};

/** Creates the shared submission controller used by Action and StartAction clients. */
export const makeActionSubmissionController = <I, A, E, P = ResourceInvalidationPlan>(
  options: ActionSubmissionControllerOptions
): ActionSubmissionController<I, A, E, P> => {
  const state = Signal.make<ActionSubmissionState<I, A, E, P>>({ _tag: "Idle" });
  const invalidationPlan = Signal.make<P | undefined>(undefined);
  let version = 0;
  let currentSubmission: CurrentActionSubmission<A, E> | undefined;
  const activeSubmissions = new Map<object, ActionSubmissionFiber<A, E>>();

  const concurrency = options.concurrency ?? "latest";
  const isLatest = (submission: ActionSubmissionRun<A, E>): boolean =>
    submission.version === version;
  const acceptsStateUpdate = (submission: ActionSubmissionRun<A, E>): boolean =>
    !submission.updateOnlyLatest || isLatest(submission);
  const interruptFibersEffect = (
    fibers: ReadonlyArray<ActionSubmissionFiber<A, E>>
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
    invalidationPlan.set(undefined);
    state.set({ _tag: "Idle" });
    return interruptFibersEffect(fibers);
  };
  const resetEffect = (): Effect.Effect<void> =>
    Effect.suspend(() => captureResetEffect());

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
          updateOnlyLatest: true
        };
        activeSubmissions.set(submission.clearToken, fiber);

        if (concurrency !== "parallel") {
          currentSubmission = {
            token: submission.clearToken,
            fiber
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

        const previous = previousFromState(state.get());
        invalidationPlan.set(undefined);
        state.set({
          _tag: "Pending",
          input,
          previous: previous.value,
          hasPrevious: previous.present
        });
      }),
    interruptStaleEffect: (submission) =>
      Effect.suspend(() =>
        !activeSubmissions.has(submission.clearToken) ||
        (submission.interruptStale && !isLatest(submission))
          ? Effect.fail(new ActionInterrupted({ actionName: options.actionName }))
          : Effect.void
      ),
    successEffect: (submission, input, value, plan) =>
      Effect.sync(() => {
        if (!acceptsStateUpdate(submission)) {
          return;
        }

        invalidationPlan.set(plan);
        state.set({
          _tag: "Success",
          value,
          input,
          ...(plan === undefined ? {} : { invalidationPlan: plan })
        });
      }),
    failureEffect: (submission, input, error) =>
      Effect.sync(() => {
        if (!acceptsStateUpdate(submission)) {
          return;
        }

        const previous = previousFromState(state.get());
        state.set({
          _tag: "Failure",
          error,
          input,
          previous: previous.value,
          hasPrevious: previous.present
        });
      }),
    clearCurrentEffect: (token) =>
      Effect.sync(() => {
        activeSubmissions.delete(token);
        if (currentSubmission?.token === token) {
          currentSubmission = undefined;
        }
      }),
    captureResetEffect,
    resetEffect
  };
};
