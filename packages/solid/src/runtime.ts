import {
  currentOrDefaultRuntime,
  makeRuntimeUiScope,
  makeRuntime,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type UiScope
} from "@effect-ui/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createContext, onCleanup, useContext, type JSX } from "solid-js";
import { createComponent } from "solid-js/web";

export const RuntimeContext = createContext<AnyEffectUiRuntime<never>>();

/** Props for providing an Effect UI runtime to Solid descendants. */
interface RuntimeProviderChildren {
  readonly children?: JSX.Element;
}

interface RuntimeProviderRuntimeProps<RuntimeServices = never, ER = never> extends RuntimeProviderChildren {
  /** Existing host-owned runtime. The provider exposes it and does not dispose it. */
  readonly runtime: EffectUiRuntime<RuntimeServices, ER> | AnyEffectUiRuntime<ER>;
  readonly source?: never;
}

interface RuntimeProviderSourceProps<RuntimeServices = never, ER = never> extends RuntimeProviderChildren {
  readonly runtime?: never;
  /** Runtime source owned by this Solid provider and disposed with its owner. */
  readonly source: ManagedRuntime.ManagedRuntime<RuntimeServices, ER> | Layer.Layer<RuntimeServices, ER, never>;
}

interface RuntimeProviderDefaultProps extends RuntimeProviderChildren {
  readonly runtime?: undefined;
  readonly source?: undefined;
}

export type RuntimeProviderProps<RuntimeServices = never, ER = never> =
  | RuntimeProviderRuntimeProps<RuntimeServices, ER>
  | RuntimeProviderSourceProps<RuntimeServices, ER>
  | RuntimeProviderDefaultProps;

/** Creates an Effect UI runtime for Solid applications. */
export const createEffectRuntime = makeRuntime;

/** Reads the nearest Solid runtime context, falling back to the current/default runtime. */
export const useRuntime = <ER = never>(): AnyEffectUiRuntime<ER> =>
  (useContext(RuntimeContext) ?? currentOrDefaultRuntime()) as AnyEffectUiRuntime<ER>;

/**
 * Provides an Effect UI runtime to Solid children.
 *
 * Pass an existing runtime when the host owns lifecycle. Pass a runtime source
 * to let the provider create and dispose a runtime with the Solid owner.
 */
export const RuntimeProvider = <RuntimeServices = never, ER = never>(
  props: RuntimeProviderProps<RuntimeServices, ER>
): JSX.Element => {
  const source = props.source;
  const ownsRuntime = props.runtime === undefined;
  const runtime = props.runtime ?? makeRuntime(source);
  if (ownsRuntime) {
    onCleanup(() => {
      void Effect.runFork(runtime.disposeEffect.pipe(Effect.catch(() => Effect.void)));
    });
  }

  return createComponent(RuntimeContext.Provider, {
    value: runtime as unknown as AnyEffectUiRuntime<never>,
    get children() {
      return runWithRuntime(runtime as unknown as AnyEffectUiRuntime<ER>, () => props.children);
    }
  });
};

/** Creates a `UiScope` bound to the current Solid owner cleanup. */
export const createComponentScope = <A>(f: (scope: UiScope) => A): A => {
  const runtime = useRuntime();
  const scope = makeRuntimeUiScope(runtime);
  onCleanup(() => {
    void runtime.runFork(scope.disposeEffect().pipe(Effect.catch(() => Effect.void)));
  });
  return runWithScope(scope, () => f(scope));
};
