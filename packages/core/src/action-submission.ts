import { Data, Effect, Fiber } from "effect";
import type { ResourceInvalidationPlan } from "./resource.js";
import type { EffectUiRuntime } from "./runtime.js";
import { Signal, type ReadableSignal } from "./signal.js";

export type ActionSubmissionConcurrency = "latest" | "parallel" | "exhaust";

export class ActionInterrupted extends Data.TaggedError("ActionInterrupted")<{
  readonly actionName: string;
}> {}

export type ActionSubmissionState<I, A, E = never, P = ResourceInvalidationPlan> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Pending"; readonly input: I; readonly previous?: A }
  | { readonly _tag: "Success"; readonly value: A; readonly input: I; readonly invalidationPlan?: P }
  | { readonly _tag: "Failure"; readonly error: E; readonly input: I; readonly previous?: A };

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
  readonly resetEffect: () => Effect.Effect<void>;
  readonly reset: <R, ER>(runtime: EffectUiRuntime<R, ER>) => void;
}

export interface ActionSubmissionControllerOptions {
  readonly actionName: string;
  readonly concurrency?: ActionSubmissionConcurrency | undefined;
}

const previousFromState = <I, A, E, P>(state: ActionSubmissionState<I, A, E, P>): A | undefined => {
  switch (state._tag) {
    case "Success":
      return state.value;
    case "Failure":
    case "Pending":
      return state.previous;
    case "Idle":
      return undefined;
  }
};

export const makeActionSubmissionController = <I, A, E, P = ResourceInvalidationPlan>(
  options: ActionSubmissionControllerOptions
): ActionSubmissionController<I, A, E, P> => {
  const state = Signal.make<ActionSubmissionState<I, A, E, P>>({ _tag: "Idle" });
  const invalidationPlan = Signal.make<P | undefined>(undefined);
  let version = 0;
  let currentSubmission: CurrentActionSubmission<A, E> | undefined;

  const concurrency = options.concurrency ?? "latest";
  const isLatest = (submission: ActionSubmissionRun<A, E>): boolean =>
    submission.version === version;
  const acceptsStateUpdate = (submission: ActionSubmissionRun<A, E>): boolean =>
    !submission.updateOnlyLatest || isLatest(submission);
  const resetEffect = (): Effect.Effect<void> =>
    Effect.sync(() => {
      version++;
      invalidationPlan.set(undefined);
      state.set({ _tag: "Idle" });
    });

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
          ...(previous === undefined ? {} : { previous })
        });
      }),
    interruptStaleEffect: (submission) =>
      Effect.suspend(() =>
        submission.interruptStale && !isLatest(submission)
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
          ...(previous === undefined ? {} : { previous })
        });
      }),
    clearCurrentEffect: (token) =>
      Effect.sync(() => {
        if (currentSubmission?.token === token) {
          currentSubmission = undefined;
        }
      }),
    resetEffect,
    reset: (runtime) => {
      const submission = currentSubmission;
      if (submission?.fiber) {
        void runtime.runFork(Fiber.interrupt(submission.fiber));
      }
      currentSubmission = undefined;
      runtime.runSync(resetEffect());
    }
  };
};
