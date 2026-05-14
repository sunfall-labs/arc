import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { applyResponseContext, makeResponseContext, provideRequest, provideResponse } from "./request-context.js";
import { runPromise } from "./runtime.js";

export const ServerFunctionTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunction"
) as typeof ServerFunctionTypeId;

export const ServerFunctionContractTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunctionContract"
) as typeof ServerFunctionContractTypeId;

export const ServerFunctionMockTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunctionMock"
) as typeof ServerFunctionMockTypeId;

export interface ServerFunctionContractDefinition<I, A, E = unknown> {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
}

export interface ServerFunctionContract<I, A, E = unknown> {
  readonly [ServerFunctionContractTypeId]: typeof ServerFunctionContractTypeId;
  readonly Type?: {
    readonly Input: I;
    readonly Output: A;
    readonly Error: E;
  };
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
}

export interface ServerFunctionMock<I, A, E = unknown, R = never> {
  readonly [ServerFunctionMockTypeId]: typeof ServerFunctionMockTypeId;
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly handler: (input: I) => EffectInput<A, E, R>;
}

export interface ServerFunctionDefinition<I, A, E = unknown, R = never> {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly handler: (input: I) => EffectInput<A, E, R>;
}

export interface ServerFunction<I, A, E = unknown, R = never> {
  readonly [ServerFunctionTypeId]: typeof ServerFunctionTypeId;
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly hasHandler: boolean;
  effect(input: I): Effect.Effect<A, E | ServerClientError, R>;
  local(input: I): Effect.Effect<A, E | ServerFunctionNotFound, R>;
  invoke(input: unknown): Effect.Effect<unknown, E | ServerClientError, R>;
  (input: I): Promise<A>;
}

export interface ServerRoute {
  readonly method: string;
  readonly path: string;
  readonly handler: (request: Request) => Effect.Effect<Response, unknown>;
}

export interface ServerRpcRequest {
  readonly name: string;
  readonly input: unknown;
}

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

export type ServerClientError =
  | Schema.SchemaError
  | ServerFunctionNotFound
  | ServerRpcProtocolError
  | ServerTransportError;

export interface ServerClient {
  readonly call: <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: I
  ) => Effect.Effect<A, E | ServerClientError, R>;
}

export const ServerClient = Context.Service<ServerClient>("@effect-ui/core/ServerClient");

type FromContract<T> = [T][T extends unknown ? 0 : never];
type ServerContractInput<Contract> =
  Contract extends ServerFunctionContract<infer I, infer _A, infer _E> ? I : never;
type ServerContractOutput<Contract> =
  Contract extends ServerFunctionContract<infer _I, infer A, infer _E> ? A : never;
type ServerContractError<Contract> =
  Contract extends ServerFunctionContract<infer _I, infer _A, infer E> ? E : never;

const serverFunctionRegistry = new Map<string, ServerFunction<any, any, any, any>>();

const mockFor = <I, A, E, R>(
  mocks: ReadonlyMap<string, ServerFunctionMock<any, any, any, any>>,
  fn: ServerFunction<I, A, E, R>
): ServerFunctionMock<I, A, E, R> | undefined =>
  mocks.get(fn.name) as ServerFunctionMock<I, A, E, R> | undefined;

export const isServerFunction = (value: unknown): value is ServerFunction<unknown, unknown> =>
  typeof value === "function" &&
  (value as { [ServerFunctionTypeId]?: unknown })[ServerFunctionTypeId] === ServerFunctionTypeId;

export const isServerFunctionContract = (
  value: unknown
): value is ServerFunctionContract<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ServerFunctionContractTypeId]?: unknown })[ServerFunctionContractTypeId] ===
    ServerFunctionContractTypeId;

export namespace Server {
  export type Fn<I, A, E = unknown, R = never> = ServerFunction<I, A, E, R>;
  export type Contract<I, A, E = unknown> = ServerFunctionContract<I, A, E>;
  export type Mock<I, A, E = unknown, R = never> = ServerFunctionMock<I, A, E, R>;
  export type Client = ServerClient;
  export type ClientError = ServerClientError;
  export type RpcRequest = ServerRpcRequest;
  export type RpcResponse = ServerRpcResponse;

  export const contract = <I, A, E = unknown>(
    name: string,
    definition: ServerFunctionContractDefinition<I, A, E> = {}
  ): ServerFunctionContract<I, A, E> => ({
    [ServerFunctionContractTypeId]: ServerFunctionContractTypeId,
    name,
    input: definition.input,
    output: definition.output,
    error: definition.error
  });

  export const client = <I, A, E = unknown>(
    contract: ServerFunctionContract<I, A, E>
  ): ServerFunction<I, A, E, never> =>
    stub(contract.name, {
      input: contract.input,
      output: contract.output,
      error: contract.error
    });

