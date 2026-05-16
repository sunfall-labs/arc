import {
  currentOrDefaultRuntime,
  invokeEffectInput,
  makeRuntimeUiScope,
  makeRuntime,
  runWithRuntime,
  runWithScope,
  type AnyEffectUiRuntime,
  type EffectInput,
  type EffectUiRuntime,
  type UiScope
} from "@effect-ui/core";
import { Effect, Layer, ManagedRuntime } from "effect";
import { createContext, createMemo, createRenderEffect, createRoot, createSignal, onCleanup, useContext, type JSX } from "solid-js";
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
  readonly onDisposeFailure?: never;
}

interface RuntimeProviderSourceProps<RuntimeServices = never, ER = never> extends RuntimeProviderChildren {
  readonly runtime?: never;
  /** Runtime source owned by this Solid provider and disposed with its owner. */
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

export type RuntimeProviderProps<RuntimeServices = never, ER = never> =
  | RuntimeProviderRuntimeProps<RuntimeServices, ER>
  | RuntimeProviderSourceProps<RuntimeServices, ER>
  | RuntimeProviderDefaultProps;

interface RuntimeProviderEntry<ER> {
  readonly runtime: AnyEffectUiRuntime<ER>;
  readonly ownsRuntime: boolean;
}

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
  const entry = createMemo<RuntimeProviderEntry<ER>>(() => ({
    runtime: (props.runtime ?? makeRuntime(props.source)) as AnyEffectUiRuntime<ER>,
    ownsRuntime: props.runtime === undefined
  }));
  const [view, setView] = createSignal<JSX.Element>();
  let disposeEntry: (() => void) | undefined;

  const mountEntry = (current: RuntimeProviderEntry<ER>): void => {
    disposeEntry?.();
    createRoot((dispose) => {
      disposeEntry = dispose;
      const next = createComponent(RuntimeProviderInstance, {
        entry: current,
        get onDisposeFailure() {
          return props.onDisposeFailure;
        },
        get children() {
          return props.children;
        }
      });
      setView(() => next);
    });
  };

  let mountedEntry = entry();
  mountEntry(mountedEntry);
  createRenderEffect(() => {
    const current = entry();
    if (current === mountedEntry) {
      return;
    }
    mountedEntry = current;
    mountEntry(current);
  });
  onCleanup(() => disposeEntry?.());

  return view as unknown as JSX.Element;
};

const RuntimeProviderInstance = <ER>(
  props: {
    readonly entry: RuntimeProviderEntry<ER>;
    readonly onDisposeFailure?: ((error: unknown) => EffectInput<void, unknown>) | undefined;
    readonly children?: JSX.Element;
  }
): JSX.Element => {
  if (props.entry.ownsRuntime) {
    onCleanup(() => {
      void Effect.runFork(
        props.entry.runtime.disposeEffect.pipe(
          Effect.catch((error) =>
            props.onDisposeFailure === undefined
              ? Effect.void
              : invokeEffectInput("SolidRuntimeProvider.onDisposeFailure", props.onDisposeFailure, error).pipe(
                  Effect.catchCause(() => Effect.void),
                  Effect.asVoid
                )
          )
        )
      );
    });
  }

  return createComponent(RuntimeContext.Provider, {
    value: props.entry.runtime as unknown as AnyEffectUiRuntime<never>,
    get children() {
      return runWithRuntime(props.entry.runtime, () => props.children);
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
