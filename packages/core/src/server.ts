import { Context, Data, Effect, Exit, Layer, Option, Schema } from "effect";
import { Rpc, RpcSerialization, type RpcClientError } from "effect/rpc";
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
  EnsureEffectInputValue,
} from "./effect-like.js";
import { EffectInputCallbackError, invokeEffectInput } from "./effect-like.js";

export const ServerFunctionTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ServerFunction",
) as typeof ServerFunctionTypeId;

export const ServerFunctionContractTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ServerFunctionContract",
) as typeof ServerFunctionContractTypeId;

export const ServerFunctionMockTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ServerFunctionMock",
) as typeof ServerFunctionMockTypeId;

/** No `ServerClient` or registered implementation answers a server function call. */
export class ServerFunctionNotFound extends Data.TaggedError("ServerFunctionNotFound")<{
  readonly functionName: string;
}> {}

/** A schema a server function sends over the wire: it needs no services to encode or decode. */
export type ServerFunctionSchema = Schema.Codec<unknown, unknown, never, never>;

/** The `effect/rpc` definition behind a server function (its tag is the function name). */
export type ServerFunctionRpc = Rpc.AnyWithProps;

/**
 * Wire schemas of a server function. `input` and `output` are required;
 * `error` defaults to `Schema.Never` (the function has no typed failures).
 */
export interface ServerFunctionContractDefinition<
  Input extends ServerFunctionSchema,
  Output extends ServerFunctionSchema,
  Error extends ServerFunctionSchema = typeof Schema.Never,
> {
  readonly input: Input;
  readonly output: Output;
  readonly error?: Error;
}

/**
 * Transport-safe description of a server function: an `effect/rpc` `Rpc`
 * named after the function.
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
  readonly rpc: ServerFunctionRpc;
}

/** Test implementation for a server function contract. */
export interface ServerFunctionMock<I, A, E = never, R = never> {
  readonly [ServerFunctionMockTypeId]: typeof ServerFunctionMockTypeId;
  readonly name: string;
  readonly rpc: ServerFunctionRpc;
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
  /** The `effect/rpc` definition Start serves and calls over HTTP. */
  readonly rpc: ServerFunctionRpc;
  readonly hasHandler: boolean;
  effect(input: I): Effect.Effect<A, E | ServerClientError, R>;
  /** Runs the implementation's handler in-process, without wire schemas. */
  local(input: I): Effect.Effect<A, E | EffectInputCallbackError | ServerFunctionNotFound, R>;
  (input: I): Effect.Effect<A, E | ServerClientError, R>;
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

/**
 * Failures a server function call reports beside the function's own:
 * `RpcClientError` (HTTP transport), `ServerFunctionNotFound` (nothing
 * answers the call), `SchemaError` (a value does not match the contract's
 * wire schemas in-process), and `EffectInputCallbackError` (a handler threw).
 */
export type ServerClientError =
  | RpcClientError.RpcClientError
  | ServerFunctionNotFound
  | Schema.SchemaError
  | EffectInputCallbackError;

/** Brand of a `ServerClient` (see `Server.makeClient`). */
export const ServerClientTypeId: unique symbol = Symbol.for(
  "@sunfall/arc-core/ServerClient",
) as typeof ServerClientTypeId;

/**
 * Transport used by server function clients.
 *
 * Provide this service to redirect `.effect` calls through a remote or mock client
 * instead of the local implementation. Build one with `Server.makeClient(call)`.
 * The brand keeps the type nominal: requirement checks compare services
 * structurally, and every callable value (an `SqlClient`, any function) has a
 * `call` method, so an unbranded client would make them look provided.
 */
export interface ServerClient {
  readonly [ServerClientTypeId]: typeof ServerClientTypeId;
  readonly call: <I, A, E, R>(
    fn: ServerFunction<I, A, E, R>,
    input: I,
  ) => Effect.Effect<A, E | ServerClientError, R>;
}

export const ServerClient = Context.Service<ServerClient>("@sunfall/arc-core/ServerClient");

type FromContract<T> = [T][T extends unknown ? 0 : never];
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

type AnyServerFunction = ServerFunction<any, any, any, any>;
type AnyServerFunctionContract = ServerFunctionContract<any, any, any>;
type AnyServerFunctionMock = ServerFunctionMock<any, any, any, any>;

export const isServerFunction = (value: unknown): value is AnyServerFunction =>
  typeof value === "function" &&
  (value as { [ServerFunctionTypeId]?: unknown })[ServerFunctionTypeId] === ServerFunctionTypeId;

export const isServerFunctionContract = (value: unknown): value is AnyServerFunctionContract =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ServerFunctionContractTypeId]?: unknown })[ServerFunctionContractTypeId] ===
    ServerFunctionContractTypeId;

interface WireCodecs {
  readonly payload: Schema.Codec<unknown, unknown>;
  readonly success: Schema.Codec<unknown, unknown>;
  readonly error: Schema.Codec<unknown, unknown>;
}

