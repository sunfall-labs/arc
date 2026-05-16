import { type AnyEffectUiRuntime, defaultRuntime, type EffectUiRuntime } from "@effect-ui/core";
import { Effect, Fiber, Scope } from "effect";
import { responseWithScopeLifetimeEffect } from "./response-lifetime.js";
export { interruptStartHostFiberOnSignal } from "./start-abort-lifecycle.js";

/** Options shared by host facades that resolve an Effect to a platform Promise. */
export interface StartHostPromiseRunnerOptions<RuntimeError = never> {
  /** Runtime Spine that supplies services and Resource Store state before resolving the host Promise. */
  readonly runtime?: AnyEffectUiRuntime<RuntimeError> | EffectUiRuntime<any, RuntimeError>;
  /** Effect runtime options passed to the final `Effect.runPromise(...)` host seam. */
  readonly runOptions?: Effect.RunOptions;
}

/** Erased Runtime Runner seam used by callback-shaped host adapter facades. */
export interface StartForkRuntime<RuntimeError = never> {
  readonly runFork: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions
  ) => Fiber.Fiber<A, E | RuntimeError>;
}

/** Options shared by host facades that fork an Effect from a callback. */
export interface StartHostForkRunnerOptions<RuntimeError = never> {
  /** Runtime runner used to launch the callback-owned Effect. */
  readonly runtime?: StartForkRuntime<RuntimeError> | EffectUiRuntime<any, RuntimeError>;
  /** Effect runtime options passed to the host callback fork seam. */
  readonly runOptions?: Effect.RunOptions;
}

const hostPromiseRuntime = <RuntimeError>(
  runtime: StartHostPromiseRunnerOptions<RuntimeError>["runtime"] | undefined
): AnyEffectUiRuntime<RuntimeError> =>
  (runtime ?? defaultRuntime) as AnyEffectUiRuntime<RuntimeError>;

const hostForkRuntime = <RuntimeError>(
  runtime: StartHostForkRunnerOptions<RuntimeError>["runtime"] | undefined
): StartForkRuntime<RuntimeError> =>
  runtime ?? (defaultRuntime as unknown as StartForkRuntime<RuntimeError>);

/** Runs a host facade Effect to the platform Promise required by the host. */
export const runStartHostPromise = <A, E, R, RuntimeError = never>(
  effect: Effect.Effect<A, E, R>,
  options: StartHostPromiseRunnerOptions<RuntimeError> = {}
): Promise<A> =>
  Effect.runPromise(
    hostPromiseRuntime(options.runtime).provide(effect),
    options.runOptions
  );

/** Runs a scoped response Effect to the Promise shape required by Fetch hosts. */
export const runStartHostResponsePromise = <E, R, RuntimeError = never>(
  effect: Effect.Effect<Response, E, R | Scope.Scope>,
  options: StartHostPromiseRunnerOptions<RuntimeError> = {}
): Promise<Response> =>
  runStartHostPromise(responseWithScopeLifetimeEffect(effect), options);

/** Forks a scoped host facade Effect from callback-shaped hosts such as Node and Vite. */
export const forkStartHostEffect = <A, E, R, RuntimeError = never>(
  effect: Effect.Effect<A, E, R>,
  options: StartHostForkRunnerOptions<RuntimeError> = {}
): Fiber.Fiber<A, E | RuntimeError> =>
  hostForkRuntime(options.runtime).runFork(
    Effect.scoped(effect),
    options.runOptions
  ) as Fiber.Fiber<A, E | RuntimeError>;
