import { Effect } from "effect";

export type StartManifestModuleKind = "server-only" | "contract" | "shared";

export type StartManifestInvalidEntryReason =
  | "MissingName"
  | "MissingModule"
  | "MissingExportName";

export interface StartManifestDefinitionLike {
  readonly name: string;
  readonly module: string;
  readonly exportName?: string;
}

export interface StartManifestValidatedDefinition {
  readonly name: string;
  readonly module: string;
  readonly exportName: string;
}

export interface StartCallableManifestDefinitionLike extends StartManifestDefinitionLike {
  readonly clientModule?: string;
  readonly clientExportName?: string;
  readonly inputSchema?: boolean;
  readonly outputSchema?: boolean;
  readonly errorSchema?: boolean;
}

export interface StartCallableManifestWireContract {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

export interface StartCallableManifestServerReference {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: StartManifestModuleKind;
}

export interface StartCallableManifestTransportClientInput<Id> {
  readonly id: Id;
  readonly name: string;
  readonly transportPath: string;
}

export interface StartCallableManifestImportClientInput<Id>
  extends StartCallableManifestTransportClientInput<Id> {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: Exclude<StartManifestModuleKind, "server-only">;
}

export interface AssembleCallableManifestEntryOptions<
  Definition extends StartCallableManifestDefinitionLike,
  Id,
  Server,
  Client,
  Entry,
  InvalidEntryError,
  UnsafeClientReferenceError
> {
  readonly index: number;
  readonly transportPath: string;
  readonly stableId: (name: string) => Id;
  readonly invalidEntry: (input: {
    readonly index: number;
    readonly reason: StartManifestInvalidEntryReason;
    readonly entry: Definition;
  }) => InvalidEntryError;
  readonly unsafeClientReference: (input: {
    readonly name: string;
    readonly clientModule: string;
  }) => UnsafeClientReferenceError;
  readonly server: (input: {
    readonly definition: Definition;
    readonly validated: StartManifestValidatedDefinition;
    readonly moduleKind: StartManifestModuleKind;
  }) => Server;
  readonly transportClient: (
    input: StartCallableManifestTransportClientInput<Id>
  ) => Client;
  readonly importClient: (
    input: StartCallableManifestImportClientInput<Id>
  ) => Client;
  readonly entry: (input: {
    readonly definition: Definition;
    readonly validated: StartManifestValidatedDefinition;
    readonly id: Id;
    readonly name: string;
    readonly server: Server;
    readonly client: Client;
    readonly wire: StartCallableManifestWireContract;
  }) => Entry;
}

export interface StartManifestEntryLike<Id = unknown> {
  readonly id: Id;
  readonly name: string;
  readonly server: {
    readonly module: string;
    readonly exportName: string;
  };
}

export interface StartManifestEntrySetErrors<Entry extends StartManifestEntryLike> {
  readonly duplicateName: (input: {
    readonly name: string;
    readonly firstModule: string;
    readonly secondModule: string;
  }) => unknown;
  readonly duplicateId: (input: {
    readonly id: Entry["id"];
    readonly firstName: string;
    readonly secondName: string;
  }) => unknown;
  readonly duplicateExport: (input: {
    readonly module: string;
    readonly exportName: string;
    readonly firstName: string;
    readonly secondName: string;
  }) => unknown;
}

export interface DecodedSerializedCallableManifestEntry<Id = unknown> {
  readonly id: Id;
  readonly name: string;
  readonly module: string;
  readonly exportName: string;
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
  readonly clientModule?: string;
  readonly clientExportName?: string;
  readonly serverRecord: Record<string, unknown>;
  readonly clientRecord: Record<string, unknown>;
  readonly wireRecord: Record<string, unknown>;
}

export interface DecodeSerializedCallableManifestEntryOptions<Id, Error> {
  readonly transportPath: string;
  readonly transportPathField: string;
  readonly transportClientTag: string;
  readonly stableId: (name: string) => Id;
  readonly recordEntryLabel: string;
  readonly messageEntryLabel: string;
  readonly parseError: (message: string) => Error;
}

export interface DecodeSerializedCallableManifestOptions<Definition, Error> {
  readonly pathField: string;
  readonly manifestName: string;
  readonly parseError: (message: string) => Error;
  readonly decodeEntry: (
    entry: unknown,
    index: number,
    transportPath: string
  ) => Effect.Effect<Definition, Error>;
}

export const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareManifestEntries = <Entry extends StartManifestEntryLike>(
  left: Entry,
  right: Entry
): number => {
  const name = compareString(left.name, right.name);
  return name === 0 ? compareString(left.server.module, right.server.module) : name;
};

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeManifestModuleId = (id: string): string =>
  (id.split(/[?#]/, 1)[0] ?? id)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");

export const isStartManifestServerOnlyModule = (id: string): boolean =>
  /\.(server)\.[cm]?[jt]sx?$/.test(normalizeManifestModuleId(id));

export const isStartManifestContractModule = (id: string): boolean =>
  /\.(contract)\.[cm]?[jt]sx?$/.test(normalizeManifestModuleId(id));

export const classifyStartManifestModule = (id: string): StartManifestModuleKind => {
  if (isStartManifestServerOnlyModule(id)) {
    return "server-only";
  }
  if (isStartManifestContractModule(id)) {
    return "contract";
  }
  return "shared";
};

const hashName = (name: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const slugName = (name: string, fallback: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length === 0 ? fallback : slug;
};

export const stableManifestEntryId = (
  prefix: string,
  fallbackSlug: string,
  name: string
): string => `${prefix}_${hashName(name)}_${slugName(name, fallbackSlug)}`;

export const validateManifestDefinition = <Definition extends StartManifestDefinitionLike, Error>(
  definition: Definition,
  index: number,
  invalidEntry: (input: {
    readonly index: number;
    readonly reason: StartManifestInvalidEntryReason;
    readonly entry: Definition;
  }) => Error
): Effect.Effect<StartManifestValidatedDefinition, Error> => {
  if (!isNonEmptyString(definition.name)) {
    return Effect.fail(
      invalidEntry({
        index,
        reason: "MissingName",
        entry: definition
      })
    );
  }

  const module = normalizeManifestModuleId(definition.module);
  if (!isNonEmptyString(module)) {
    return Effect.fail(
      invalidEntry({
        index,
        reason: "MissingModule",
        entry: definition
      })
    );
  }

  const exportName = definition.exportName ?? "default";
  if (!isNonEmptyString(exportName)) {
    return Effect.fail(
      invalidEntry({
        index,
        reason: "MissingExportName",
        entry: definition
      })
    );
  }

  return Effect.succeed({
    name: definition.name,
    module,
    exportName
  });
};

export const validateManifestEntrySet = <
  Entry extends StartManifestEntryLike,
  Error
>(
  entries: readonly Entry[],
  errors: {
    readonly duplicateName: StartManifestEntrySetErrors<Entry>["duplicateName"];
    readonly duplicateId: StartManifestEntrySetErrors<Entry>["duplicateId"];
    readonly duplicateExport: StartManifestEntrySetErrors<Entry>["duplicateExport"];
  }
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const byName = new Map<string, Entry>();
    const byId = new Map<Entry["id"], Entry>();
    const byServerExport = new Map<string, Entry>();

    for (const entry of entries) {
      const existingName = byName.get(entry.name);
      if (existingName) {
        return yield* Effect.fail(errors.duplicateName({
          name: entry.name,
          firstModule: existingName.server.module,
          secondModule: entry.server.module
        }) as Error);
      }
      byName.set(entry.name, entry);

      const existingId = byId.get(entry.id);
      if (existingId) {
        return yield* Effect.fail(errors.duplicateId({
          id: entry.id,
          firstName: existingId.name,
          secondName: entry.name
        }) as Error);
      }
      byId.set(entry.id, entry);

      const exportKey = `${entry.server.module}#${entry.server.exportName}`;
      const existingExport = byServerExport.get(exportKey);
      if (existingExport) {
        return yield* Effect.fail(errors.duplicateExport({
          module: entry.server.module,
          exportName: entry.server.exportName,
          firstName: existingExport.name,
          secondName: entry.name
        }) as Error);
      }
      byServerExport.set(exportKey, entry);
    }
  });

export const assembleCallableManifestEntry = <
  Definition extends StartCallableManifestDefinitionLike,
  Id,
  Server,
  Client,
  Entry,
  InvalidEntryError,
  UnsafeClientReferenceError
>(
  definition: Definition,
  options: AssembleCallableManifestEntryOptions<
    Definition,
    Id,
    Server,
    Client,
    Entry,
    InvalidEntryError,
    UnsafeClientReferenceError
  >
): Effect.Effect<Entry, InvalidEntryError | UnsafeClientReferenceError> =>
  Effect.gen(function* () {
    const validated = yield* validateManifestDefinition(
      definition,
      options.index,
      options.invalidEntry
    );
    const id = options.stableId(validated.name);
    const server = options.server({
      definition,
      validated,
      moduleKind: classifyStartManifestModule(validated.module)
    });
    const wire: StartCallableManifestWireContract = {
      inputSchema: definition.inputSchema ?? false,
      outputSchema: definition.outputSchema ?? false,
      errorSchema: definition.errorSchema ?? false
    };

    if (definition.clientModule === undefined) {
      return options.entry({
        definition,
        validated,
        id,
        name: validated.name,
        server,
        client: options.transportClient({
          id,
          name: validated.name,
          transportPath: options.transportPath
        }),
        wire
      });
    }

    const clientModule = normalizeManifestModuleId(definition.clientModule);
    const moduleKind = classifyStartManifestModule(clientModule);
    if (moduleKind === "server-only") {
      return yield* Effect.fail(
        options.unsafeClientReference({
          name: validated.name,
          clientModule
        })
      );
    }

    return options.entry({
      definition,
      validated,
      id,
      name: validated.name,
      server,
      client: options.importClient({
        id,
        name: validated.name,
        transportPath: options.transportPath,
        module: clientModule,
        exportName: definition.clientExportName ?? validated.exportName,
        moduleKind
      }),
      wire
    });
  });

export const parseSerializedStartManifestJson = <Error>(
  serialized: string,
  parseError: (cause: unknown) => Error
): Effect.Effect<unknown, Error> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: parseError
  });

export const decodeSerializedCallableManifestEntry = <Id, Error>(
  value: unknown,
  index: number,
  options: DecodeSerializedCallableManifestEntryOptions<Id, Error>
): Effect.Effect<DecodedSerializedCallableManifestEntry<Id>, Error> => {
  if (!isRecord(value) || !isRecord(value.server) || !isRecord(value.wire) || !isRecord(value.client)) {
    return Effect.fail(
      options.parseError(
        `Expected ${options.recordEntryLabel} ${index} to contain server, client, and wire records.`
      )
    );
  }

  const server = value.server;
  const wire = value.wire;
  const client = value.client;
  if (
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.id) ||
    value.id !== options.stableId(value.name) ||
    !isNonEmptyString(server.module) ||
    !isNonEmptyString(server.exportName) ||
    typeof wire.inputSchema !== "boolean" ||
    typeof wire.outputSchema !== "boolean" ||
    typeof wire.errorSchema !== "boolean"
  ) {
    return Effect.fail(
      options.parseError(
        `${options.messageEntryLabel} ${index} has invalid server or wire fields.`
      )
    );
  }

  if (
    !isNonEmptyString(client.id) ||
    client.id !== value.id ||
    client.name !== value.name ||
    client[options.transportPathField] !== options.transportPath
  ) {
    return Effect.fail(
      options.parseError(
        `${options.messageEntryLabel} ${index} has an invalid client identity.`
      )
    );
  }

  if (
    client._tag !== options.transportClientTag &&
    (client._tag !== "Import" ||
      !isNonEmptyString(client.module) ||
      !isNonEmptyString(client.exportName))
  ) {
    return Effect.fail(
      options.parseError(
        `${options.messageEntryLabel} ${index} has an invalid client reference.`
      )
    );
  }

  const clientModule = client._tag === "Import" && isNonEmptyString(client.module)
    ? client.module
    : undefined;
  const clientExportName = client._tag === "Import" && isNonEmptyString(client.exportName)
    ? client.exportName
    : undefined;

  return Effect.succeed({
    id: options.stableId(value.name),
    name: value.name,
    module: server.module,
    exportName: server.exportName,
    inputSchema: wire.inputSchema,
    outputSchema: wire.outputSchema,
    errorSchema: wire.errorSchema,
    ...(clientModule === undefined ? {} : { clientModule }),
    ...(clientExportName === undefined ? {} : { clientExportName }),
    serverRecord: server,
    clientRecord: client,
    wireRecord: wire
  });
};

export const decodeSerializedCallableManifest = <Definition, Error>(
  value: unknown,
  options: DecodeSerializedCallableManifestOptions<Definition, Error>
): Effect.Effect<
  {
    readonly path: string;
    readonly definitions: readonly Definition[];
  },
  Error
> => {
  const path = isRecord(value) ? value[options.pathField] : undefined;
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(path) ||
    !Array.isArray(value.entries)
  ) {
    return Effect.fail(
      options.parseError(`Expected a version 1 ${options.manifestName} manifest.`)
    );
  }

  return Effect.map(
    Effect.forEach(value.entries, (entry, index) =>
      options.decodeEntry(entry, index, path)
    ),
    (definitions) => ({
      path,
      definitions
    })
  );
};
