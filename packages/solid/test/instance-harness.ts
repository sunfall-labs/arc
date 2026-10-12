import type { AnySunfallArcRuntime } from "@sunfall/arc-core";
import type { Effect } from "effect";
import { Component } from "../src/index.js";

/**
 * Test helper: runs a setup-time binding in a fresh Component instance under
 * the current Solid owner and returns what it produced. Disposing the owner
 * disposes the instance (closing its Scope).
 */
export const bindInInstance = <A>(
  // Any Sunfall Arc runtime; its service set is erased for the harness.
  runtime: object,
  binding: Effect.Effect<A, unknown, unknown>,
): A => {
  let bound: { readonly value: A } | undefined;
  const Harness = Component.define("Harness", function* () {
    bound = { value: yield* binding };
    return () => undefined;
  }) as Component<{}, never, never>;
  Component.embed(Harness, runtime as AnySunfallArcRuntime<never>)({});
  if (bound === undefined) {
    throw new Error("The binding did not complete synchronously.");
  }
  return bound.value;
};
