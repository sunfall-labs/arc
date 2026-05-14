import { Context, Effect, Layer } from "effect";
import type { EffectInput } from "./effect-like.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";

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
  /** Accesses the service with a callback that may return a plain value or Effect. */
  readonly useEffect: {
    <A, E, R>(
      f: (service: Shape) => Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | EffectInputCallbackError, R | Identifier>;
    <A>(
      f: (service: Shape) => A extends PromiseLike<unknown> ? never : A
    ): Effect.Effect<A, EffectInputCallbackError, Identifier>;
  };
  readonly useSync: <A>(f: (service: Shape) => A) => Effect.Effect<A, never, Identifier>;
  readonly provide: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    service: Shape
  ) => Effect.Effect<A, E, Exclude<R, Identifier>>;
}

export const isCapability = (value: unknown): value is Capability<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CapabilityTypeId]?: unknown })[CapabilityTypeId] === CapabilityTypeId;

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
      f: (service: Shape) => Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | EffectInputCallbackError, R | Shape>;
    function useEffect<A>(
      f: (service: Shape) => A extends PromiseLike<unknown> ? never : A
    ): Effect.Effect<A, EffectInputCallbackError, Shape>;
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
      useSync: (f) => tag.useSync(f),
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
