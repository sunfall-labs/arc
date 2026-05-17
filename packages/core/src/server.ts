import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import {
  clearServerFunctionDefinitionRegistryUnsafe,
  coreDefinitionRegistryDiagnostics,
  getServerFunctionDefinition,
  registerServerFunctionDefinition,
  serverFunctionDefinitionRegistry,
  type CoreDefinitionRegistry,
} from "./definition-registry.js";
import type {
  EffectInput,
  EffectInputError,
  EffectInputRequirements,
  EnsureEffectInput,
  EnsureEffectInputValue,
} from "./effect-like.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";
import {
  applyResponseContextEffect,
  makeResponseContext,
  provideRequest,
  provideResponse,
} from "./request-context.js";
import {
  decodeServerFunctionError,
  decodeServerFunctionInput,
  decodeServerFunctionOutput,
  decodeServerRpcRequest,
  decodeServerRpcResponse,
  decodeServerWire,
  deserializeServerError as deserializeServerWireError,
  encodeServerFunctionError,
  encodeServerFunctionInput,
  encodeServerFunctionOutput,
  encodeServerWire,
  serializeServerDefect,
  serializeServerError as serializeServerWireError,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  serverWireManifest,
  type ServerRpcRequest,
  type ServerRpcResponse,
} from "./server-wire-codec.js";

export {
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
} from "./server-wire-codec.js";

export type { ServerRpcRequest, ServerRpcResponse } from "./server-wire-codec.js";

export const ServerFunctionTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunction",
) as typeof ServerFunctionTypeId;

export const ServerFunctionContractTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunctionContract",
) as typeof ServerFunctionContractTypeId;

export const ServerFunctionMockTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ServerFunctionMock",
) as typeof ServerFunctionMockTypeId;

/** Schema metadata shared by server function clients, implementations, and mocks. */
export interface ServerFunctionContractDefinition<_I, _A, _E = never> {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
}

/**
 * Transport-safe description of a server function.
 *
 * Contracts are defined in shared code, then turned into a client stub with
 * Server.client or a server implementation with Server.implement.
 */
