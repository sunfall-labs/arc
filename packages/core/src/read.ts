import { isResourceRef, Resource } from "./resource.js";
import { isSignal, type ReadableSignal } from "./signal.js";

export type ReadableValue<A> = ReadableSignal<A>;

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
