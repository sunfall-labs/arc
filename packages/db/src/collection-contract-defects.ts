import { EffectInputCallbackError } from "@sunfall/arc-core";
import { Cause, Effect } from "effect";
import { CollectionSnapshotCodecError } from "./collection-snapshot-codec.js";

/**
 * A broken Collection contract: a sync, persistence, or projection callback
 * that throws or returns a Promise, or a row its output schema rejects.
 */
export type CollectionContractViolation = CollectionSnapshotCodecError | EffectInputCallbackError;

const isCollectionContractViolation = (error: unknown): error is CollectionContractViolation =>
  error instanceof CollectionSnapshotCodecError || error instanceof EffectInputCallbackError;

/**
 * The cause a Collection load records for `error`: a contract violation is a
 * defect, so loads fail only with the collection's declared `E` (the same rule
 * Resources follow).
 */
export const collectionLoadFailureCause = <E>(
  error: E | CollectionContractViolation,
): Cause.Cause<Exclude<E, CollectionContractViolation>> =>
  isCollectionContractViolation(error)
    ? Cause.die(error)
    : Cause.fail(error as Exclude<E, CollectionContractViolation>);

/** Re-raises contract violations in `effect`'s failure channel as defects. */
export const collectionContractDefects = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, CollectionContractViolation>, R> =>
  Effect.catch(effect, (error) => Effect.failCause(collectionLoadFailureCause(error)));
