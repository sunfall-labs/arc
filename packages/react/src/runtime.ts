import {
  currentOrDefaultRuntime,
  disposeRuntimeProviderLifecycleEffect,
  invokeEffectInput,
  makeRuntime,
  makeRuntimeProviderLifecycleEntry,
  runWithScope,
  runWithRuntime,
  type AnyEffectUiRuntime,
  type EffectInput,
  type EffectUiRuntime,
  type ForkScopedOptions,
  type RuntimeDisposeError,
  type RuntimeProviderLifecycleEntry,
  type RuntimeUiScopeFrame,
  type UiScopeOptions,
  UiScope,
  UiScopeDisposed,
} from "@effect-ui/core";
import { Effect, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

/** React context carrying the active Effect UI Runtime Spine. */
export const RuntimeContext = createContext<AnyEffectUiRuntime<never> | undefined>(undefined);

/** Props for providing an Effect UI runtime to React descendants. */
interface RuntimeProviderChildren {
  readonly children?: ReactNode;
}

interface RuntimeProviderRuntimeProps<
  RuntimeServices = never,
  ER = never,
> extends RuntimeProviderChildren {
  /** Existing host-owned runtime. The provider exposes it and does not dispose it. */
  readonly runtime: EffectUiRuntime<RuntimeServices, ER> | AnyEffectUiRuntime<ER>;
  readonly source?: never;
  readonly onDisposeFailure?: never;
}

interface RuntimeProviderSourceProps<
  RuntimeServices = never,
  ER = never,
> extends RuntimeProviderChildren {
  readonly runtime?: never;
  /** Runtime source owned by this React provider and disposed with its component. */
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

/** Policy for `onDispose(...)` calls made while React is still rendering. */
export type ReactPreCommitFinalizerPolicy = "reject" | "buffer";

interface ReactCommitUiScopeOptions extends UiScopeOptions {
  readonly preCommitFinalizers?: ReactPreCommitFinalizerPolicy;
}

class ReactCommitUiScope extends UiScope {
  private readonly preCommitFinalizers: ReactPreCommitFinalizerPolicy;
  private readonly committedRenderFinalizers: Array<() => EffectInput<void>> = [];
  private pendingRenderFinalizers: Array<() => EffectInput<void>> | undefined;
  private currentRenderFinalizers: Array<() => EffectInput<void>> | undefined;
  private renderFinalizerGroupInstalled = false;
  private inRenderPass = false;
  private committed = false;

  constructor(options: ReactCommitUiScopeOptions = {}) {
    super(options);
    this.preCommitFinalizers = options.preCommitFinalizers ?? "reject";
  }

  commit(): void {
    if (!this.committed) {
      this.committed = true;
      if (this.preCommitFinalizers === "buffer") {
        this.installRenderFinalizerGroup();
      }
    }

    if (this.pendingRenderFinalizers !== undefined) {
      this.committedRenderFinalizers.splice(
        0,
        this.committedRenderFinalizers.length,
        ...this.pendingRenderFinalizers,
      );
      this.pendingRenderFinalizers = undefined;
    }
  }

  discardPreCommitFinalizers(): void {
    this.pendingRenderFinalizers = undefined;
    this.currentRenderFinalizers = undefined;
    this.inRenderPass = false;
  }

  beginRenderPass(): void {
    this.currentRenderFinalizers = this.preCommitFinalizers === "buffer" ? [] : undefined;
    this.inRenderPass = true;
  }

  runRenderPass<A>(f: () => A): A {
    this.beginRenderPass();
    try {
      const value = f();
      this.finishRenderPass(true);
      return value;
    } catch (error) {
      this.finishRenderPass(false);
      throw error;
    }
  }

  private finishRenderPass(success: boolean): void {
    if (
      success &&
      this.preCommitFinalizers === "buffer" &&
      this.currentRenderFinalizers !== undefined
    ) {
      this.pendingRenderFinalizers = this.currentRenderFinalizers;
    }
    this.currentRenderFinalizers = undefined;
    this.inRenderPass = false;
  }

  private assertCommitted(operation: string): void {
    if (!this.committed) {
      throw new UiScopeDisposed({ operation });
    }
  }

  private drainCommittedRenderFinalizers(): Array<() => EffectInput<void>> {
    return this.committedRenderFinalizers.splice(0).reverse();
  }

  private runCommittedRenderFinalizersEffect(): Effect.Effect<void> {
    const drainFinalizers = () => this.drainCommittedRenderFinalizers();
    return Effect.gen(function* () {
      const finalizers = yield* Effect.sync(drainFinalizers);
      for (const finalizer of finalizers) {
        yield* invokeEffectInput("ReactRouteRenderScope.finalizer", finalizer).pipe(
          Effect.catchCause(() => Effect.void),
        );
      }
    });
  }

  private installRenderFinalizerGroup(): void {
    if (this.renderFinalizerGroupInstalled) {
      return;
    }
    this.renderFinalizerGroupInstalled = true;
    super.addFinalizer(() => this.runCommittedRenderFinalizersEffect());
  }

  override addFinalizer(finalizer: () => EffectInput<void>): void {
    if (this.inRenderPass && this.preCommitFinalizers === "buffer") {
      this.currentRenderFinalizers?.push(finalizer);
      return;
    }

    if (this.inRenderPass) {
      throw new UiScopeDisposed({ operation: "React.useComponentScope.addFinalizer" });
    }

    if (!this.committed && this.preCommitFinalizers === "buffer") {
      this.pendingRenderFinalizers = [...(this.pendingRenderFinalizers ?? []), finalizer];
      return;
    }

    this.assertCommitted("React.useComponentScope.addFinalizer");
    super.addFinalizer(finalizer);
  }

  override fork<A, E>(
    effect: Effect.Effect<A, E, Scope.Scope>,
    options?: ForkScopedOptions,
  ): Fiber.Fiber<A, E> {
    if (this.inRenderPass) {
      throw new UiScopeDisposed({ operation: "React.useComponentScope.fork" });
    }
    this.assertCommitted("React.useComponentScope.fork");
    return super.fork(effect, options);
  }
}

export interface ReactRuntimeUiScopeFrame<ER> extends RuntimeUiScopeFrame<ER> {
  /** Starts one React render pass, discarding speculative pre-commit finalizers from earlier replayed passes. */
  beginRenderPass(): void;
  /** Marks the frame as committed so buffered finalizers and scoped forks become active. */
  commit(): void;
}

export interface ReactRuntimeUiScopeFrameOptions {
  /** Whether render-time finalizers are rejected or buffered until React commit. */
  readonly preCommitFinalizers?: ReactPreCommitFinalizerPolicy;
}

/** Creates a React-aware Runtime UI Scope Frame with commit-gated scoped work. */
export const makeReactRuntimeUiScopeFrame = <ER>(
  runtime: AnyEffectUiRuntime<ER>,
  options: ReactRuntimeUiScopeFrameOptions = {},
): ReactRuntimeUiScopeFrame<ER> => {
  const scope = new ReactCommitUiScope({
    ...(options.preCommitFinalizers === undefined
      ? {}
      : { preCommitFinalizers: options.preCommitFinalizers }),
    runLateFinalizer: (effect) => {
      void runtime.runFork(effect);
    },
  });

  return {
    runtime,
    scope,
    beginRenderPass: () => {
      scope.beginRenderPass();
    },
    commit: () => {
      scope.commit();
    },
    run: (f) => scope.runRenderPass(() => runWithRuntime(runtime, () => runWithScope(scope, f))),
    captureDisposeEffect: () => {
      scope.discardPreCommitFinalizers();
      return runtime
        .provide(scope.captureDisposeEffect())
        .pipe(Effect.catchCause(() => Effect.void));
    },
    disposeEffect: () => {
      return Effect.suspend(() => {
        scope.discardPreCommitFinalizers();
        return runtime.provide(scope.captureDisposeEffect());
      }).pipe(Effect.catchCause(() => Effect.void));
    },
    dispose: () => {
      scope.discardPreCommitFinalizers();
      void runtime.runFork(
        runtime.provide(scope.captureDisposeEffect()).pipe(Effect.catchCause(() => Effect.void)),
      );
    },
  };
};

/**
 * Provides an Effect UI runtime to React children.
 *
 * Pass an existing runtime when the host owns lifecycle. Pass a runtime source
 * to let the provider create and dispose a runtime with the React component.
 */
export const RuntimeProvider = <RuntimeServices = never, ER = never>(
  props: RuntimeProviderProps<RuntimeServices, ER>,
): ReactNode => {
  const ownedRuntimeRef = useRef<
    | {
        readonly source: RuntimeProviderSourceProps<RuntimeServices, ER>["source"] | undefined;
        readonly entry: RuntimeProviderLifecycleEntry<ER>;
      }
    | undefined
  >(undefined);
  const ownsRuntime = props.runtime === undefined;

  if (ownsRuntime) {
    const source = props.source;
    if (ownedRuntimeRef.current === undefined || ownedRuntimeRef.current.source !== source) {
      ownedRuntimeRef.current = {
        source,
        entry: makeRuntimeProviderLifecycleEntry({ source }),
      };
    }
  } else {
    ownedRuntimeRef.current = undefined;
  }

  const entry =
    props.runtime === undefined
      ? ownedRuntimeRef.current!.entry
      : makeRuntimeProviderLifecycleEntry({ runtime: props.runtime });
  const runtime = entry.runtime;
  const onDisposeFailureRef = useRef(props.onDisposeFailure);
  onDisposeFailureRef.current = props.onDisposeFailure;
  const activeEntryRef = useRef(entry);
  const lifecycleVersionRef = useRef(0);

  useEffect(() => {
    activeEntryRef.current = entry;
    lifecycleVersionRef.current++;
    return () => {
      const cleanupEntry = entry;
      const cleanupVersion = ++lifecycleVersionRef.current;
      queueMicrotask(() => {
        if (
          activeEntryRef.current === cleanupEntry &&
          lifecycleVersionRef.current !== cleanupVersion
        ) {
          return;
        }

        void Effect.runFork(
          disposeRuntimeProviderLifecycleEffect(cleanupEntry, {
            observerOperation: "ReactRuntimeProvider.onDisposeFailure",
            onDisposeFailure: onDisposeFailureRef.current,
          }),
        );
      });
    };
  }, [entry]);

  return createElement(RuntimeContext.Provider, {
    value: runtime as AnyEffectUiRuntime<never>,
    children: props.children,
  });
};

/**
 * Creates a `UiScope` bound to the current React component cleanup.
 *
 * Scoped finalizers and forks are accepted only after React commits the
 * component. Render-time reads can use the scope, but render-time background
 * work is rejected so abandoned renders cannot leak Effects.
 */
export const useComponentScope = (): UiScope => {
  const runtime = useRuntime();
  const scopeRef = useRef<
    | {
        readonly runtime: AnyEffectUiRuntime<unknown>;
        readonly frame: ReactRuntimeUiScopeFrame<unknown>;
      }
    | undefined
  >(undefined);

  if (scopeRef.current === undefined || scopeRef.current.runtime !== runtime) {
    scopeRef.current = {
      runtime,
      frame: makeReactRuntimeUiScopeFrame(runtime),
    };
  }

  const frame = scopeRef.current.frame;
  const activeFrameRef = useRef(frame);
  const frameLifecycleVersionRef = useRef(0);

  useLayoutEffect(() => {
    activeFrameRef.current = frame;
    frameLifecycleVersionRef.current++;
    frame.commit();
    return () => {
      const cleanupFrame = frame;
      const cleanupVersion = ++frameLifecycleVersionRef.current;
      queueMicrotask(() => {
        if (
          activeFrameRef.current === cleanupFrame &&
          frameLifecycleVersionRef.current !== cleanupVersion
        ) {
          return;
        }

        cleanupFrame.dispose();
      });
    };
  }, [runtime, frame]);

  return frame.scope;
};

/** Runs synchronous, render-safe construction while the component `UiScope` is ambient. */
export const useScoped = <A>(f: (scope: UiScope) => A): A => {
  const runtime = useRuntime();
  const scope = useComponentScope();
  return runWithRuntime(runtime, () => runWithScope(scope, () => f(scope)));
};
