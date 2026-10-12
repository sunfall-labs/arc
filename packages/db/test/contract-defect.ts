import { Cause, Effect, Exit } from "effect";
import { expect } from "vitest";

/**
 * The defect a Collection contract violation (a `CollectionSnapshotCodecError`
 * or `EffectInputCallbackError`) leaves in `cause`. Asserts the violation is the
 * only reason: it must never also surface as a typed failure.
 */
export const contractDefect = (cause: Cause.Cause<unknown>): unknown => {
  expect(cause.reasons.filter(Cause.isFailReason)).toEqual([]);
  const defects = cause.reasons.filter(Cause.isDieReason);
  expect(defects).toHaveLength(1);
  return defects[0]?.defect;
};

/** The contract violation defect of a failed exit (see `contractDefect`). */
export const exitContractDefect = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit)
    ? contractDefect(exit.cause)
    : expect.fail("Expected a contract violation defect, but the Effect succeeded.");

/** Runs `effect` and yields the contract violation it dies with (see `contractDefect`). */
export const flipContractDefect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<unknown, never, R> => Effect.map(Effect.exit(effect), exitContractDefect);
