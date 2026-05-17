import { Effect, Fiber } from "effect";
import type { AnySunfallArcRuntime } from "./runtime.js";

/**
 * Program background-fiber policy.
 *
 * Runtime-owned detached work enters the Runtime Spine through
 * `runtime.runFork(...)`. Acknowledged Program work is forked after explicit
 * `runtime.provide(...)` so Runtime Spine startup/provision failures remain in
 * the Program failure channel instead of terminating the queue processor before
 * it can complete dispatch acknowledgements.
 */
export interface ProgramRuntimeScheduler<ER> {
  /** Forks detached work through the owning Runtime Spine. */
  readonly forkRuntime: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E | ER>;
  /** Forks an already-provided Program effect that owns its error reporting. */
  readonly forkProvided: <A, E>(
    effect: Effect.Effect<A, E>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E>;
}

export const makeProgramRuntimeScheduler = <ER>(
  runtime: AnySunfallArcRuntime<ER>,
): ProgramRuntimeScheduler<ER> => ({
  forkRuntime: (effect, options) => runtime.runFork(effect, options),
  forkProvided: (effect, options) => Effect.runFork(effect, options),
});
