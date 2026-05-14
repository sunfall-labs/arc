import { isResourceRef, Resource } from "./resource.js";
import { isSignal, type ReadableSignal } from "./signal.js";

/** A signal-like readable value accepted by the `read` helper. */
export type ReadableValue<A> = ReadableSignal<A>;

/**
 * Reads a signal or already-loaded resource ref in render code.
 *
 * Signals return their current value. Resource refs delegate to Resource.read,
 * which may throw ResourcePending for missing data or ResourceFailure for failed
 * loads.
 */
export function read<A>(value: ReadableSignal<A>): A;
export function read<I, A, E>(value: Resource.Ref<I, A, E, never>): A;
export function read(value: unknown): unknown {
  if (isSignal(value)) {
    return value.get();
  }

  if (isResourceRef(value)) {
    return Resource.read(value);
  }

  return value;
}