  export const implement = <
    Contract extends ServerFunctionContract<unknown, unknown, unknown>,
    R = never
  >(
    contract: Contract,
    handler: (
      input: FromContract<ServerContractInput<Contract>>
    ) => EffectInput<
      FromContract<ServerContractOutput<Contract>>,
      ServerContractError<Contract>,
      R
    >
  ): ServerFunction<
    ServerContractInput<Contract>,
    ServerContractOutput<Contract>,
    ServerContractError<Contract>,
    R
  > =>
    fn<
      ServerContractInput<Contract>,
      ServerContractOutput<Contract>,
      ServerContractError<Contract>,
      R
    >(contract.name, {
      input: contract.input,
      output: contract.output,
      error: contract.error,
      handler
    });

  export const mock = <
    Contract extends ServerFunctionContract<unknown, unknown, unknown>,
    R = never
  >(
    contract: Contract,
    handler: (
      input: FromContract<ServerContractInput<Contract>>
    ) => EffectInput<
      FromContract<ServerContractOutput<Contract>>,
      ServerContractError<Contract>,
      R
    >
  ): ServerFunctionMock<
    ServerContractInput<Contract>,
    ServerContractOutput<Contract>,
    ServerContractError<Contract>,
    R
  > => ({
    [ServerFunctionMockTypeId]: ServerFunctionMockTypeId,
    name: contract.name,
    input: contract.input,
    output: contract.output,
    error: contract.error,
    handler: handler as (
      input: ServerContractInput<Contract>
    ) => EffectInput<
      ServerContractOutput<Contract>,
      ServerContractError<Contract>,
      R
    >
  });