export interface ServerFunctionContract<I, A, E = never> {
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

/** Test implementation for a server function contract. */
export interface ServerFunctionMock<I, A, E = never, R = never> {
  readonly [ServerFunctionMockTypeId]: typeof ServerFunctionMockTypeId;
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly handler: (input: I) => EffectInput<A, E, R>;
}

/** Server-side handler definition for Server.fn. */
export interface ServerFunctionDefinition<I, A, E = never, R = never> {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly handler: (input: I) => EffectInput<A, E, R>;
}

/**
 * Callable server function with an Effect result.
 *
 * Use `.effect(input)` or call the function directly inside Effect code. Both paths
 * use the active ServerClient when one is provided.
 */
export interface ServerFunction<I, A, E = never, R = never> {
  readonly [ServerFunctionTypeId]: typeof ServerFunctionTypeId;
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly hasHandler: boolean;
  effect(input: I): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R>;
  local(input: I): Effect.Effect<A, E | EffectInputCallbackError | ServerFunctionNotFound, R>;
  invoke(
    input: unknown,
  ): Effect.Effect<unknown, E | EffectInputCallbackError | ServerClientError, R>;
  (input: I): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R>;
}

/** Options for local ServerClient dispatch. */
export interface LocalServerClientOptions {
  /**
   * Optional registry snapshot to dispatch against.
   *
   * When supplied, local dispatch is isolated to the snapshot instead of reading
   * the process-wide Server registry.
   */
  readonly registry?: CoreDefinitionRegistry<any, AnyServerFunction>;
}

/** HTTP route handler used by server adapters. */
export interface ServerRoute<E = never, R = never> {
  readonly method: string;
  readonly path: string;
  readonly handler: (request: Request) => Effect.Effect<Response, E | ServerRouteHandlerError, R>;
}

export class ServerRouteHandlerError extends Data.TaggedError("ServerRouteHandlerError")<{
  readonly method: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

export type ServerClientError =
  | EffectInputCallbackError
  | Schema.SchemaError
  | ServerFunctionNotFound
  | ServerRpcProtocolError
  | ServerTransportError;

/**
 * Transport abstraction used by server function clients.
 *
 * Provide this service to redirect `.effect` calls through a remote or mock client
 * instead of the local implementation.
 */
export interface ServerClient {
  readonly call: <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: I,
  ) => Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R>;
}

export const ServerClient = Context.Service<ServerClient>("@effect-ui/core/ServerClient");

type FromContract<T> = [T][T extends unknown ? 0 : never];
type CheckedServerFunctionHandler<I, Definition> = Definition extends {
  readonly handler: (input: I) => infer Out;
}
  ? RejectPromiseEffectInput<Out>
  : never;
type RejectPromiseEffectInput<Out> = EnsureEffectInput<Out> extends never ? never : unknown;
type ServerContractInput<Contract> =
  Contract extends ServerFunctionContract<infer I, infer _A, infer _E> ? I : never;
type ServerContractOutput<Contract> =
  Contract extends ServerFunctionContract<infer _I, infer A, infer _E> ? A : never;
type ServerContractError<Contract> =
  Contract extends ServerFunctionContract<infer _I, infer _A, infer E> ? E : never;
type CheckedServerContractHandlerOutput<Out, A, E> =
  EnsureEffectInputValue<Out, A> extends never
    ? never
    : EffectInputError<Out> extends E | EffectInputCallbackError
      ? Out
      : never;
type ServerFunctionDefinitionInput<I, A, E, R> = Omit<
  ServerFunctionDefinition<I, A, E, R>,
  "handler"
> & {
  readonly handler: (input: I) => EffectInput<A, E, R>;
};

type AnyServerFunction = ServerFunction<any, any, any, any>;
type AnyServerFunctionContract = ServerFunctionContract<any, any, any>;
type AnyServerFunctionMock = ServerFunctionMock<any, any, any, any>;

const mockFor = <I, A, E, R>(
  mocks: ReadonlyMap<string, AnyServerFunctionMock>,
  fn: ServerFunction<I, A, E, R>,
): ServerFunctionMock<I, A, E, R> | undefined =>
  mocks.get(fn.name) as ServerFunctionMock<I, A, E, R> | undefined;

const serverRouteHandlerError = (
  route: Pick<ServerRoute, "method" | "path">,
  cause: unknown,
): ServerRouteHandlerError =>
  cause instanceof ServerRouteHandlerError
    ? cause
    : new ServerRouteHandlerError({
        method: route.method,
        path: route.path,
        cause,
      });

const mapServerRouteBoundaryError = <E>(
  route: Pick<ServerRoute, "method" | "path">,
  error: E | ServerRouteHandlerError | EffectInputCallbackError,
): E | ServerRouteHandlerError =>
  error instanceof ServerRouteHandlerError || error instanceof EffectInputCallbackError
    ? serverRouteHandlerError(route, error)
    : error;

const isServerClientError = (error: unknown): error is ServerClientError =>
  error instanceof EffectInputCallbackError ||
  Schema.isSchemaError(error) ||
  error instanceof ServerFunctionNotFound ||
  error instanceof ServerRpcProtocolError ||
  error instanceof ServerTransportError;

const roundTripServerFunctionError = <I, A, E, R>(
  fn: ServerFunction<I, A, E, R>,
  error: E | ServerClientError,
): Effect.Effect<E | ServerClientError, Schema.SchemaError> =>
  isServerClientError(error)
    ? Effect.succeed(error)
    : Effect.flatMap(encodeServerFunctionError(fn, error as E), (encoded) =>
        decodeServerFunctionError(fn, encoded),
      );

const catchServerFunctionError = <I, A, E, R, Value, Error, Requirements>(
  fn: ServerFunction<I, A, E, R>,
  effect: Effect.Effect<Value, Error, Requirements>,
): Effect.Effect<Value, Error | E | ServerClientError, Requirements> =>
  effect.pipe(
    Effect.catch((error: Error) =>
      Effect.flatMap(roundTripServerFunctionError(fn, error as E | ServerClientError), (decoded) =>
        Effect.fail(decoded),
      ),
    ),
  );

export const isServerFunction = (value: unknown): value is AnyServerFunction =>
  typeof value === "function" &&
  (value as { [ServerFunctionTypeId]?: unknown })[ServerFunctionTypeId] === ServerFunctionTypeId;

export const isServerFunctionContract = (value: unknown): value is AnyServerFunctionContract =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ServerFunctionContractTypeId]?: unknown })[ServerFunctionContractTypeId] ===
    ServerFunctionContractTypeId;

