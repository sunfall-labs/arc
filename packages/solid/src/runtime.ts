import {
  currentOrDefaultRuntime,
  disposeRuntimeProviderLifecycleEffect,
  makeRuntimeUiScopeFrame,
  makeRuntime,
  makeRuntimeProviderLifecycleEntry,
  runWithRuntime,
  type AnySunfallArcRuntime,
  type EffectInput,
  type SunfallArcRuntime,
  type RuntimeDisposeError,
  type RuntimeProviderLifecycleEntry,
  type UiScope,
} from "@sunfall/arc-core";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  createContext,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  onCleanup,
  useContext,
  type JSX,
} from "solid-js";
import { createComponent } from "solid-js/web";

/** Solid context carrying the active Sunfall Arc Runtime Spine. */
export const RuntimeContext = createContext<AnySunfallArcRuntime<never>>();

/** Props for providing an Sunfall Arc runtime to Solid descendants. */
interface RuntimeProviderChildren {
  readonly children?: JSX.Element;
}

interface RuntimeProviderRuntimeProps<
  RuntimeServices = never,
  ER = never,
> extends RuntimeProviderChildren {
  /** Existing host-owned runtime. The provider exposes it and does not dispose it. */
  readonly runtime: SunfallArcRuntime<RuntimeServices, ER> | AnySunfallArcRuntime<ER>;
  readonly source?: never;
  readonly onDisposeFailure?: never;
}

interface RuntimeProviderSourceProps<
  RuntimeServices = never,
  ER = never,
> extends RuntimeProviderChildren {
  readonly runtime?: never;
  /** Runtime source owned by this Solid provider and disposed with its owner. */
  readonly source:
    | ManagedRuntime.ManagedRuntime<RuntimeServices, ER>
    | Layer.Layer<RuntimeServices, ER, never>;
  /**
   * Observes failures from provider-owned runtime disposal.
   *
   * Promise-shaped observers are rejected by `EffectInput`; observer failures
   * are ignored after the disposal failure has been reported.
   */
  readonly onDisposeFailure?: (error: RuntimeDisposeError) => EffectInput<void, unknown>;
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
  readonly onDisposeFailure?: (error: RuntimeDisposeError) => EffectInput<void, unknown>;
}

/** Props accepted by Solid `RuntimeProvider` for host-owned or provider-owned runtimes. */
export type RuntimeProviderProps<RuntimeServices = never, ER = never> =
  | RuntimeProviderRuntimeProps<RuntimeServices, ER>
  | RuntimeProviderSourceProps<RuntimeServices, ER>
  | RuntimeProviderDefaultProps;

/** Creates an Sunfall Arc runtime for Solid applications. */
export const createEffectRuntime = makeRuntime;

/** Reads the nearest Solid runtime context, falling back to the current/default runtime. */
export const useRuntime = <ER = never>(): AnySunfallArcRuntime<ER> =>
  (useContext(RuntimeContext) ?? currentOrDefaultRuntime()) as AnySunfallArcRuntime<ER>;

/**
 * Provides an Sunfall Arc runtime to Solid children.
 *
 * Pass an existing runtime when the host owns lifecycle. Pass a runtime source
 * to let the provider create and dispose a runtime with the Solid owner.
 */
export const RuntimeProvider = <RuntimeServices = never, ER = never>(
  props: RuntimeProviderProps<RuntimeServices, ER>,
): JSX.Element => {
  const entry = createMemo<RuntimeProviderLifecycleEntry<ER>>(() =>
    props.runtime === undefined
      ? makeRuntimeProviderLifecycleEntry({ source: props.source })
      : makeRuntimeProviderLifecycleEntry({ runtime: props.runtime }),
  );
  const [view, setView] = createSignal<JSX.Element>();
  let disposeEntry: (() => void) | undefined;

  const mountEntry = (current: RuntimeProviderLifecycleEntry<ER>): void => {
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
        },
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

const RuntimeProviderInstance = <ER>(props: {
  readonly entry: RuntimeProviderLifecycleEntry<ER>;
  readonly onDisposeFailure?:
    | ((error: RuntimeDisposeError) => EffectInput<void, unknown>)
    | undefined;
  readonly children?: JSX.Element;
}): JSX.Element => {
  if (props.entry.ownsRuntime) {
    onCleanup(() => {
      void Effect.runFork(
        disposeRuntimeProviderLifecycleEffect(props.entry, {
          observerOperation: "SolidRuntimeProvider.onDisposeFailure",
          onDisposeFailure: props.onDisposeFailure,
        }),
      );
    });
  }

  return createComponent(RuntimeContext.Provider, {
    value: props.entry.runtime as unknown as AnySunfallArcRuntime<never>,
    get children() {
      return runWithRuntime(props.entry.runtime, () => props.children);
    },
  });
};

/** Creates a `UiScope` bound to the current Solid owner cleanup. */
export const createComponentScope = <A>(f: (scope: UiScope) => A): A => {
  const runtime = useRuntime();
  const frame = makeRuntimeUiScopeFrame(runtime);
  onCleanup(() => {
    frame.dispose();
  });
  return frame.run(() => f(frame.scope));
};