const wireCodecCache = new WeakMap<ServerFunctionRpc, WireCodecs>();

/** The JSON codecs `RpcSerialization.json` puts on the wire for one Rpc. */
const wireCodecs = (rpc: ServerFunctionRpc): WireCodecs => {
  let codecs = wireCodecCache.get(rpc);
  if (codecs === undefined) {
    const codecFor = RpcSerialization.json.codecFor;
    codecs = {
      payload: codecFor(rpc.payloadSchema) as Schema.Codec<unknown, unknown>,
      success: codecFor(rpc.successSchema) as Schema.Codec<unknown, unknown>,
      error: codecFor(rpc.errorSchema) as Schema.Codec<unknown, unknown>,
    };
    wireCodecCache.set(rpc, codecs);
  }
  return codecs;
};

const roundTrip = <A>(
  codec: Schema.Codec<unknown, unknown>,
  value: unknown,
): Effect.Effect<A, Schema.SchemaError> =>
  Effect.flatMap(Schema.encodeUnknownEffect(codec)(value), (encoded) =>
    Schema.decodeUnknownEffect(codec)(encoded),
  ) as Effect.Effect<A, Schema.SchemaError>;

/**
 * Runs a server function in-process with the same schema round trips the
 * wire applies: the input, the success value, and typed failures pass
 * through the Rpc's JSON codecs, so SSR and mocks see what a browser would.
 */
const callThroughWireSchemas = <I, A, E, R>(
  fn: ServerFunction<I, A, E, R>,
  input: I,
  run: (input: I) => Effect.Effect<A, E | EffectInputCallbackError | ServerFunctionNotFound, R>,
): Effect.Effect<A, E | ServerClientError, R> =>
  Effect.gen(function* () {
    const codecs = wireCodecs(fn.rpc);
    const decodedInput = yield* roundTrip<I>(codecs.payload, input);
    const exit = yield* Effect.exit(run(decodedInput));
    if (Exit.isSuccess(exit)) {
      return yield* roundTrip<A>(codecs.success, exit.value);
    }
    const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
    if (
      failure === undefined ||
      failure.error instanceof EffectInputCallbackError ||
      failure.error instanceof ServerFunctionNotFound
    ) {
      return yield* Effect.failCause(exit.cause);
    }
    return yield* Effect.fail(yield* roundTrip<E>(codecs.error, failure.error));
  });

const makeServerFunction = <I, A, E, R>(
  name: string,
  rpc: ServerFunctionRpc,
  handler: ((input: I) => EffectInput<A, E, R>) | undefined,
): ServerFunction<I, A, E, R> => {
  const local = (
    input: I,
  ): Effect.Effect<A, E | EffectInputCallbackError | ServerFunctionNotFound, R> =>
    handler === undefined
      ? Effect.fail(new ServerFunctionNotFound({ functionName: name }))
      : invokeEffectInput(`Server.implement(${name}).handler`, handler, input);
  const effect = (input: I): Effect.Effect<A, E | ServerClientError, R> =>
    Effect.flatMap(Effect.serviceOption(ServerClient), (client) =>
      Option.isSome(client) ? client.value.call(callable, input) : local(input),
    );
  const callable = ((input: I) => effect(input)) as ServerFunction<I, A, E, R>;

  Object.defineProperties(callable, {
    [ServerFunctionTypeId]: { value: ServerFunctionTypeId },
    name: { value: name },
    rpc: { value: rpc, enumerable: true },
    hasHandler: { value: handler !== undefined, enumerable: true },
    effect: { value: effect, enumerable: true },
    local: { value: local, enumerable: true },
  });

  registerServerFunctionDefinition(callable);
  return callable;
};

const makeServerClient = (call: ServerClient["call"]): ServerClient => ({
  [ServerClientTypeId]: ServerClientTypeId,
  call,
});

/** ServerClient that answers calls using the supplied mocks; backs `Server.mockLayer`. */
const mockClient = (...mocks: readonly AnyServerFunctionMock[]): ServerClient => {
  const byName = new Map<string, AnyServerFunctionMock>(mocks.map((mock) => [mock.name, mock]));

  return makeServerClient(
    <I, A, E, R>(
      fn: ServerFunction<I, A, E, R>,
      input: I,
    ): Effect.Effect<A, E | ServerClientError, R> => {
      const mock = byName.get(fn.name) as ServerFunctionMock<I, A, E, R> | undefined;
      return mock === undefined
        ? Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }))
        : callThroughWireSchemas(fn, input, (decoded) =>
            invokeEffectInput(`Server.mock(${fn.name}).handler`, mock.handler, decoded),
          );
    },
  );
};