const defineServerFunction = <I, A, E = never, R = never>(
  name: string,
  definition: ServerFunctionDefinitionInput<I, A, E, R>,
): ServerFunction<I, A, E, R> => {
  const local = (input: I): Effect.Effect<A, E | EffectInputCallbackError, R> =>
    invokeEffectInput(`Server.fn(${name}).handler`, definition.handler, input);
  const effect = (
    input: I,
  ): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R> =>
    Effect.gen(function* () {
      const client = yield* Effect.serviceOption(ServerClient);
      if (Option.isSome(client)) {
        return yield* client.value.call(callable, input);
      }
      return yield* local(input);
    });
  const invoke = (
    input: unknown,
  ): Effect.Effect<unknown, E | EffectInputCallbackError | ServerClientError, R> =>
    Effect.gen(function* () {
      const decoded = yield* decodeServerWire<I>(definition.input, input);
      const value = yield* local(decoded);
      return yield* encodeServerWire(definition.output, value);
    });
  const callable = ((input: I) => effect(input)) as ServerFunction<I, A, E, R>;

  Object.defineProperties(callable, {
    [ServerFunctionTypeId]: { value: ServerFunctionTypeId },
    name: { value: name },
    input: { value: definition.input, enumerable: true },
    output: { value: definition.output, enumerable: true },
    error: { value: definition.error, enumerable: true },
    hasHandler: { value: true, enumerable: true },
    effect: { value: effect, enumerable: true },
    local: { value: local, enumerable: true },
    invoke: { value: invoke, enumerable: true },
  });

  registerServerFunctionDefinition(callable);
  return callable;
};

/** Helpers for contracts, client stubs, server implementations, mocks, and routes. */
export namespace Server {
  export type Fn<I, A, E = never, R = never> = ServerFunction<I, A, E, R>;
  export type Contract<I, A, E = never> = ServerFunctionContract<I, A, E>;
  export type Mock<I, A, E = never, R = never> = ServerFunctionMock<I, A, E, R>;
  export type Client = ServerClient;
  export type ClientError = ServerClientError;
  export type RpcRequest = ServerRpcRequest;
  export type RpcResponse = ServerRpcResponse;

  /**
   * Defines a shared server function contract.
   *
   * @example
   * ```ts
   * const GetUser = Server.contract<{ id: string }, User>("GetUser", {
   *   input: GetUserInput,
   *   output: User
   * });
   * ```
   */
  export const contract = <I, A, E = never>(
    name: string,
    definition: ServerFunctionContractDefinition<I, A, E> = {},
  ): ServerFunctionContract<I, A, E> => ({
    [ServerFunctionContractTypeId]: ServerFunctionContractTypeId,
    name,
    input: definition.input,
    output: definition.output,
    error: definition.error,
  });

  /** Creates a client stub from a shared contract. */
  export const client = <I, A, E = never>(
    contract: ServerFunctionContract<I, A, E>,
  ): ServerFunction<I, A, E, never> =>
    stub(contract.name, {
      input: contract.input,
      output: contract.output,
      error: contract.error,
    });

