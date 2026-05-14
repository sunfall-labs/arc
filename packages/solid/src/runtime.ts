import {
  currentOrDefaultRuntime,
  defaultRuntime,
  makeRuntime,
  runFork,
  runWithRuntime,
  runWithScope,
  UiScope,
  type EffectUiRuntime,
  type RuntimeSource
} from "@effect-ui/core";
import { Effect } from "effect";
import { createContext, onCleanup, useContext, type JSX } from "solid-js";
import { createComponent } from "solid-js/web";

export const RuntimeContext = createContext<EffectUiRuntime<unknown, unknown>>();

/** Props for providing an Effect UI runtime to Solid descendants. */
export interface RuntimeProviderProps {
  readonly runtime?: EffectUiRuntime<unknown, unknown>;
  readonly source?: RuntimeSource<unknown, unknown>;
  readonly children?: JSX.Element;
}

/** Creates an Effect UI runtime for Solid applications. */
export const createEffectRuntime = makeRuntime;

/** Reads the nearest Solid runtime context, falling back to the current/default runtime. */
export const useRuntime = (): EffectUiRuntime<unknown, unknown> =>
  useContext(RuntimeContext) ?? currentOrDefaultRuntime();

/**
 * Provides an Effect UI runtime to Solid children.
 *
 * Pass an existing runtime when the host owns lifecycle. Pass a runtime source
 * to let the provider create and dispose a runtime with the Solid owner.
 */
export const RuntimeProvider = (props: RuntimeProviderProps): JSX.Element => {
  const runtime = props.runtime ?? (props.source ? makeRuntime(props.source) : defaultRuntime);
  if (!props.runtime && props.source) {
    onCleanup(() => {
      void runtime.runFork(runtime.disposeEffect);
    });
  }

  return createComponent(RuntimeContext.Provider, {
    value: runtime,
    get children() {
      return runWithRuntime(runtime, () => props.children);
    }
  });
};

/** Creates a `UiScope` bound to the current Solid owner cleanup. */
export const createComponentScope = <A>(f: (scope: UiScope) => A): A => {
  const scope = new UiScope();
  onCleanup(() => {
    void runFork(scope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
  });
  return runWithScope(scope, () => f(scope));
};
