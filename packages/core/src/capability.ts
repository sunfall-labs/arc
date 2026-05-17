import { Context, Effect, Layer } from "effect";
import type { EffectInput, PlainValue, PromiseSafeValue } from "./effect-like.js";
import { isEffectLikeValue } from "./effect-input-sync.js";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  invokeEffectInput
} from "./effect-like.js";

export const CapabilityTypeId: unique symbol = Symbol.for("@effect-ui/core/Capability") as typeof CapabilityTypeId;

/**
 * Typed service handle for injecting UI capabilities through Effect context.
 *
 * Define capabilities for things like navigation, storage, or platform APIs, then
 * provide concrete implementations with a Layer at the app or test boundary.
 */
export interface Capability<Identifier, Shape> {
  readonly [CapabilityTypeId]: typeof CapabilityTypeId;
  readonly key: string;
  readonly tag: Context.Service<Identifier, Shape>;
  /** Creates a production Layer for this capability. */
  readonly layer: (service: Shape) => Layer.Layer<Identifier>;
  /** Creates a test Layer for this capability. */
  readonly mock: (service: Shape) => Layer.Layer<Identifier>;
  /** Accesses the provided service inside an Effect. */
  readonly use: <A, E, R>(f: (service: Shape) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | Identifier>;
  /**
   * Accesses the service with a callback that may return a plain value or Effect.
   *
   * Direct Effect values are executable work. If the domain value itself is an
   * Effect, return it from an Effect with `Effect.succeed(effectValue)`.
   */
  readonly useEffect: {
    <A, E, R>(
      f: (service: Shape) => Effect.Effect<PromiseSafeValue<A>, E, R>
    ): Effect.Effect<PromiseSafeValue<A>, E | EffectInputCallbackError, R | Identifier>;
    <A>(
      f: (service: Shape) => PromiseSafeValue<A>
    ): Effect.Effect<PromiseSafeValue<A>, EffectInputCallbackError, Identifier>;
  };
  /**
   * Synchronously reads the provided service and returns plain data.
   *
   * Promise-shaped values and direct Effect values are rejected. Use
   * `useEffect(...)` when the service access performs Effect work.
   */
  readonly useSync: <A>(
    f: (service: Shape) => PlainValue<A>
  ) => Effect.Effect<PlainValue<A>, never, Identifier>;
  readonly provide: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    service: Shape
  ) => Effect.Effect<A, E, Exclude<R, Identifier>>;
}

export const isCapability = (value: unknown): value is Capability<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CapabilityTypeId]?: unknown })[CapabilityTypeId] === CapabilityTypeId;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  typeof (value as { readonly then?: unknown }).then === "function";

/** Helpers for defining, providing, and using typed UI capabilities. */
export namespace Capability {
  export type Any = Capability<unknown, unknown>;
  export type Shape<C> = C extends Capability<infer _Identifier, infer Shape> ? Shape : never;
  export type Identifier<C> = C extends Capability<infer Identifier, infer _Shape> ? Identifier : never;

  /**
   * Defines a capability backed by an Effect Context service.
   *
   * @example
   * ```ts
   * const Clipboard = Capability.define<{ write(text: string): Effect.Effect<void> }>(
   *   "Clipboard"
   * );
   *
   * const copy = Clipboard.use((clipboard) => clipboard.write("copied"));
   * ```
   */
  export const define = <Shape>(
    key: string
  ): Capability<Shape, Shape> => {
    const tag = Context.Service<Shape>(key);

    function useEffect<A, E, R>(
      f: (service: Shape) => Effect.Effect<PromiseSafeValue<A>, E, R>
    ): Effect.Effect<PromiseSafeValue<A>, E | EffectInputCallbackError, R | Shape>;
    function useEffect<A>(
      f: (service: Shape) => PromiseSafeValue<A>
    ): Effect.Effect<PromiseSafeValue<A>, EffectInputCallbackError, Shape>;
    function useEffect<A, E, R>(
      f: (service: Shape) => Effect.Effect<A, E, R> | A
    ): Effect.Effect<A, E | EffectInputCallbackError, R | Shape> {
      return tag.use((service) =>
        invokeEffectInput(
          `Capability.useEffect(${key})`,
          f as (service: Shape) => EffectInput<A, E, R>,
          service
        )
      );
    }

    return {
      [CapabilityTypeId]: CapabilityTypeId,
      key,
      tag,
      layer: (service) => Layer.succeed(tag)(service),
      mock: (service) => Layer.succeed(tag)(service),
      use: (f) => tag.use(f),
      useEffect,
      useSync: (f) =>
        tag.use((service) =>
          Effect.flatMap(Effect.sync(() => f(service)), (value) =>
            isPromiseLike(value)
              ? Effect.die(new EffectInputPromiseRejected({
                  guidance: `Capability.useSync(${key}) callbacks must return synchronous values, not Promises. Use Capability.useEffect(...) with Effect.tryPromise(...) at the host adapter seam.`
                }))
              : isEffectLikeValue(value)
                ? Effect.die(new EffectInputCallbackError({
                    operation: `Capability.useSync(${key})`,
                    cause: new TypeError("Capability.useSync callbacks must return plain data, not Effect values."),
                    guidance: `Capability.useSync(${key}) callbacks must return plain data. Use Capability.useEffect(...) for Effect work.`
                  }))
              : Effect.succeed(value)
          )
        ),
      provide: (effect, service) =>
        Effect.provideService(effect, tag, service)
    };
  };

  /** Builds a Layer that provides a concrete implementation for a capability. */
  export const layer = <Identifier, Shape>(
    capability: Capability<Identifier, Shape>,
    service: Shape
  ): Layer.Layer<Identifier> =>
    capability.layer(service);

  /** Builds a test Layer for a capability implementation. */
  export const mock = <Identifier, Shape>(
    capability: Capability<Identifier, Shape>,
    service: Shape
  ): Layer.Layer<Identifier> =>
    capability.mock(service);

  /** Provides a capability implementation directly to one Effect. */
  export const provide = <Identifier, Shape, A, E, R>(
    capability: Capability<Identifier, Shape>,
    effect: Effect.Effect<A, E, R>,
    service: Shape
  ): Effect.Effect<A, E, Exclude<R, Identifier>> =>
    capability.provide(effect, service);
}