  /**
   * Implements a shared contract with a local handler.
   *
   * The handler may return a value or an Effect. Prefer returning Effect when the
   * implementation needs services, retries, or typed failure.
   */
  export const implement = <Contract extends AnyServerFunctionContract, Out>(
    contract: Contract,
    handler: (
      input: FromContract<ServerContractInput<Contract>>,
    ) => CheckedServerContractHandlerOutput<
      Out,
      FromContract<ServerContractOutput<Contract>>,
      ServerContractError<Contract>
    >,
  ): ServerFunction<
    ServerContractInput<Contract>,
    ServerContractOutput<Contract>,
    ServerContractError<Contract>,
    EffectInputRequirements<Out>
  > =>
    defineServerFunction(contract.name, {
      input: contract.input,
      output: contract.output,
      error: contract.error,
      handler: handler as (
        input: ServerContractInput<Contract>,
      ) => EffectInput<
        ServerContractOutput<Contract>,
        ServerContractError<Contract>,
        EffectInputRequirements<Out>
      >,
    });

  /** Creates a mock handler for a contract, suitable for Server.mockClient or mockLayer. */
  export const mock = <Contract extends AnyServerFunctionContract, Out>(
    contract: Contract,
    handler: (
      input: FromContract<ServerContractInput<Contract>>,
    ) => CheckedServerContractHandlerOutput<
      Out,
      FromContract<ServerContractOutput<Contract>>,
      ServerContractError<Contract>
    >,
  ): ServerFunctionMock<
    ServerContractInput<Contract>,
    ServerContractOutput<Contract>,
    ServerContractError<Contract>,
    EffectInputRequirements<Out>
  > => ({
    [ServerFunctionMockTypeId]: ServerFunctionMockTypeId,
    name: contract.name,
    input: contract.input,
    output: contract.output,
    error: contract.error,
    handler: handler as (
      input: ServerContractInput<Contract>,
    ) => EffectInput<
      ServerContractOutput<Contract>,
      ServerContractError<Contract>,
      EffectInputRequirements<Out>
    >,
  });

