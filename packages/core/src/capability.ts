import { Context, Effect, Layer } from "effect";
import type { PlainValue } from "./effect-like.js";
import { EffectInputPromiseRejected, isPromiseLikeValue } from "./effect-like.js";

/** Runtime marker used by `isCapability(...)` to identify Capability definitions. */
export const CapabilityTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/Capability",
) as typeof CapabilityTypeId;

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
  /** Creates a Layer that provides this capability, for production or tests. */
  readonly layer: (service: Shape) => Layer.Layer<Identifier>;
  /**
   * Accesses the provided service.
   *
   * The callback returns an Effect (run with the service's requirements) or a
   * plain value. Promise-shaped returns are rejected as defects: adapt host
   * Promise work with `Effect.tryPromise(...)` inside the callback. A callback
   * that throws is a defect, as with `Effect.sync`.
   */
  readonly use: {
    <A, E, R>(f: (service: Shape) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R | Identifier>;
    <A>(f: (service: Shape) => PlainValue<A>): Effect.Effect<PlainValue<A>, never, Identifier>;
  };
}

/** Runtime guard for values created by `Capability.define(...)`. */
export const isCapability = (value: unknown): value is Capability<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [CapabilityTypeId]?: unknown })[CapabilityTypeId] === CapabilityTypeId;

/** Helpers for defining, providing, and using typed UI capabilities. */
export namespace Capability {
  /** Any Capability definition, useful for registries and diagnostics. */
  export type Any = Capability<unknown, unknown>;
  /** Extracts the service shape from a Capability definition. */
  export type Shape<C> = C extends Capability<infer _Identifier, infer Shape> ? Shape : never;
  /** Extracts the Effect service identifier from a Capability definition. */
  export type Identifier<C> =
    C extends Capability<infer Identifier, infer _Shape> ? Identifier : never;

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
  export const define = <Shape>(key: string): Capability<Shape, Shape> => {
    const tag = Context.Service<Shape>(key);
    const use = <A, E, R>(
      f: (service: Shape) => Effect.Effect<A, E, R> | A,
    ): Effect.Effect<A, E, R | Shape> =>
      tag.use((service) =>
        Effect.suspend(() => {
          const value = f(service);
          if (Effect.isEffect(value)) {
            return value as Effect.Effect<A, E, R>;
          }
          return isPromiseLikeValue(value)
            ? Effect.die(
                new EffectInputPromiseRejected({
                  guidance: `Capability.use(${key}) callbacks must return an Effect or a plain value, not a Promise. Use Effect.tryPromise(...) at the host adapter seam.`,
                }),
              )
            : Effect.succeed(value);
        }),
      );

    return {
      [CapabilityTypeId]: CapabilityTypeId,
      key,
      tag,
      layer: (service) => Layer.succeed(tag)(service),
      use: use as Capability<Shape, Shape>["use"],
    };
  };
}
