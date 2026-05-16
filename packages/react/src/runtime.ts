import {
  currentOrDefaultRuntime,
  invokeEffectInput,
  makeRuntimeUiScopeFrame,
  makeRuntime,
  runWithScope,
  runWithRuntime,
  type AnyEffectUiRuntime,
  type EffectInput,
  type EffectUiRuntime,
  type RuntimeUiScopeFrame,
  type UiScope
} from "@effect-ui/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  type ReactNode
} from "react";

/** React context carrying the active Effect UI Runtime Spine. */
export const RuntimeContext = createContext<AnyEffectUiRuntime<never> | undefined>(undefined);

/** Props for providing an Effect UI runtime to React descendants. */
interface RuntimeProviderChildren {
  readonly children?: ReactNode;
}

interface RuntimeProviderRuntimeProps<RuntimeServices = never, ER = never> extends RuntimeProviderChildren {
  /** Existing host-owned runtime. The provider exposes it and does not dispose it. */
  readonly runtime: EffectUiRuntime<RuntimeServices, ER> | AnyEffectUiRuntime<ER>;
  readonly source?: never;
  readonly onDisposeFailure?: never;
}

interface RuntimeProviderSourceProps<RuntimeServices = never, ER = never> extends RuntimeProviderChildren {
  readonly runtime?: never;
  /** Runtime source owned by this React provider and disposed with its component. */
  readonly source: ManagedRuntime.ManagedRuntime<RuntimeServices, ER> | Layer.Layer<RuntimeServices, ER, never>;
  /**
   * Observes failures from provider-owned runtime disposal.
   *
   * Promise-shaped observers are rejected by `EffectInput`; observer failures
   * are ignored after the disposal failure has been reported.
   */
  readonly onDisposeFailure?: (error: unknown) => EffectInput<void, unknown>;
}

interface RuntimeProviderDefaultProps extends RuntimeProviderChildren {
  readonly runtime?: undefined;
  readonly source?: undefined;
  /**
   * Observes failures from provider-owned runtime disposal.
   *
   * Promise-shaped observers are rejected by `EffectInput`; observer failures
   * are ignored after the disposal failure has been reported.
   */
  readonly onDisposeFailure?: (error: unknown) => EffectInput<void, unknown>;
}

/** Props accepted by React `RuntimeProvider` for host-owned or provider-owned runtimes. */
export type RuntimeProviderProps<RuntimeServices = never, ER = never> =
  | RuntimeProviderRuntimeProps<RuntimeServices, ER>
  | RuntimeProviderSourceProps<RuntimeServices, ER>
  | RuntimeProviderDefaultProps;

/** Creates an Effect UI runtime for React applications. */
export const createEffectRuntime = makeRuntime;

/** Reads the nearest React runtime context, falling back to the current/default runtime. */
export const useRuntime = <ER = never>(): AnyEffectUiRuntime<ER> =>
  (useContext(RuntimeContext) ?? currentOrDefaultRuntime()) as AnyEffectUiRuntime<ER>;

/**
 * Provides an Effect UI runtime to React children.
 *
 * Pass an existing runtime when the host owns lifecycle. Pass a runtime source
 * to let the provider create and dispose a runtime with the React component.
 */
export const RuntimeProvider = <RuntimeServices = never, ER = never>(
  props: RuntimeProviderProps<RuntimeServices, ER>
): ReactNode => {
  const ownedRuntimeRef = useRef<{
    readonly source: RuntimeProviderSourceProps<RuntimeServices, ER>["source"] | undefined;
    readonly runtime: AnyEffectUiRuntime<ER>;
  } | undefined>(undefined);
  const ownsRuntime = props.runtime === undefined;

  if (ownsRuntime) {
    const source = props.source;
    if (ownedRuntimeRef.current === undefined || ownedRuntimeRef.current.source !== source) {
      ownedRuntimeRef.current = {
        source,
        runtime: makeRuntime(source) as AnyEffectUiRuntime<ER>
      };
    }
  } else {
    ownedRuntimeRef.current = undefined;
  }

  const runtime = (props.runtime ?? ownedRuntimeRef.current?.runtime) as AnyEffectUiRuntime<ER>;
  const onDisposeFailureRef = useRef(props.onDisposeFailure);
  onDisposeFailureRef.current = props.onDisposeFailure;

  useEffect(() => {
    if (!ownsRuntime) {
      return undefined;
    }

    return () => {
      void Effect.runFork(
        runtime.disposeEffect.pipe(
          Effect.catch((error) =>
            onDisposeFailureRef.current === undefined
              ? Effect.void
              : invokeEffectInput("ReactRuntimeProvider.onDisposeFailure", onDisposeFailureRef.current, error).pipe(
                  Effect.catchCause(() => Effect.void),
                  Effect.asVoid
                )
          )
        )
      );
    };
  }, [ownsRuntime, runtime]);

  return createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: props.children
  });
};

/** Creates a `UiScope` bound to the current React component cleanup. */
export const useComponentScope = (): UiScope => {
  const runtime = useRuntime();
  const scopeRef = useRef<{
    readonly runtime: AnyEffectUiRuntime<unknown>;
    readonly frame: RuntimeUiScopeFrame<unknown>;
  } | undefined>(undefined);

  if (scopeRef.current === undefined || scopeRef.current.runtime !== runtime) {
    scopeRef.current = {
      runtime,
      frame: makeRuntimeUiScopeFrame(runtime)
    };
  }

  const frame = scopeRef.current.frame;

  useEffect(() => {
    return () => {
      void runtime.runFork(frame.disposeEffect());
    };
  }, [runtime, frame]);

  return frame.scope;
};

/** Runs synchronous construction while the component `UiScope` is ambient. */
export const useScoped = <A>(f: (scope: UiScope) => A): A => {
  const runtime = useRuntime();
  const scope = useComponentScope();
  return runWithRuntime(runtime, () => runWithScope(scope, () => f(scope)));
};
