import type { AnySunfallArcRuntime, SunfallArcRuntime } from "@sunfall/arc-core";
import { createComponent, createMemo, getOwner, runWithOwner, type Owner } from "solid-js";
import { RuntimeContext } from "../src/index.js";

/**
 * Test helper: runs `f` under a `RuntimeContext` provider mounted in the
 * current Solid owner and returns its result, the way `RuntimeProvider`
 * children see the runtime. `f` runs outside any computation, so accessors it
 * creates behave like hooks called from imperative test code.
 */
export const withRuntimeContext = <A, R, ER>(
  runtime: SunfallArcRuntime<R, ER> | AnySunfallArcRuntime<ER>,
  f: () => A,
): A => {
  let providerOwner: Owner | null = null;
  const node = createComponent(RuntimeContext, {
    value: runtime as unknown as AnySunfallArcRuntime<never>,
    get children() {
      providerOwner = getOwner();
      return undefined;
    },
  }) as unknown as () => unknown;
  // An eager memo keeps the provider's lazy children subscribed for the
  // lifetime of the enclosing owner, so hook cleanups run only on dispose.
  createMemo(() => node())();
  return runWithOwner(providerOwner, f);
};
