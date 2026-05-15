import { Data, Effect, Schema } from "effect";

/** Wire request shape for server function RPC transports. */
export interface ServerRpcRequest {
  readonly name: string;
  readonly input: unknown;
}

/** Wire response shape for server function RPC transports. */
export type ServerRpcResponse =
  | { readonly _tag: "Success"; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly error: unknown }
  | { readonly _tag: "ServerError"; readonly error: unknown }
  | { readonly _tag: "Defect"; readonly defect: unknown };

export class ServerFunctionNotFound extends Data.TaggedError("ServerFunctionNotFound")<{
  readonly functionName: string;
}> {}

export class ServerRpcProtocolError extends Data.TaggedError("ServerRpcProtocolError")<{
  readonly message: string;
  readonly payload?: unknown;
}> {}

export class ServerTransportError extends Data.TaggedError("ServerTransportError")<{
  readonly reason: "Network" | "BadStatus" | "InvalidResponse" | "Defect" | "Interrupted";
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
  readonly payload?: unknown;
}> {}

/** Minimal server function shape needed by the wire codec Module. */
export interface ServerWireDefinition<I = unknown, A = unknown, E = unknown> {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
}

/** Schema-presence entry for server-function manifests and diagnostics. */
export interface ServerWireManifestEntry {
  readonly name: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

const ServerRpcRequestSchema = Schema.Struct({
  name: Schema.String,
  input: Schema.Unknown
});

const ServerRpcResponseSchema = Schema.TaggedUnion({
  Success: {
    value: Schema.Unknown
  },
  Failure: {
    error: Schema.Unknown
  },
  ServerError: {
    error: Schema.Unknown
  },
  Defect: {
    defect: Schema.Unknown
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Decodes unknown wire data through an optional Effect Schema. */
export const decodeServerWire = <A = unknown>(
  schema: unknown,
  input: unknown
): Effect.Effect<A, Schema.SchemaError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(input as A);
  }
  return Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input);
};

/** Encodes data through an optional Effect Schema for transport. */
export const encodeServerWire = (
  schema: unknown,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(input);
  }
  return Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input);
};

/** Builds a schema-presence manifest from server wire definitions. */
export const serverWireManifest = (
  functions: Iterable<ServerWireDefinition>
): Array<ServerWireManifestEntry> =>
  Array.from(functions, (fn) => ({
    name: fn.name,
    inputSchema: Schema.isSchema(fn.input),
    outputSchema: Schema.isSchema(fn.output),
    errorSchema: Schema.isSchema(fn.error)
  }));

/** Encodes a function input through the function's input schema when present. */
export const encodeServerFunctionInput = <I>(
  fn: Pick<ServerWireDefinition<I>, "input">,
  input: I
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeServerWire(fn.input, input);

/** Decodes an unknown wire input through the function's input schema when present. */
export const decodeServerFunctionInput = <I>(
  fn: Pick<ServerWireDefinition<I>, "input">,
  input: unknown
): Effect.Effect<I, Schema.SchemaError> =>
  decodeServerWire<I>(fn.input, input);

/** Encodes a function output through the function's output schema when present. */
export const encodeServerFunctionOutput = <A>(
  fn: Pick<ServerWireDefinition<unknown, A>, "output">,
  output: A
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeServerWire(fn.output, output);

/** Decodes an unknown wire output through the function's output schema when present. */
export const decodeServerFunctionOutput = <A>(
  fn: Pick<ServerWireDefinition<unknown, A>, "output">,
  output: unknown
): Effect.Effect<A, Schema.SchemaError> =>
  decodeServerWire<A>(fn.output, output);

/** Encodes a function failure through the function's error schema when present. */
export const encodeServerFunctionError = <E>(
  fn: Pick<ServerWireDefinition<unknown, unknown, E>, "error">,
  error: E
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeServerWire(fn.error, error);

/** Decodes an unknown wire failure through the function's error schema when present. */
export const decodeServerFunctionError = <E>(
  fn: Pick<ServerWireDefinition<unknown, unknown, E>, "error">,
  error: unknown
): Effect.Effect<E, Schema.SchemaError> =>
  decodeServerWire<E>(fn.error, error);

/** Decodes the generic server-function RPC request envelope. */
export const decodeServerRpcRequest = (
  input: unknown
): Effect.Effect<ServerRpcRequest, Schema.SchemaError> =>
  decodeServerWire<ServerRpcRequest>(ServerRpcRequestSchema, input);

/** Decodes the generic server-function RPC response envelope. */
export const decodeServerRpcResponse = (
  input: unknown
): Effect.Effect<ServerRpcResponse, Schema.SchemaError> =>
  decodeServerWire<ServerRpcResponse>(ServerRpcResponseSchema, input);

/** Serializes thrown defects into JSON-safe diagnostic data when possible. */
export const serializeServerDefect = (defect: unknown): unknown => {
  if (defect instanceof Error) {
    return {
      _tag: defect.name,
      message: defect.message,
      stack: defect.stack
    };
  }
  return defect;
};

/** Serializes known server RPC errors for transport responses. */
export const serializeServerError = (
  error: ServerFunctionNotFound | ServerRpcProtocolError
): unknown => {
  switch (error._tag) {
    case "ServerFunctionNotFound":
      return {
        _tag: error._tag,
        functionName: error.functionName
      };
    case "ServerRpcProtocolError":
      return {
        _tag: error._tag,
        message: error.message,
        payload: error.payload
      };
  }
};

/** Decodes known server RPC errors, falling back to a protocol error. */
export const deserializeServerError = (
  error: unknown
): ServerFunctionNotFound | ServerRpcProtocolError => {
  if (isRecord(error) && error._tag === "ServerFunctionNotFound" && typeof error.functionName === "string") {
    return new ServerFunctionNotFound({ functionName: error.functionName });
  }
  if (isRecord(error) && error._tag === "ServerRpcProtocolError" && typeof error.message === "string") {
    return new ServerRpcProtocolError({
      message: error.message,
      payload: error.payload
    });
  }
  return new ServerRpcProtocolError({
    message: "The server returned an unknown RPC protocol error.",
    payload: error
  });
};
