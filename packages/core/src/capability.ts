import { Context, Effect, Layer } from "effect";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EffectInputValue,
  EnsureEffectInput
} from "./effect-like.js";
import { toEffect } from "./effect-like.js";

export const CapabilityTypeId: unique symbol = Symbol.for("@effect-ui/core/Capability") as never;

export interface Capability<Identifier, Shape> {
  readonly [CapabilityTypeId]: typeof CapabilityTypeId;
  readonly key: string;
  readonly tag: Context.Service<Identifier, Shape>;
  readonly layer: (service: Shape) => Layer.Layer<Identifier>;
  readonly mock: (service: Shape) => Layer.Layer<Identifier>;
  readonly use: <A, E, R>(f: (service: Shape) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | Identifier>;
  readonly useEffect: <Out>(
    f: (service: Shape) => EnsureEffectInput<Out>
  ) => Effect.Effect<EffectInputValue<Out>, EffectInputError<Out>, EffectInputRequirements<Out> | Identifier>;
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

export namespace Capability {
  export type Any = Capability<any, any>;
  export type Shape<C> = C extends Capability<any, infer Shape> ? Shape : never;
  export type Identifier<C> = C extends Capability<infer Identifier, any> ? Identifier : never;

  export const define = <Shape>(
    key: string
  ): Capability<Shape, Shape> => {
    const tag = Context.Service<Shape>(key);

    return {
      [CapabilityTypeId]: CapabilityTypeId,
      key,
      tag,
      layer: (service) => Layer.succeed(tag)(service),
      mock: (service) => Layer.succeed(tag)(service),
      use: (f) => tag.use(f),
      useEffect: (f) =>
        tag.use((service) => toEffect(f(service) as EffectInput<EffectInputValue<ReturnType<typeof f>>>)) as never,
      useSync: (f) => tag.useSync(f),
      provide: (effect, service) =>
        Effect.provideService(effect, tag, service) as Effect.Effect<
          never,
          never,
          never
        > as never
    };
  };

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

  export const provide = <Identifier, Shape, A, E, R>(
    capability: Capability<Identifier, Shape>,
    effect: Effect.Effect<A, E, R>,
    service: Shape
  ): Effect.Effect<A, E, Exclude<R, Identifier>> =>
    capability.provide(effect, service);
}
