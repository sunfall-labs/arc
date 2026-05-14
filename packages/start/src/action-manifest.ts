import type { ActionConcurrency, ActionDefinition } from "@effect-ui/core";
import { Data, Effect, Schema } from "effect";
import {
  classifyStartManifestModule,
  compareManifestEntries,
  isNonEmptyString,
  isRecord,
  isStartManifestServerOnlyModule,
  normalizeManifestModuleId,
  stableManifestEntryId,
  validateManifestDefinition,
  validateManifestEntrySet,
  type StartManifestModuleKind
} from "./manifest-entry-core.js";
import { serverActionPath } from "./rpc.js";

export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
export type ActionId = typeof ActionId.Type;

export type ActionModuleKind = StartManifestModuleKind;

export interface ActionManifestDefinition {
  readonly name: string;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
  readonly inputSchema?: boolean;
  readonly outputSchema?: boolean;
  readonly errorSchema?: boolean;
  readonly invalidates?: boolean;
  readonly optimistic?: boolean;
  readonly retry?: boolean;
  readonly concurrency?: ActionConcurrency;
}

type AnyActionDefinition = ActionDefinition<any, any, any, any>;

export interface ActionManifestSource {
  readonly action: AnyActionDefinition;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
}

export interface ActionManifestOptions {
  readonly actionPath?: string;
}