  /** Creates a ServerClient that answers calls using the supplied mocks. */
  export const mockClient = (...mocks: readonly AnyServerFunctionMock[]): ServerClient => {
    const byName = new Map<string, AnyServerFunctionMock>(mocks.map((mock) => [mock.name, mock]));

    return {
      call: <I, A, E, R>(
        fn: ServerFunction<I, A, E, R>,
        input: I,
      ): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R> =>
        Effect.gen(function* () {
          const mock = mockFor(byName, fn);
          if (!mock) {
            return yield* Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }));
          }

          const encodedInput = yield* encodeServerWire(fn.input, input);
          const decodedInput = yield* decodeServerWire<I>(mock.input, encodedInput);
          const value = yield* catchServerFunctionError(
            fn,
            invokeEffectInput(`Server.mock(${fn.name}).handler`, mock.handler, decodedInput),
          );
          const encodedOutput = yield* encodeServerWire(mock.output, value);
          return yield* decodeServerWire<A>(fn.output, encodedOutput);
        }),
    };
  };

  /** Builds a `ServerClient` Layer backed by local test mocks. */
  export const mockLayer = (
    ...mocks: readonly AnyServerFunctionMock[]
  ): Layer.Layer<ServerClient> => Layer.succeed(ServerClient)(mockClient(...mocks));

  /** Provides local test mocks to one Effect that calls server functions. */
  export const provideMocks = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    ...mocks: readonly AnyServerFunctionMock[]
  ): Effect.Effect<A, E, Exclude<R, ServerClient>> =>
    Effect.provideService(effect, ServerClient, mockClient(...mocks));

  /**
   * Defines and registers a callable server function with a local handler.
   *
   * Prefer Server.contract plus Server.client/implement when the declaration is
   * shared across client and server bundles. Registered functions are available
   * through `Server.functions()`, `Server.get(...)`, and the default
   * `defineApp(...)` registry snapshot.
   */
  export const fn = <
    I,
    A,
    E = never,
    R = never,
    Definition extends Omit<ServerFunctionDefinition<I, A, E, R>, "handler"> & {
      readonly handler: (input: I) => EffectInput<A, E, R>;
    } = Omit<ServerFunctionDefinition<I, A, E, R>, "handler"> & {
      readonly handler: (input: I) => EffectInput<A, E, R>;
    },
  >(
    name: string,
    definition: Definition & CheckedServerFunctionHandler<I, Definition>,
  ): ServerFunction<I, A, E, R> => defineServerFunction(name, definition);

  /**
   * Creates and registers a client-only server function stub.
   *
   * Calls require a provided `ServerClient`; without one, the stub fails with
   * `ServerFunctionNotFound`.
   */
  export const stub = <I, A, E = never>(
    name: string,
    definition: Omit<ServerFunctionDefinition<I, A, E, never>, "handler">,
  ): ServerFunction<I, A, E, never> => {
    const missing = (): ServerFunctionNotFound =>
      new ServerFunctionNotFound({ functionName: name });
    const local = (_input: I): Effect.Effect<A, ServerFunctionNotFound> => Effect.fail(missing());
    const effect = (input: I): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError> =>
      Effect.gen(function* () {
        const client = yield* Effect.serviceOption(ServerClient);
        if (Option.isSome(client)) {
          return yield* client.value.call(callable, input);
        }
        return yield* Effect.fail(missing());
      });
    const invoke = (_input: unknown): Effect.Effect<unknown, ServerFunctionNotFound> =>
      Effect.fail(missing());
    const callable = ((input: I) => effect(input)) as ServerFunction<I, A, E, never>;

    Object.defineProperties(callable, {
      [ServerFunctionTypeId]: { value: ServerFunctionTypeId },
      name: { value: name },
      input: { value: definition.input, enumerable: true },
      output: { value: definition.output, enumerable: true },
      error: { value: definition.error, enumerable: true },
      hasHandler: { value: false, enumerable: true },
      effect: { value: effect, enumerable: true },
      local: { value: local, enumerable: true },
      invoke: { value: invoke, enumerable: true },
    });

    registerServerFunctionDefinition(callable);
    return callable;
  };

  /** Registered server functions keyed by function name. */
  export const functions = (): ReadonlyMap<string, AnyServerFunction> =>
    serverFunctionDefinitionRegistry<AnyServerFunction>();

  /** Alias for `Server.functions()`, useful for registry-oriented adapters. */
  export const definitions = (): ReadonlyMap<string, AnyServerFunction> => functions();

  /** Looks up a registered server function by function name. */
  export const get = <I = unknown, A = unknown, E = never, R = never>(
    name: string,
  ): ServerFunction<I, A, E, R> | undefined =>
    getServerFunctionDefinition<ServerFunction<I, A, E, R>>(name);

  /** Registry diagnostics, including duplicate action/server registrations. */
  export const registryDiagnostics = coreDefinitionRegistryDiagnostics;

  /**
   * Test-only reset for registered server functions.
   *
   * Unsafe because it mutates process-wide state observed by later
   * `defineApp(...)` calls.
   */
  export const clearRegistryUnsafe = (): void => {
    clearServerFunctionDefinitionRegistryUnsafe();
  };

  /**
   * Creates an adapter-neutral HTTP route whose handler is normalized to an Effect.
   */
  export const route = <E = never, R = never>(
    method: string,
    path: string,
    handler: (request: Request) => EffectInput<Response, E, R>,
  ): ServerRoute<E, R> => ({
    method,
    path,
    handler: (request) =>
      invokeEffectInput(`Server.route(${method} ${path}).handler`, handler, request).pipe(
        Effect.mapError((error) =>
          error instanceof EffectInputCallbackError
            ? new ServerRouteHandlerError({ method, path, cause: error })
            : error,
        ),
      ),
  });

  /**
   * Handles one ServerRoute as an Effect and applies request/response context.
   *
   * Use this in server adapters that already run Effect.
   */
  export const handleRouteEffect = <E, R>(
    route: ServerRoute<E, R>,
    request: Request,
  ): Effect.Effect<Response, E | ServerRouteHandlerError, R> =>
    Effect.suspend(() => {
      const responseContext = makeResponseContext();
      return Effect.try({
        try: () => route.handler(request),
        catch: (cause) => serverRouteHandlerError(route, cause),
      }).pipe(
        Effect.flatMap((response) =>
          provideRequest(request)(provideResponse(responseContext)(response)),
        ),
        Effect.mapError((error) => mapServerRouteBoundaryError(route, error)),
        Effect.flatMap((response) =>
          applyResponseContextEffect(responseContext, response).pipe(
            Effect.mapError((error) => serverRouteHandlerError(route, error)),
          ),
        ),
      );
    });

  /** Alias for `Server.handleRouteEffect(...)`. */
  export const handleRoute = <E, R>(
    route: ServerRoute<E, R>,
    request: Request,
  ): Effect.Effect<Response, E | ServerRouteHandlerError, R> => handleRouteEffect(route, request);

  /** Builds a schema-presence manifest from registered server functions. */
  export const manifest = (
    functions: Iterable<AnyServerFunction>,
  ): Array<{
    readonly name: string;
    readonly inputSchema: boolean;
    readonly outputSchema: boolean;
    readonly errorSchema: boolean;
  }> => serverWireManifest(functions);

  /** Encodes a function input through the function's input schema when present. */
  export const encodeInput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: I,
  ): Effect.Effect<unknown, Schema.SchemaError> => encodeServerFunctionInput(fn, input);

  /** Decodes an unknown wire input through the function's input schema when present. */
  export const decodeInput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: unknown,
  ): Effect.Effect<I, Schema.SchemaError> => decodeServerFunctionInput(fn, input);

  /** Encodes a function output through the function's output schema when present. */
  export const encodeOutput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    output: A,
  ): Effect.Effect<unknown, Schema.SchemaError> => encodeServerFunctionOutput(fn, output);

  /** Decodes an unknown wire output through the function's output schema when present. */
  export const decodeOutput = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    output: unknown,
  ): Effect.Effect<A, Schema.SchemaError> => decodeServerFunctionOutput(fn, output);

  /** Encodes a function failure through the function's error schema when present. */
  export const encodeError = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    error: E,
  ): Effect.Effect<unknown, Schema.SchemaError> => encodeServerFunctionError(fn, error);

  /** Decodes an unknown wire failure through the function's error schema when present. */
  export const decodeError = <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    error: unknown,
  ): Effect.Effect<E, Schema.SchemaError> => decodeServerFunctionError(fn, error);

  /** Decodes the generic server-function RPC request envelope. */
  export const decodeRpcRequest = (
    input: unknown,
  ): Effect.Effect<ServerRpcRequest, Schema.SchemaError> => decodeServerRpcRequest(input);

  /** Decodes the generic server-function RPC response envelope. */
  export const decodeRpcResponse = (
    input: unknown,
  ): Effect.Effect<ServerRpcResponse, Schema.SchemaError> => decodeServerRpcResponse(input);

  /**
   * Creates a ServerClient that invokes registered local handlers.
   *
   * Useful for SSR tests and host adapters that want RPC-like schema round trips
   * without crossing an HTTP transport.
   */
  export const localClient = (options: LocalServerClientOptions = {}): ServerClient => ({
    call: <I, A, E, R>(
      fn: ServerFunction<I, A, E, R>,
      input: I,
    ): Effect.Effect<A, E | EffectInputCallbackError | ServerClientError, R> =>
      Effect.gen(function* () {
        const target =
          options.registry === undefined
            ? Server.get<I, A, E, R>(fn.name)
            : (options.registry.serverFunctions.get(fn.name) as
                | ServerFunction<I, A, E, R>
                | undefined);
        if (!target?.hasHandler) {
          return yield* Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }));
        }

        const encodedInput = yield* Server.encodeInput(fn, input);
        const encodedOutput = yield* catchServerFunctionError(fn, target.invoke(encodedInput));
        return yield* Server.decodeOutput(fn, encodedOutput);
      }),
  });

  /** Serializes thrown defects into JSON-safe diagnostic data when possible. */
  export const serializeDefect = serializeServerDefect;

  /** Serializes known server RPC errors for transport responses. */
  export const serializeServerError = serializeServerWireError;

  /** Decodes known server RPC errors, falling back to a protocol error. */
  export const deserializeServerError = deserializeServerWireError;
}
