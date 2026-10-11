import type { AnySunfallArcRuntime } from "@sunfall/arc-core";
import { RuntimeContext } from "@sunfall/arc-solid";
import { createComponent, createMemo } from "solid-js";

/**
 * Test helper: runs `f` under a `RuntimeContext` provider in the current Solid
 * owner and returns its result, the way `RuntimeProvider` children see it.
 */
export const withRuntimeContext = <A>(
  // Any concrete runtime; service-typed runtimes are erased for the context.
  runtime: object,
  f: () => A,
): A => {
  let result: A | undefined;
  const node = createComponent(RuntimeContext, {
    value: runtime as AnySunfallArcRuntime<never>,
    get children() {
      result = f();
      return undefined;
    },
  }) as unknown as () => unknown;
  // An eager memo keeps the provider's lazy children subscribed for the
  // lifetime of the enclosing owner, so hook cleanups run only on dispose.
  createMemo(() => node())();
  return result as A;
};
