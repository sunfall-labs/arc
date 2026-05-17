import { Effect, type Schedule } from "effect";
import type { AnyCollection } from "./collection-contract.js";

/** Applies the shared collection retry policy to load and mutation Effects. */
export const withCollectionPolicyRetry = <A, E, R>(
  definition: AnyCollection,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const retry = definition.options.policy?.retry;
  return retry ? Effect.retry(effect, retry as Schedule.Schedule<unknown, E>) : effect;
};
