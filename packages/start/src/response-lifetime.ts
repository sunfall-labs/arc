import { Effect, Exit, Scope } from "effect";
import {
  responseWithStreamFinalizer,
  type StartResponseStreamFinalizeEvent,
  type StartResponseStreamRunner
} from "./streaming.js";

export interface ResponseScopeLifetimeOptions {
  readonly runEffect?: StartResponseStreamRunner;
  readonly abortSignal?: AbortSignal;
  readonly abortTeardownReason?: string;
  readonly onCleanup?: () => void;
}

const streamFinalizeExit = (
  event: StartResponseStreamFinalizeEvent
): Exit.Exit<void, StartResponseStreamFinalizeEvent> =>
  event.status === "success" ? Exit.void : Exit.fail(event);

/**
 * Runs a response-producing Effect in a manually-owned Scope and releases that
 * Scope when the response body closes, errors, or is cancelled.
 */
export const responseWithScopeLifetimeEffect = <E, R>(
  effect: Effect.Effect<Response, E, R | Scope.Scope>,
  options: ResponseScopeLifetimeOptions = {}
): Effect.Effect<Response, E, Exclude<R, Scope.Scope>> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("sequential");
    let closed = false;
    let cleaned = false;
    const runCleanup = Effect.sync(() => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      options.onCleanup?.();
    });
    const closeScope = (exit: Exit.Exit<unknown, unknown>): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (closed) {
          return Effect.void;
        }

        closed = true;
        return Scope.close(scope, exit).pipe(Effect.ensuring(runCleanup));
      });

    const responseExit = yield* Effect.exit(Scope.provide(effect, scope));
    if (Exit.isFailure(responseExit)) {
      yield* closeScope(responseExit);
      return yield* Effect.failCause(responseExit.cause);
    }

    const response = responseExit.value;
    if (!response.body) {
      yield* closeScope(Exit.void);
      return response;
    }

    const onFinalize = (event: StartResponseStreamFinalizeEvent) =>
      closeScope(streamFinalizeExit(event));
    const finalizerOptions = {
      ...(options.runEffect === undefined ? {} : { runEffect: options.runEffect }),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.abortTeardownReason === undefined
        ? {}
        : { abortTeardownReason: options.abortTeardownReason }),
      onFinalize
    };
    return responseWithStreamFinalizer(response, finalizerOptions);
  }) as Effect.Effect<Response, E, Exclude<R, Scope.Scope>>;
