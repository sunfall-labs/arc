import type { ServerFunction } from "@effect-ui/core";
import { Data, Effect, Schema } from "effect";
import {
  assembleCallableManifestEntry,
  classifyStartManifestModule,
  compareManifestEntries,
  decodeSerializedCallableManifest,
  decodeSerializedCallableManifestEntry,
  isStartManifestContractModule,
  isStartManifestServerOnlyModule,
  parseSerializedStartManifestJson,
  stableManifestEntryId,
  validateManifestEndpointPathEffect,
  validateManifestEntrySet,
  type StartManifestEndpointPathErrorInput,
  type StartManifestModuleKind
} from "./manifest-entry-core.js";
import { defaultStartTransportEndpoints } from "./start-transport-endpoints.js";

/** Branded stable id for one server function manifest entry. */
export const ServerFunctionId = Schema.String.pipe(Schema.brand("ServerFunctionId"));
/** Branded stable id for one server function manifest entry. */
export type ServerFunctionId = typeof ServerFunctionId.Type;

/**
 * Manifest module classification for server-function references.
 *
 * `server-only` modules may only be imported on the server, `contract` modules
 * are shared declarations, and `shared` modules are normal client-safe modules.
 */
export type ServerFunctionModuleKind = StartManifestModuleKind;

/**
 * Raw server-function definition before validation and id generation.
 *
 * Generated manifests use this shape while turning registered functions into
 * transport-safe manifest entries.
 */
export interface ServerFunctionManifestDefinition {
  /** Stable function name used on the RPC wire. */
  readonly name: string;
  /** Server module that owns the implementation or contract. */
  readonly module: string;
  /** Export name in the server module; omitted only for generated synthetic entries. */
  readonly exportName?: string;
  /** Optional client-safe module for direct import client references. */
  readonly clientModule?: string;
  /** Export name in `clientModule`; defaults to the server export name. */
  readonly clientExportName?: string;
  /** Whether the server definition has a local handler. */
  readonly hasHandler?: boolean;
  /** Whether the input wire path should apply an Effect Schema. */
  readonly inputSchema?: boolean;
  /** Whether the output wire path should apply an Effect Schema. */
  readonly outputSchema?: boolean;
  /** Whether the error wire path should apply an Effect Schema. */
  readonly errorSchema?: boolean;
}

/** Registered server function plus module metadata discovered by build tools. */
export interface ServerFunctionManifestSource {
  readonly fn: ServerFunction<any, any, any, any>;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
}

/** Options that control server-function manifest endpoint generation and decoding. */
export interface ServerFunctionManifestOptions {
  /** RPC endpoint path used by generated client references. */
  readonly rpcPath?: string;
}

