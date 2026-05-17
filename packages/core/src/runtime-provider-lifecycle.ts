import { Effect } from "effect";
import { invokeEffectInput, type EffectInput } from "./effect-like.js";
import {
  makeRuntime,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type RuntimeDisposeError,
  type RuntimeSource
} from "./runtime.js";

/** Disposal observer accepted by framework Runtime Provider adapters. */
export type RuntimeProviderDisposeObserver =
  (error: RuntimeDisposeError) => EffectInput<void, unknown>;

/** Input owned by runtime-provider lifecycle normalization. */
export interface RuntimeProviderLifecycleOptions<RuntimeServices = never, ER = never> {
  /** Existing host-owned runtime. Providers expose it but do not dispose it. */
  readonly runtime?: EffectUiRuntime<RuntimeServices, ER> | AnyEffectUiRuntime<ER> | undefined;
  /** Provider-owned runtime source. Providers dispose runtimes created from it. */
  readonly source?: RuntimeSource<RuntimeServices, ER> | undefined;
}

/** Normalized runtime-provider lifecycle entry shared by framework adapters. */
export interface RuntimeProviderLifecycleEntry<ER = never> {
  /** Runtime exposed to descendants. */
  readonly runtime: AnyEffectUiRuntime<ER>;
  /** True when the adapter owns and must dispose this runtime. */
  readonly ownsRuntime: boolean;
}

/** Normalizes host-owned, source-owned, and default Runtime Provider inputs. */
export const makeRuntimeProviderLifecycleEntry = <RuntimeServices = never, ER = never>(
  options: RuntimeProviderLifecycleOptions<RuntimeServices, ER> = {}
): RuntimeProviderLifecycleEntry<ER> =>
  options.runtime === undefined
    ? {
        runtime: makeRuntime(options.source) as AnyEffectUiRuntime<ER>,
        ownsRuntime: true
      }
    : {
        runtime: options.runtime as AnyEffectUiRuntime<ER>,
        ownsRuntime: false
      };

/** Options for disposing a normalized Runtime Provider lifecycle entry. */
export interface DisposeRuntimeProviderLifecycleOptions {
  /** Adapter-specific operation label used when invoking the observer. */
  readonly observerOperation: string;
  /** Optional observer for provider-owned runtime disposal failures. */
  readonly onDisposeFailure?: RuntimeProviderDisposeObserver | undefined;
}

/**
 * Disposes provider-owned runtimes and reports failures through an EffectInput observer.
 *
 * Host-owned runtimes are left untouched. Observer failures, including
 * Promise-shaped observer returns rejected by EffectInput, are swallowed so UI
 * cleanup hooks do not throw after the disposal failure has been surfaced.
 */
export const disposeRuntimeProviderLifecycleEffect = <ER>(
  entry: RuntimeProviderLifecycleEntry<ER>,
  options: DisposeRuntimeProviderLifecycleOptions
): Effect.Effect<void> =>
  entry.ownsRuntime
    ? entry.runtime.disposeEffect.pipe(
        Effect.catch((error) =>
          options.onDisposeFailure === undefined
            ? Effect.void
            : invokeEffectInput(options.observerOperation, options.onDisposeFailure, error).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.asVoid
              )
        )
      )
    : Effect.void;
