import type { ServerFunction } from "@effect-ui/core";
import { Data, Effect, Schema } from "effect";
import {
  classifyStartManifestModule,
  compareManifestEntries,
  isNonEmptyString,
  isRecord,
  isStartManifestContractModule,
  isStartManifestServerOnlyModule,
  normalizeManifestModuleId,
  stableManifestEntryId,
  validateManifestDefinition,
  validateManifestEntrySet,
  type StartManifestModuleKind
} from "./manifest-entry-core.js";
import { serverRpcPath } from "./rpc.js";

export const ServerFunctionId = Schema.String.pipe(Schema.brand("ServerFunctionId"));
export type ServerFunctionId = typeof ServerFunctionId.Type;

export type ServerFunctionModuleKind = StartManifestModuleKind;

export interface ServerFunctionManifestDefinition {
  readonly name: string;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
  readonly hasHandler?: boolean;
  readonly inputSchema?: boolean;
  readonly outputSchema?: boolean;
  readonly errorSchema?: boolean;
}

export interface ServerFunctionManifestSource {
  readonly fn: ServerFunction<unknown, unknown, unknown, unknown>;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
}

export interface ServerFunctionManifestOptions {
  readonly rpcPath?: string;
}

export interface ServerFunctionWireContract {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

export interface ServerFunctionServerReference {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: ServerFunctionModuleKind;
  readonly hasHandler: boolean;
}

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

export interface ServerFunctionManifestEntry {
  readonly id: ServerFunctionId;
  readonly name: string;
  readonly server: ServerFunctionServerReference;
  readonly client: ServerFunctionClientReference;
  readonly wire: ServerFunctionWireContract;
}

export interface ServerFunctionManifest {
  readonly version: 1;
  readonly rpcPath: string;
  readonly entries: readonly ServerFunctionManifestEntry[];
}

export class ServerFunctionManifestInvalidEntry extends Data.TaggedError(
  "ServerFunctionManifestInvalidEntry"
)<{
  readonly index: number;
  readonly reason: "MissingName" | "MissingModule" | "MissingExportName";
  readonly entry: unknown;
}> {}

export class ServerFunctionManifestDuplicateName extends Data.TaggedError(
  "ServerFunctionManifestDuplicateName"
)<{
  readonly name: string;
  readonly firstModule: string;
  readonly secondModule: string;
}> {}

export class ServerFunctionManifestDuplicateExport extends Data.TaggedError(
  "ServerFunctionManifestDuplicateExport"
)<{
  readonly module: string;
  readonly exportName: string;
  readonly firstName: string;
  readonly secondName: string;
}> {}

export class ServerFunctionManifestDuplicateId extends Data.TaggedError(
  "ServerFunctionManifestDuplicateId"
)<{
  readonly id: ServerFunctionId;
  readonly firstName: string;
  readonly secondName: string;
}> {}

export class ServerFunctionManifestUnsafeClientReference extends Data.TaggedError(
  "ServerFunctionManifestUnsafeClientReference"
)<{
  readonly name: string;
  readonly clientModule: string;
}> {}

export class ServerFunctionManifestParseError extends Data.TaggedError(
  "ServerFunctionManifestParseError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ServerFunctionManifestError =
  | ServerFunctionManifestInvalidEntry
  | ServerFunctionManifestDuplicateName
  | ServerFunctionManifestDuplicateExport
  | ServerFunctionManifestDuplicateId
  | ServerFunctionManifestUnsafeClientReference;

const compareEntries = (
  left: ServerFunctionManifestEntry,
  right: ServerFunctionManifestEntry
): number => compareManifestEntries(left, right);

export { normalizeManifestModuleId } from "./manifest-entry-core.js";

export const isServerFunctionServerOnlyModule = (id: string): boolean =>
  isStartManifestServerOnlyModule(id);

export const isServerFunctionContractModule = (id: string): boolean =>
  isStartManifestContractModule(id);

export const classifyServerFunctionModule = (id: string): ServerFunctionModuleKind =>
  classifyStartManifestModule(id);

export const stableServerFunctionId = (name: string): ServerFunctionId =>
  Schema.decodeUnknownSync(ServerFunctionId)(stableManifestEntryId("sf", "function", name));

export const serverFunctionManifestDefinition = (
  fn: ServerFunction<unknown, unknown, unknown, unknown>,
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

const validateDefinition = (
  definition: ServerFunctionManifestDefinition,
  index: number
): Effect.Effect<
  {
    readonly name: string;
    readonly module: string;
    readonly exportName: string;
  },
  ServerFunctionManifestInvalidEntry
> =>
  validateManifestDefinition(definition, index, (input) =>
    new ServerFunctionManifestInvalidEntry(input)
  );

export const makeServerFunctionManifestEntry = (
  definition: ServerFunctionManifestDefinition,
  options: ServerFunctionManifestOptions = {},
  index = 0
): Effect.Effect<
  ServerFunctionManifestEntry,
  ServerFunctionManifestInvalidEntry | ServerFunctionManifestUnsafeClientReference
> =>
  Effect.gen(function* () {
    const validated = yield* validateDefinition(definition, index);
    const id = stableServerFunctionId(validated.name);
    const rpcPath = options.rpcPath ?? serverRpcPath;
    const server: ServerFunctionServerReference = {
      module: validated.module,
      exportName: validated.exportName,
      moduleKind: classifyServerFunctionModule(validated.module),
      hasHandler: definition.hasHandler ?? true
    };
    const wire: ServerFunctionWireContract = {
      inputSchema: definition.inputSchema ?? false,
      outputSchema: definition.outputSchema ?? false,
      errorSchema: definition.errorSchema ?? false
    };

    if (definition.clientModule === undefined) {
      return {
        id,
        name: validated.name,
        server,
        client: {
          _tag: "Rpc" as const,
          id,
          name: validated.name,
          rpcPath
        },
        wire
      };
    }

    const clientModule = normalizeManifestModuleId(definition.clientModule);
    const moduleKind = classifyServerFunctionModule(clientModule);
    if (moduleKind === "server-only") {
      return yield* Effect.fail(
        new ServerFunctionManifestUnsafeClientReference({
          name: validated.name,
          clientModule
        })
      );
    }

    return {
      id,
      name: validated.name,
      server,
      client: {
        _tag: "Import" as const,
        id,
        name: validated.name,
        rpcPath,
        module: clientModule,
        exportName: definition.clientExportName ?? validated.exportName,
        moduleKind
      },
      wire
    };
  });

export const makeServerFunctionManifest = (
  definitions: Iterable<ServerFunctionManifestDefinition>,
  options: ServerFunctionManifestOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestError> =>
  Effect.gen(function* () {
    const entries: ServerFunctionManifestEntry[] = [];
    const rpcPath = options.rpcPath ?? serverRpcPath;
    let index = 0;
    for (const definition of definitions) {
      entries.push(yield* makeServerFunctionManifestEntry(definition, options, index));
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

export const clientReferencesForServerFunctionManifest = (
  manifest: ServerFunctionManifest
): readonly ServerFunctionClientReference[] => manifest.entries.map((entry) => entry.client);

export const isBrowserSafeServerFunctionClientReference = (
  reference: ServerFunctionClientReference
): boolean => reference._tag === "Rpc" || !isServerFunctionServerOnlyModule(reference.module);

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
): Effect.Effect<ServerFunctionManifestDefinition, ServerFunctionManifestParseError> => {
  if (!isRecord(value) || !isRecord(value.server) || !isRecord(value.wire) || !isRecord(value.client)) {
    return Effect.fail(
      new ServerFunctionManifestParseError({
        message: `Expected manifest entry ${index} to contain server, client, and wire records.`
      })
    );
  }

  if (
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.id) ||
    value.id !== stableServerFunctionId(value.name) ||
    !isNonEmptyString(value.server.module) ||
    !isNonEmptyString(value.server.exportName) ||
    typeof value.server.hasHandler !== "boolean" ||
    typeof value.wire.inputSchema !== "boolean" ||
    typeof value.wire.outputSchema !== "boolean" ||
    typeof value.wire.errorSchema !== "boolean"
  ) {
    return Effect.fail(
      new ServerFunctionManifestParseError({
        message: `Manifest entry ${index} has invalid server or wire fields.`
      })
    );
  }

  if (
    !isNonEmptyString(value.client.id) ||
    value.client.id !== value.id ||
    value.client.name !== value.name ||
    value.client.rpcPath !== rpcPath
  ) {
    return Effect.fail(
      new ServerFunctionManifestParseError({
        message: `Manifest entry ${index} has an invalid client identity.`
      })
    );
  }

  const base = {
    name: value.name,
    module: value.server.module,
    exportName: value.server.exportName,
    hasHandler: value.server.hasHandler,
    inputSchema: value.wire.inputSchema,
    outputSchema: value.wire.outputSchema,
    errorSchema: value.wire.errorSchema
  };

  if (value.client._tag === "Rpc") {
    return Effect.succeed(base);
  }

  if (
    value.client._tag !== "Import" ||
    !isNonEmptyString(value.client.module) ||
    !isNonEmptyString(value.client.exportName)
  ) {
    return Effect.fail(
      new ServerFunctionManifestParseError({
        message: `Manifest entry ${index} has an invalid client reference.`
      })
    );
  }

  return Effect.succeed({
    ...base,
    clientModule: value.client.module,
    clientExportName: value.client.exportName
  });
};

const decodeSerializedManifest = (
  value: unknown
): Effect.Effect<
  {
    readonly rpcPath: string;
    readonly definitions: readonly ServerFunctionManifestDefinition[];
  },
  ServerFunctionManifestParseError
> => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(value.rpcPath) ||
    !Array.isArray(value.entries)
  ) {
    return Effect.fail(
      new ServerFunctionManifestParseError({
        message: "Expected a version 1 server function manifest."
      })
    );
  }

  const rpcPath = value.rpcPath;
  return Effect.map(
    Effect.forEach(value.entries, (entry, index) =>
      decodeSerializedEntry(entry, index, rpcPath)
    ),
    (definitions) => ({
      rpcPath,
      definitions
    })
  );
};

export const deserializeServerFunctionManifest = (
  serialized: string,
  options: ServerFunctionManifestOptions = {}
): Effect.Effect<ServerFunctionManifest, ServerFunctionManifestParseError | ServerFunctionManifestError> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new ServerFunctionManifestParseError({
        message: "Server function manifest is not valid JSON.",
        cause
      })
  }).pipe(
    Effect.flatMap(decodeSerializedManifest),
    Effect.flatMap(({ definitions, rpcPath }) =>
      makeServerFunctionManifest(definitions, {
        rpcPath: options.rpcPath ?? rpcPath
      })
    )
  );