export interface ActionWireContract {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

export type ActionBehaviorPresence = "present" | "absent" | "unknown";
export type ActionManifestConcurrency = ActionConcurrency | "unknown";

export interface ActionBehaviorMetadata {
  readonly invalidates: ActionBehaviorPresence;
  readonly optimistic: ActionBehaviorPresence;
  readonly retry: ActionBehaviorPresence;
  readonly concurrency: ActionManifestConcurrency;
}

export interface ActionServerReference {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: ActionModuleKind;
}

export type ActionClientReference =
  | {
      readonly _tag: "Post";
      readonly id: ActionId;
      readonly name: string;
      readonly actionPath: string;
    }
  | {
      readonly _tag: "Import";
      readonly id: ActionId;
      readonly name: string;
      readonly actionPath: string;
      readonly module: string;
      readonly exportName: string;
      readonly moduleKind: Exclude<ActionModuleKind, "server-only">;
    };

export interface ActionManifestEntry {
  readonly id: ActionId;
  readonly name: string;
  readonly server: ActionServerReference;
  readonly client: ActionClientReference;
  readonly wire: ActionWireContract;
  readonly behavior: ActionBehaviorMetadata;
}

export interface ActionManifest {
  readonly version: 1;
  readonly actionPath: string;
  readonly entries: readonly ActionManifestEntry[];
}

export class ActionManifestInvalidEntry extends Data.TaggedError(
  "ActionManifestInvalidEntry"
)<{
  readonly index: number;
  readonly reason: "MissingName" | "MissingModule" | "MissingExportName";
  readonly entry: unknown;
}> {}

export class ActionManifestDuplicateName extends Data.TaggedError(
  "ActionManifestDuplicateName"
)<{
  readonly name: string;
  readonly firstModule: string;
  readonly secondModule: string;
}> {}

export class ActionManifestDuplicateExport extends Data.TaggedError(
  "ActionManifestDuplicateExport"
)<{
  readonly module: string;
  readonly exportName: string;
  readonly firstName: string;
  readonly secondName: string;
}> {}

export class ActionManifestDuplicateId extends Data.TaggedError(
  "ActionManifestDuplicateId"
)<{
  readonly id: ActionId;
  readonly firstName: string;
  readonly secondName: string;
}> {}

export class ActionManifestUnsafeClientReference extends Data.TaggedError(
  "ActionManifestUnsafeClientReference"
)<{
  readonly name: string;
  readonly clientModule: string;
}> {}

export class ActionManifestParseError extends Data.TaggedError(
  "ActionManifestParseError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ActionManifestError =
  | ActionManifestInvalidEntry
  | ActionManifestDuplicateName
  | ActionManifestDuplicateExport
  | ActionManifestDuplicateId
  | ActionManifestUnsafeClientReference;

const compareEntries = (
  left: ActionManifestEntry,
  right: ActionManifestEntry
): number => compareManifestEntries(left, right);

export const stableActionId = (name: string): ActionId =>
  Schema.decodeUnknownSync(ActionId)(stableManifestEntryId("act", "action", name));

export const actionManifestDefinition = (
  action: AnyActionDefinition,
  source: Omit<ActionManifestSource, "action">
): ActionManifestDefinition => {
  const behavior = {
    invalidates: action.invalidates !== undefined,
    optimistic: action.optimistic !== undefined,
    retry: action.policy?.retry !== undefined,
    concurrency: action.policy?.concurrency ?? "latest"
  } satisfies Pick<
    ActionManifestDefinition,
    "invalidates" | "optimistic" | "retry" | "concurrency"
  >;
  const base =
    source.exportName === undefined
      ? {
          name: action.name,
          module: source.module,
          inputSchema: Schema.isSchema(action.input),
          outputSchema: Schema.isSchema(action.output),
          errorSchema: Schema.isSchema(action.error),
          ...behavior
        }
      : {
          name: action.name,
          module: source.module,
          exportName: source.exportName,
          inputSchema: Schema.isSchema(action.input),
          outputSchema: Schema.isSchema(action.output),
          errorSchema: Schema.isSchema(action.error),
          ...behavior
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

const validateDefinition = (
  definition: ActionManifestDefinition,
  index: number
): Effect.Effect<
  {
    readonly name: string;
    readonly module: string;
    readonly exportName: string;
  },
  ActionManifestInvalidEntry
> =>
  validateManifestDefinition(definition, index, (input) =>
    new ActionManifestInvalidEntry(input)
  );

const sortActionEntries = (
  entries: readonly ActionManifestEntry[]
): readonly ActionManifestEntry[] => [...entries].sort(compareEntries);

const behaviorPresence = (value: boolean | undefined): ActionBehaviorPresence =>
  value === undefined ? "unknown" : value ? "present" : "absent";

const behaviorFromDefinition = (
  definition: ActionManifestDefinition
): ActionBehaviorMetadata => ({
  invalidates: behaviorPresence(definition.invalidates),
  optimistic: behaviorPresence(definition.optimistic),
  retry: behaviorPresence(definition.retry),
  concurrency: definition.concurrency ?? "unknown"
});

export const makeActionManifestEntry = (
  definition: ActionManifestDefinition,
  options: ActionManifestOptions = {},
  index = 0
): Effect.Effect<
  ActionManifestEntry,
  ActionManifestInvalidEntry | ActionManifestUnsafeClientReference
> =>
  Effect.gen(function* () {
    const validated = yield* validateDefinition(definition, index);
    const id = stableActionId(validated.name);
    const actionPath = options.actionPath ?? serverActionPath;
    const server: ActionServerReference = {
      module: validated.module,
      exportName: validated.exportName,
      moduleKind: classifyStartManifestModule(validated.module)
    };
    const wire: ActionWireContract = {
      inputSchema: definition.inputSchema ?? false,
      outputSchema: definition.outputSchema ?? false,
      errorSchema: definition.errorSchema ?? false
    };
    const behavior = behaviorFromDefinition(definition);

    if (definition.clientModule === undefined) {
      return {
        id,
        name: validated.name,
        server,
        client: {
          _tag: "Post" as const,
          id,
          name: validated.name,
          actionPath
        },
        wire,
        behavior
      };
    }

    const clientModule = normalizeManifestModuleId(definition.clientModule);
    const moduleKind = classifyStartManifestModule(clientModule);
    if (moduleKind === "server-only") {
      return yield* Effect.fail(
        new ActionManifestUnsafeClientReference({
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
        actionPath,
        module: clientModule,
        exportName: definition.clientExportName ?? validated.exportName,
        moduleKind
      },
      wire,
      behavior
    };
  });

export const makeActionManifest = (
  definitions: Iterable<ActionManifestDefinition>,
  options: ActionManifestOptions = {}
): Effect.Effect<ActionManifest, ActionManifestError> =>
  Effect.gen(function* () {
    const entries: ActionManifestEntry[] = [];
    const actionPath = options.actionPath ?? serverActionPath;
    let index = 0;
    for (const definition of definitions) {
      entries.push(yield* makeActionManifestEntry(definition, options, index));
      index++;
    }

    yield* validateManifestEntrySet<ActionManifestEntry, ActionManifestError>(entries, {
      duplicateName: (input) => new ActionManifestDuplicateName(input),
      duplicateId: (input) => new ActionManifestDuplicateId(input),
      duplicateExport: (input) => new ActionManifestDuplicateExport(input)
    });

    return {
      version: 1 as const,
      actionPath,
      entries: sortActionEntries(entries)
    };
  });

export const clientReferencesForActionManifest = (
  manifest: ActionManifest
): readonly ActionClientReference[] => manifest.entries.map((entry) => entry.client);

export const isBrowserSafeActionClientReference = (
  reference: ActionClientReference
): boolean => reference._tag === "Post" || !isStartManifestServerOnlyModule(reference.module);

export const serializeActionManifest = (manifest: ActionManifest): string =>
  JSON.stringify({
    version: 1,
    actionPath: manifest.actionPath,
    entries: sortActionEntries(manifest.entries)
  });

const isBehaviorPresence = (value: unknown): value is ActionBehaviorPresence =>
  value === "present" || value === "absent" || value === "unknown";

const isManifestConcurrency = (value: unknown): value is ActionManifestConcurrency =>
  value === "latest" || value === "parallel" || value === "exhaust" || value === "unknown";

const behaviorPresenceToDefinition = (
  field: ActionBehaviorPresence,
  name: "invalidates" | "optimistic" | "retry"
): Pick<ActionManifestDefinition, typeof name> =>
  field === "unknown" ? {} : { [name]: field === "present" } as Pick<ActionManifestDefinition, typeof name>;

const decodeSerializedBehavior = (
  value: unknown,
  index: number
): Effect.Effect<
  Pick<ActionManifestDefinition, "invalidates" | "optimistic" | "retry" | "concurrency">,
  ActionManifestParseError
> => {
  if (value === undefined) {
    return Effect.succeed({});
  }

  if (
    !isRecord(value) ||
    !isBehaviorPresence(value.invalidates) ||
    !isBehaviorPresence(value.optimistic) ||
    !isBehaviorPresence(value.retry) ||
    !isManifestConcurrency(value.concurrency)
  ) {
    return Effect.fail(
      new ActionManifestParseError({
        message: `Action manifest entry ${index} has invalid behavior metadata.`
      })
    );
  }

  return Effect.succeed({
    ...behaviorPresenceToDefinition(value.invalidates, "invalidates"),
    ...behaviorPresenceToDefinition(value.optimistic, "optimistic"),
    ...behaviorPresenceToDefinition(value.retry, "retry"),
    ...(value.concurrency === "unknown" ? {} : { concurrency: value.concurrency })
  });
};

const decodeSerializedEntry = (
  value: unknown,
  index: number,
  actionPath: string
): Effect.Effect<ActionManifestDefinition, ActionManifestParseError> => {
  if (!isRecord(value) || !isRecord(value.server) || !isRecord(value.wire) || !isRecord(value.client)) {
    return Effect.fail(
      new ActionManifestParseError({
        message: `Expected action manifest entry ${index} to contain server, client, and wire records.`
      })
    );
  }

  const server = value.server;
  const wire = value.wire;
  const client = value.client;

  if (
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.id) ||
    value.id !== stableActionId(value.name) ||
    !isNonEmptyString(server.module) ||
    !isNonEmptyString(server.exportName) ||
    typeof wire.inputSchema !== "boolean" ||
    typeof wire.outputSchema !== "boolean" ||
    typeof wire.errorSchema !== "boolean"
  ) {
    return Effect.fail(
      new ActionManifestParseError({
        message: `Action manifest entry ${index} has invalid server or wire fields.`
      })
    );
  }

  if (
    !isNonEmptyString(client.id) ||
    client.id !== value.id ||
    client.name !== value.name ||
    client.actionPath !== actionPath
  ) {
    return Effect.fail(
      new ActionManifestParseError({
        message: `Action manifest entry ${index} has an invalid client identity.`
      })
    );
  }

  if (
    client._tag !== "Post" &&
    (client._tag !== "Import" ||
      !isNonEmptyString(client.module) ||
      !isNonEmptyString(client.exportName))
  ) {
    return Effect.fail(
      new ActionManifestParseError({
        message: `Action manifest entry ${index} has an invalid client reference.`
      })
    );
  }

  const name = value.name;
  const module = server.module;
  const exportName = server.exportName;
  const inputSchema = wire.inputSchema;
  const outputSchema = wire.outputSchema;
  const errorSchema = wire.errorSchema;
  const clientModule = client._tag === "Import" && isNonEmptyString(client.module)
    ? client.module
    : undefined;
  const clientExportName = client._tag === "Import" && isNonEmptyString(client.exportName)
    ? client.exportName
    : undefined;

  return Effect.map(decodeSerializedBehavior(value.behavior, index), (behavior) => {
    const base = {
      name,
      module,
      exportName,
      inputSchema,
      outputSchema,
      errorSchema,
      ...behavior
    };

    if (clientModule === undefined || clientExportName === undefined) {
      return base;
    }

    return {
      ...base,
      clientModule,
      clientExportName
    };
  });
};

const decodeSerializedManifest = (
  value: unknown
): Effect.Effect<
  {
    readonly actionPath: string;
    readonly definitions: readonly ActionManifestDefinition[];
  },
  ActionManifestParseError
> => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyString(value.actionPath) ||
    !Array.isArray(value.entries)
  ) {
    return Effect.fail(
      new ActionManifestParseError({
        message: "Expected a version 1 action manifest."
      })
    );
  }

  const actionPath = value.actionPath;
  return Effect.map(
    Effect.forEach(value.entries, (entry, index) =>
      decodeSerializedEntry(entry, index, actionPath)
    ),
    (definitions) => ({
      actionPath,
      definitions
    })
  );
};

export const deserializeActionManifest = (
  serialized: string,
  options: ActionManifestOptions = {}
): Effect.Effect<ActionManifest, ActionManifestParseError | ActionManifestError> =>
  Effect.try({
    try: () => JSON.parse(serialized) as unknown,
    catch: (cause) =>
      new ActionManifestParseError({
        message: "Action manifest is not valid JSON.",
        cause
      })
  }).pipe(
    Effect.flatMap(decodeSerializedManifest),
    Effect.flatMap(({ definitions, actionPath }) =>
      makeActionManifest(definitions, {
        actionPath: options.actionPath ?? actionPath
      })
    )
  );
