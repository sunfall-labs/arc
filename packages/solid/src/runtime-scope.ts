import {
  makeRuntimeUiScopeFrame,
  type AnySunfallArcRuntime,
  type UiScope,
} from "@sunfall/arc-core";
import { onCleanup } from "solid-js";

/**
 * Internal: runs `f` inside a `UiScope` frame for `runtime`, disposed with the
 * current Solid owner. `createComponentScope` binds the runtime from context;
 * Components bind the runtime their setup ran in.
 */
export const createRuntimeScope = <A, ER>(
  runtime: AnySunfallArcRuntime<ER>,
  f: (scope: UiScope) => A,
): A => {
  const frame = makeRuntimeUiScopeFrame(runtime);
  onCleanup(() => {
    frame.dispose();
  });
  return frame.run(() => f(frame.scope));
};