  export const mockClient = (
    ...mocks: readonly ServerFunctionMock<any, any, any, any>[]
  ): ServerClient => {
    const byName = new Map<string, ServerFunctionMock<any, any, any, any>>(
      mocks.map((mock) => [mock.name, mock])
    );

    return {
      call: <I, A, E, R>(
        fn: ServerFunction<I, A, E, R>,
        input: I
      ): Effect.Effect<A, E | ServerClientError, R> =>
        Effect.gen(function* () {
          const mock = mockFor(byName, fn);
          if (!mock) {
            return yield* Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }));
          }

          const encodedInput = yield* encodeWire(fn.input, input);
          const decodedInput = yield* decodeWire<I>(mock.input, encodedInput);
          const value = yield* toEffect(mock.handler(decodedInput));
          const encodedOutput = yield* encodeWire(mock.output, value);
          return yield* decodeWire<A>(fn.output, encodedOutput);
        })
    };
  };

  export const mockLayer = (
    ...mocks: readonly ServerFunctionMock<any, any, any, any>[]
  ): Layer.Layer<ServerClient> =>
    Layer.succeed(ServerClient)(mockClient(...mocks));

  export const provideMocks = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    ...mocks: readonly ServerFunctionMock<any, any, any, any>[]
  ): Effect.Effect<A, E, Exclude<R, ServerClient>> =>
    Effect.provideService(effect, ServerClient, mockClient(...mocks));

  export const fn = <I, A, E = unknown, R = never>(
    name: string,
    definition: Omit<ServerFunctionDefinition<I, A, E, R>, "handler"> & {
      readonly handler: (input: I) => EffectInput<A, E, R>;
    }
  ): ServerFunction<I, A, E, R> => {
    const local = (input: I): Effect.Effect<A, E, R> =>
      toEffect(definition.handler(input));
    const effect = (input: I): Effect.Effect<A, E | ServerClientError, R> =>
      Effect.gen(function* () {
        const client = yield* Effect.serviceOption(ServerClient);
        if (Option.isSome(client)) {
          return yield* client.value.call(callable, input);
        }
        return yield* local(input);
      });
    const invoke = (input: unknown): Effect.Effect<unknown, E | ServerClientError, R> =>
      Effect.gen(function* () {
        const decoded = yield* decodeWire<I>(definition.input, input);
        const value = yield* local(decoded);
        return yield* encodeWire(definition.output, value);
      });
    const callable = ((input: I) =>
      runPromise(effect(input))) as ServerFunction<I, A, E, R>;

    Object.defineProperties(callable, {
      [ServerFunctionTypeId]: { value: ServerFunctionTypeId },
      name: { value: name },
      input: { value: definition.input, enumerable: true },
      output: { value: definition.output, enumerable: true },
      error: { value: definition.error, enumerable: true },
      hasHandler: { value: true, enumerable: true },
      effect: { value: effect, enumerable: true },
      local: { value: local, enumerable: true },
      invoke: { value: invoke, enumerable: true }
    });

    serverFunctionRegistry.set(name, callable);
    return callable;
  };

  export const stub = <I, A, E = unknown>(
    name: string,
    definition: Omit<ServerFunctionDefinition<I, A, E, never>, "handler">
  ): ServerFunction<I, A, E, never> => {
    const missing = (): ServerFunctionNotFound => new ServerFunctionNotFound({ functionName: name });
    const local = (_input: I): Effect.Effect<A, ServerFunctionNotFound> =>
      Effect.fail(missing());
    const effect = (input: I): Effect.Effect<A, E | ServerClientError> =>
      Effect.gen(function* () {
        const client = yield* Effect.serviceOption(ServerClient);
        if (Option.isSome(client)) {
          return yield* client.value.call(callable, input);
        }
        return yield* Effect.fail(missing());
      });
    const invoke = (_input: unknown): Effect.Effect<unknown, ServerFunctionNotFound> =>
      Effect.fail(missing());
    const callable = ((input: I) =>
      runPromise(effect(input))) as ServerFunction<I, A, E, never>;

    Object.defineProperties(callable, {
      [ServerFunctionTypeId]: { value: ServerFunctionTypeId },
      name: { value: name },
      input: { value: definition.input, enumerable: true },
      output: { value: definition.output, enumerable: true },
      error: { value: definition.error, enumerable: true },
      hasHandler: { value: false, enumerable: true },
      effect: { value: effect, enumerable: true },
      local: { value: local, enumerable: true },
      invoke: { value: invoke, enumerable: true }
    });

    serverFunctionRegistry.set(name, callable);
    return callable;
  };

  export const functions = (): ReadonlyMap<string, ServerFunction<unknown, unknown, unknown, unknown>> =>
    serverFunctionRegistry;

  export const get = <I = unknown, A = unknown, E = unknown, R = unknown>(
    name: string
  ): ServerFunction<I, A, E, R> | undefined =>
    serverFunctionRegistry.get(name) as ServerFunction<I, A, E, R> | undefined;

  export const clearRegistryUnsafe = (): void => {
    serverFunctionRegistry.clear();
  };

  export const route = (
    method: string,
    path: string,
    handler: (request: Request) => EffectInput<Response>
  ): ServerRoute => ({
    method,
    path,
    handler: (request) => toEffect(handler(request))
  });

  export const handleRouteEffect = (
    route: ServerRoute,
    request: Request
  ): Effect.Effect<Response, unknown> => {
    const responseContext = makeResponseContext();
    return Effect.map(
      provideRequest(request)(provideResponse(responseContext)(route.handler(request))),
      (response) => applyResponseContext(responseContext, response)
    );
  };

  export const handleRoute = (route: ServerRoute, request: Request): Promise<Response> =>
    runPromise(handleRouteEffect(route, request));

  export const manifest = (functions: Iterable<ServerFunction<unknown, unknown>>): Array<{
    readonly name: string;
    readonly inputSchema: boolean;
    readonly outputSchema: boolean;
    readonly errorSchema: boolean;
  }> =>
    Array.from(functions, (fn) => ({
      name: fn.name,
      inputSchema: Schema.isSchema(fn.input),
      outputSchema: Schema.isSchema(fn.output),
      errorSchema: Schema.isSchema(fn.error)
    }));

  export const encodeInput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: I
  ): Effect.Effect<unknown, Schema.SchemaError> =>
    encodeWire(fn.input, input);

  export const decodeInput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: unknown
  ): Effect.Effect<I, Schema.SchemaError> =>
    decodeWire<I>(fn.input, input);

  export const encodeOutput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    output: A
  ): Effect.Effect<unknown, Schema.SchemaError> =>
    encodeWire(fn.output, output);

  export const decodeOutput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    output: unknown
  ): Effect.Effect<A, Schema.SchemaError> =>
    decodeWire<A>(fn.output, output);

  export const encodeError = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    error: E
  ): Effect.Effect<unknown, Schema.SchemaError> =>
    encodeWire(fn.error, error);

  export const decodeError = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    error: unknown
  ): Effect.Effect<E, Schema.SchemaError> =>
    decodeWire<E>(fn.error, error);

  export const decodeRpcRequest = (input: unknown): Effect.Effect<ServerRpcRequest, Schema.SchemaError> =>
    decodeWire<ServerRpcRequest>(ServerRpcRequestSchema, input);

  export const decodeRpcResponse = (input: unknown): Effect.Effect<ServerRpcResponse, Schema.SchemaError> =>
    decodeWire<ServerRpcResponse>(ServerRpcResponseSchema, input);

  export const localClient = (): ServerClient => ({
    call: <I, A, E, R>(
      fn: ServerFunction<I, A, E, R>,
      input: I
    ): Effect.Effect<A, E | ServerClientError, R> =>
      Effect.gen(function* () {
        const target = Server.get<I, A, E, R>(fn.name);
        if (!target?.hasHandler) {
          return yield* Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }));
        }

        const encodedInput = yield* Server.encodeInput(fn, input);
        const encodedOutput = yield* target.invoke(encodedInput);
        return yield* Server.decodeOutput(fn, encodedOutput);
      })
  });

  export const serializeDefect = (defect: unknown): unknown => {
    if (defect instanceof Error) {
      return {
        _tag: defect.name,
        message: defect.message,
        stack: defect.stack
      };
    }
    return defect;
  };

  export const serializeServerError = (error: ServerFunctionNotFound | ServerRpcProtocolError): unknown => {
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

  export const deserializeServerError = (error: unknown): ServerFunctionNotFound | ServerRpcProtocolError => {
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

const decodeWire = <A = unknown>(schema: unknown, input: unknown): Effect.Effect<A, Schema.SchemaError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(input as A);
  }
  return Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input);
};

const encodeWire = (schema: unknown, input: unknown): Effect.Effect<unknown, Schema.SchemaError> => {
  if (!Schema.isSchema(schema)) {
    return Effect.succeed(input);
  }
  return Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input);
};