/** Schema presence flags that describe the server-function wire contract. */
export interface ServerFunctionWireContract {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

/** Server-side module/export metadata for invoking a server function. */
export interface ServerFunctionServerReference {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: ServerFunctionModuleKind;
  readonly hasHandler: boolean;
}

/**
 * Client-side reference strategy for a server function.
 *
 * `Rpc` means calls go through the Start RPC endpoint. `Import` means the
 * client can import a client-safe module directly while still retaining the RPC
 * path as the transport fallback.
 */
export type ServerFunctionClientReference =
  | {
      readonly _tag: "Rpc";
      readonly id: ServerFunctionId;
      readonly name: string;
      readonly rpcPath: string;
    }
  | {
      readonly _tag: "Import";
      readonly id: ServerFunctionId;
      readonly name: string;
      readonly rpcPath: string;
      readonly module: string;
      readonly exportName: string;
      readonly moduleKind: Exclude<ServerFunctionModuleKind, "server-only">;
    };

/** Fully validated server function manifest entry. */
export interface ServerFunctionManifestEntry {
  readonly id: ServerFunctionId;
  readonly name: string;
  readonly server: ServerFunctionServerReference;
  readonly client: ServerFunctionClientReference;
  readonly wire: ServerFunctionWireContract;
}

/** Complete server function manifest consumed by virtual modules and clients. */
export interface ServerFunctionManifest {
  readonly version: 1;
  readonly rpcPath: string;
  readonly entries: readonly ServerFunctionManifestEntry[];
}

/** Validation error for a raw server-function definition with missing identity fields. */
export class ServerFunctionManifestInvalidEntry extends Data.TaggedError(
  "ServerFunctionManifestInvalidEntry"
)<{
  readonly index: number;
  readonly reason: "MissingName" | "MissingModule" | "MissingExportName";
  readonly entry: unknown;
}> {}

/** Error raised when two server functions use the same public function name. */
export class ServerFunctionManifestDuplicateName extends Data.TaggedError(
  "ServerFunctionManifestDuplicateName"
)<{
  readonly name: string;
  readonly firstModule: string;
  readonly secondModule: string;
}> {}

/** Error raised when two server functions point at the same module export. */
export class ServerFunctionManifestDuplicateExport extends Data.TaggedError(
  "ServerFunctionManifestDuplicateExport"
)<{
  readonly module: string;
  readonly exportName: string;
  readonly firstName: string;
  readonly secondName: string;
}> {}

/** Error raised when two server-function names produce the same stable id. */
export class ServerFunctionManifestDuplicateId extends Data.TaggedError(
  "ServerFunctionManifestDuplicateId"
)<{
  readonly id: ServerFunctionId;
  readonly firstName: string;
  readonly secondName: string;
}> {}

/** Error raised when a server function declares a browser import from a server-only module. */
export class ServerFunctionManifestUnsafeClientReference extends Data.TaggedError(
  "ServerFunctionManifestUnsafeClientReference"
)<{
  readonly name: string;
  readonly clientModule: string;
}> {}

/** Error raised when the server-function RPC endpoint is not an origin-form path. */
export class ServerFunctionManifestInvalidEndpointPath extends Data.TaggedError(
  "ServerFunctionManifestInvalidEndpointPath"
)<{
  readonly field: "rpcPath";
  readonly value: unknown;
  readonly reason: StartManifestEndpointPathErrorInput["reason"];
  readonly guidance: string;
}> {}

/** Error raised while decoding a serialized server-function manifest artifact. */
export class ServerFunctionManifestParseError extends Data.TaggedError(
  "ServerFunctionManifestParseError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** All validation errors that can occur while building a server-function manifest. */
export type ServerFunctionManifestError =
  | ServerFunctionManifestInvalidEntry
  | ServerFunctionManifestDuplicateName
  | ServerFunctionManifestDuplicateExport
  | ServerFunctionManifestDuplicateId
  | ServerFunctionManifestUnsafeClientReference
  | ServerFunctionManifestInvalidEndpointPath;

const compareEntries = (
  left: ServerFunctionManifestEntry,
  right: ServerFunctionManifestEntry
): number => compareManifestEntries(left, right);

export { normalizeManifestModuleId } from "./manifest-entry-core.js";

/** Return true when a module id is classified as server-only. */
export const isServerFunctionServerOnlyModule = (id: string): boolean =>
  isStartManifestServerOnlyModule(id);

/** Return true when a module id is classified as a shared contract module. */
export const isServerFunctionContractModule = (id: string): boolean =>
  isStartManifestContractModule(id);

/** Classify a server-function module id for generated client/server references. */
export const classifyServerFunctionModule = (id: string): ServerFunctionModuleKind =>
  classifyStartManifestModule(id);

/** Build the deterministic branded id used for one server-function manifest entry. */
export const stableServerFunctionId = (name: string): ServerFunctionId =>
  Schema.decodeUnknownSync(ServerFunctionId)(stableManifestEntryId("sf", "function", name));

const serverFunctionManifestInvalidEndpointPath = (
  input: StartManifestEndpointPathErrorInput
): ServerFunctionManifestInvalidEndpointPath =>
  new ServerFunctionManifestInvalidEndpointPath({
    field: "rpcPath",
    value: input.value,
    reason: input.reason,
    guidance: input.guidance
  });

const normalizeServerFunctionManifestPathEffect = (
  rpcPath: string | undefined
): Effect.Effect<string, ServerFunctionManifestInvalidEndpointPath> =>
  validateManifestEndpointPathEffect(rpcPath ?? defaultStartTransportEndpoints.rpcPath, {
    field: "rpcPath",
    invalidPath: serverFunctionManifestInvalidEndpointPath
  });

/** Convert a registered ServerFunction plus module metadata into a raw manifest definition. */
export const serverFunctionManifestDefinition = (
  fn: ServerFunction<any, any, any, any>,
  source: Omit<ServerFunctionManifestSource, "fn">
): ServerFunctionManifestDefinition => {
  const base =
    source.exportName === undefined
      ? {
          name: fn.name,
          module: source.module,
          hasHandler: fn.hasHandler,
          inputSchema: Schema.isSchema(fn.input),
          outputSchema: Schema.isSchema(fn.output),
          errorSchema: Schema.isSchema(fn.error)
        }
      : {
          name: fn.name,
          module: source.module,
          exportName: source.exportName,
          hasHandler: fn.hasHandler,
          inputSchema: Schema.isSchema(fn.input),
          outputSchema: Schema.isSchema(fn.output),
          errorSchema: Schema.isSchema(fn.error)
        };

  if (source.clientModule === undefined) {
    return base;
  }

  return source.clientExportName === undefined
    ? {
        ...base,
        clientModule: source.clientModule
      }
    : {
        ...base,
        clientModule: source.clientModule,
        clientExportName: source.clientExportName
      };
};

const sortManifestEntries = (
  entries: readonly ServerFunctionManifestEntry[]
): readonly ServerFunctionManifestEntry[] => [...entries].sort(compareEntries);

/** Validate one raw server-function definition and convert it into a manifest entry. */
export const makeServerFunctionManifestEntry = (
  definition: ServerFunctionManifestDefinition,
  options: ServerFunctionManifestOptions = {},
  index = 0
): Effect.Effect<
  ServerFunctionManifestEntry,
  | ServerFunctionManifestInvalidEntry
  | ServerFunctionManifestUnsafeClientReference
  | ServerFunctionManifestInvalidEndpointPath
> =>
  Effect.flatMap(normalizeServerFunctionManifestPathEffect(options.rpcPath), (rpcPath) =>
    assembleCallableManifestEntry(definition, {
      index,
      transportPath: rpcPath,
      stableId: stableServerFunctionId,
      invalidEntry: (input) => new ServerFunctionManifestInvalidEntry(input),
      unsafeClientReference: (input) =>
        new ServerFunctionManifestUnsafeClientReference(input),
      server: ({ definition, validated, moduleKind }): ServerFunctionServerReference => ({
        module: validated.module,
        exportName: validated.exportName,
        moduleKind,
        hasHandler: definition.hasHandler ?? true
      }),
      transportClient: ({ id, name, transportPath }): ServerFunctionClientReference => ({
        _tag: "Rpc",
        id,
        name,
        rpcPath: transportPath
      }),
      importClient: ({
        id,
        name,
        transportPath,
        module,
        exportName,
        moduleKind
      }): ServerFunctionClientReference => ({
        _tag: "Import",
        id,
        name,
        rpcPath: transportPath,
        module,
        exportName,
        moduleKind
      }),
      entry: ({ id, name, server, client, wire }): ServerFunctionManifestEntry => ({
        id,
        name,
        server,
        client,
        wire
      })
    })
  );

/** Build and validate a complete server-function manifest from raw definitions. */
export const makeServerFunctionManifest = (
  definitions: Iterable<ServerFunctionManifestDefinition>,
  options: ServerFunctionManifestOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestError> =>
  Effect.gen(function* () {
    const entries: ServerFunctionManifestEntry[] = [];
    const rpcPath = yield* normalizeServerFunctionManifestPathEffect(options.rpcPath);
    let index = 0;
    for (const definition of definitions) {
      entries.push(yield* makeServerFunctionManifestEntry(definition, { rpcPath }, index));
      index++;
    }

    yield* validateManifestEntrySet<ServerFunctionManifestEntry, ServerFunctionManifestError>(entries, {
      duplicateName: (input) => new ServerFunctionManifestDuplicateName(input),
      duplicateId: (input) => new ServerFunctionManifestDuplicateId(input),
      duplicateExport: (input) => new ServerFunctionManifestDuplicateExport(input)
    });

    return {
      version: 1 as const,
      rpcPath,
      entries: sortManifestEntries(entries)
    };
  });

/** Return the client reference entries generated from a server-function manifest. */
export const clientReferencesForServerFunctionManifest = (
  manifest: ServerFunctionManifest
): readonly ServerFunctionClientReference[] => manifest.entries.map((entry) => entry.client);

/** Check whether a server-function client reference can be imported in browser code. */
export const isBrowserSafeServerFunctionClientReference = (
  reference: ServerFunctionClientReference
): boolean => reference._tag === "Rpc" || !isServerFunctionServerOnlyModule(reference.module);

/** Serialize a server-function manifest into the virtual-module JSON payload. */
export const serializeServerFunctionManifest = (manifest: ServerFunctionManifest): string =>
  JSON.stringify({
    version: 1,
    rpcPath: manifest.rpcPath,
    entries: sortManifestEntries(manifest.entries)
  });

const decodeSerializedEntry = (
  value: unknown,
  index: number,
  rpcPath: string
): Effect.Effect<ServerFunctionManifestDefinition, ServerFunctionManifestParseError> =>
  Effect.gen(function* () {
    const decoded = yield* decodeSerializedCallableManifestEntry(value, index, {
      transportPath: rpcPath,
      transportPathField: "rpcPath",
      transportClientTag: "Rpc",
      stableId: stableServerFunctionId,
      recordEntryLabel: "manifest entry",
      messageEntryLabel: "Manifest entry",
      parseError: (message) => new ServerFunctionManifestParseError({ message })
    });

    if (typeof decoded.serverRecord.hasHandler !== "boolean") {
      return yield* Effect.fail(
        new ServerFunctionManifestParseError({
          message: `Manifest entry ${index} has invalid server or wire fields.`
        })
      );
    }

    const base = {
      name: decoded.name,
      module: decoded.module,
      exportName: decoded.exportName,
      hasHandler: decoded.serverRecord.hasHandler,
      inputSchema: decoded.inputSchema,
      outputSchema: decoded.outputSchema,
      errorSchema: decoded.errorSchema
    };

    return decoded.clientModule === undefined || decoded.clientExportName === undefined
      ? base
      : {
          ...base,
          clientModule: decoded.clientModule,
          clientExportName: decoded.clientExportName
        };
  });

const decodeSerializedManifest = (
  value: unknown
): Effect.Effect<
  {
    readonly rpcPath: string;
    readonly definitions: readonly ServerFunctionManifestDefinition[];
  },
  ServerFunctionManifestParseError
> =>
  Effect.map(
    decodeSerializedCallableManifest(value, {
      pathField: "rpcPath",
      manifestName: "server function",
      parseError: (message) => new ServerFunctionManifestParseError({ message }),
      decodeEntry: decodeSerializedEntry
    }),
    ({ path, definitions }) => ({
      rpcPath: path,
      definitions
    })
  );

/** Decode and validate a serialized server-function manifest artifact. */
export const deserializeServerFunctionManifest = (
  serialized: string,
  options: ServerFunctionManifestOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestParseError | ServerFunctionManifestError> =>
  parseSerializedStartManifestJson(serialized, (cause) =>
      new ServerFunctionManifestParseError({
        message: "Server function manifest is not valid JSON.",
        cause
      })
  ).pipe(
    Effect.flatMap(decodeSerializedManifest),
    Effect.flatMap(({ definitions, rpcPath }) =>
      makeServerFunctionManifest(definitions, {
        rpcPath: options.rpcPath ?? rpcPath
      })
    )
  );