/** Helpers for contracts, client stubs, server implementations, and mocks. */
export namespace Server {
  export type Fn<I, A, E = never, R = never> = ServerFunction<I, A, E, R>;
  export type Contract<I, A, E = never> = ServerFunctionContract<I, A, E>;
  export type Mock<I, A, E = never, R = never> = ServerFunctionMock<I, A, E, R>;
  /** Transport used by server function clients; provide it to route `.effect` calls. */
  export type Client = ServerClient;
  /** Transport used by server function clients; provide it to route `.effect` calls. */
  export const Client = ServerClient;
  /** Wire schemas of a server function contract. */
  export type ContractDefinition<
    Input extends ServerFunctionSchema,
    Output extends ServerFunctionSchema,
    Error extends ServerFunctionSchema = typeof Schema.Never,
  > = ServerFunctionContractDefinition<Input, Output, Error>;
  /** A schema a server function sends over the wire. */
  export type WireSchema = ServerFunctionSchema;
  /** Options for `Server.localClient`. */
  export type LocalClientOptions = LocalServerClientOptions;
  export type ClientError = ServerClientError;

  /**
   * Defines a shared server function contract: an `effect/rpc` `Rpc` named
   * after the function. Its types come from the schemas.
   *
   * @example
   * ```ts
   * const GetUser = Server.contract("GetUser", {
   *   input: Schema.Struct({ id: Schema.String }),
   *   output: User,
   *   error: UserNotFound,
   * });
   * ```
   */
  export const contract = <
    Input extends ServerFunctionSchema,
    Output extends ServerFunctionSchema,
    Error extends ServerFunctionSchema = typeof Schema.Never,
  >(
    name: string,
    definition: ServerFunctionContractDefinition<Input, Output, Error>,
  ): ServerFunctionContract<Input["Type"], Output["Type"], Error["Type"]> => ({
    [ServerFunctionContractTypeId]: ServerFunctionContractTypeId,
    name,
    rpc: Rpc.make(name, {
      payload: definition.input,
      success: definition.output,
      error: definition.error ?? Schema.Never,
    }) as unknown as ServerFunctionRpc,
  });

  /** Creates a client stub from a shared contract. */
  export const client = <I, A, E = never>(
    contract: ServerFunctionContract<I, A, E>,
  ): ServerFunction<I, A, E, never> =>
    makeServerFunction<I, A, E, never>(contract.name, contract.rpc, undefined);

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
    makeServerFunction(
      contract.name,
      contract.rpc,
      handler as (
        input: ServerContractInput<Contract>,
      ) => EffectInput<
        ServerContractOutput<Contract>,
        ServerContractError<Contract>,
        EffectInputRequirements<Out>
      >,
    );

  /** Creates a mock handler for a contract, provided through `Server.mockLayer`. */
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
    rpc: contract.rpc,
    handler: handler as (
      input: ServerContractInput<Contract>,
    ) => EffectInput<
      ServerContractOutput<Contract>,
      ServerContractError<Contract>,
      EffectInputRequirements<Out>
    >,
  });

  /**
   * Builds a `ServerClient` Layer backed by local test mocks. Calls pass
   * through the contract's wire schemas, as they would over HTTP.
   */
  export const mockLayer = (
    ...mocks: readonly AnyServerFunctionMock[]
  ): Layer.Layer<ServerClient> => Layer.succeed(ServerClient)(mockClient(...mocks));

  /** Registered server functions keyed by function name. */
  export const functions = (): ReadonlyMap<string, AnyServerFunction> =>
    serverFunctionDefinitionRegistry<AnyServerFunction>();

  /** Registry diagnostics, including duplicate action/server registrations. */
  export const registryDiagnostics = coreDefinitionRegistryDiagnostics;

  /**
   * Test-only reset for registered server functions.
   *
   * Unsafe because it mutates process-wide state observed by later
   * `App.define(...)` calls.
   */
  export const clearRegistryUnsafe = (): void => {
    clearServerFunctionDefinitionRegistryUnsafe();
  };

  /**
   * Creates a ServerClient that runs registered implementations in-process.
   *
   * Start's request runtime provides it during SSR, so server-function calls
   * made while rendering never cross HTTP. Calls pass through the contract's
   * wire schemas, so values match what the HTTP client would decode.
   */
  export const localClient = (options: LocalServerClientOptions = {}): ServerClient =>
    makeServerClient(
      <I, A, E, R>(
        fn: ServerFunction<I, A, E, R>,
        input: I,
      ): Effect.Effect<A, E | ServerClientError, R> => {
        const target =
          options.registry === undefined
            ? getServerFunctionDefinition<ServerFunction<I, A, E, R>>(fn.name)
            : (options.registry.serverFunctions.get(fn.name) as
                | ServerFunction<I, A, E, R>
                | undefined);
        return target?.hasHandler
          ? callThroughWireSchemas(fn, input, target.local)
          : Effect.fail(new ServerFunctionNotFound({ functionName: fn.name }));
      },
    );

  /**
   * Builds a `ServerClient` from its `call`: how a transport (HTTP, a test
   * double) answers one server-function call.
   */
  export const makeClient = makeServerClient;
}
