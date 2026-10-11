import { Cause, Exit, Option } from "effect";
import { AsyncResult } from "effect/reactivity";

/**
 * @internal Returns the settled form of `result`: the same tag and payload with
 * `waiting: false`.
 */
export const settledResult = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): AsyncResult.AsyncResult<A, E> => {
  if (!result.waiting) {
    return result;
  }
  switch (result._tag) {
    case "Initial":
      return AsyncResult.initial();
    case "Success":
      return AsyncResult.success(result.value, { timestamp: result.timestamp });
    case "Failure":
      return AsyncResult.failure(result.cause, { previousSuccess: result.previousSuccess });
  }
};

/**
 * @internal The single Exit-to-AsyncResult settlement used by Resource loads
 * and Action submissions.
 *
 * - Success settles to `Success` stamped with `now`, which callers read from
 *   Effect `Clock` (never `Date.now()`).
 * - Typed failures, defects, and mixed causes settle to `Failure` carrying the
 *   full `Cause`, keeping the latest success from `previous` as
 *   `previousSuccess`.
 * - Interrupt-only causes are cancellation, not an outcome: the result returns
 *   to the prior settled state (`previous` with `waiting: false`). A superseding
 *   load or submission writes its own state afterwards.
 */
export const settleResult = <A, E>(
  exit: Exit.Exit<A, E>,
  previous: AsyncResult.AsyncResult<A, E>,
  now: number,
): AsyncResult.AsyncResult<A, E> => {
  if (Exit.isSuccess(exit)) {
    return AsyncResult.success(exit.value, { timestamp: now });
  }
  if (Cause.hasInterruptsOnly(exit.cause)) {
    return settledResult(previous);
  }
  return AsyncResult.failureWithPrevious(exit.cause, { previous: Option.some(previous) });
};
