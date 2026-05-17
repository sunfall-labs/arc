import { Effect, Schema } from "effect";

export const decodeWithSchema = <A>(
  schema: unknown,
  input: unknown,
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input)
    : Effect.succeed(input as A);

export const encodeWithSchema = (
  schema: unknown,
  input: unknown,
): Effect.Effect<unknown, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input)
    : Effect.succeed(input);
