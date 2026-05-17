import type { ActionConcurrency, ActionDefinition } from "@sunfall/arc-core";
import { Data, Effect, Schema } from "effect";
import {
  assembleCallableManifestEntry,
  compareManifestEntries,
  decodeSerializedCallableManifest,
  decodeSerializedCallableManifestEntry,
  isRecord,
  isStartManifestServerOnlyModule,
  parseSerializedStartManifestJson,
  stableManifestEntryId,
  validateManifestEndpointPathEffect,
  validateManifestEntrySet,
  type StartManifestEndpointPathErrorInput,
  type StartManifestModuleKind,
} from "./manifest-entry-core.js";
import { defaultStartTransportEndpoints } from "./start-transport-endpoints.js";

/** Branded stable id for one Start action manifest entry. */
export const ActionId = Schema.String.pipe(Schema.brand("ActionId"));
/** Branded stable id for one Start action manifest entry. */
export type ActionId = typeof ActionId.Type;

/**
 * Manifest module classification for action references.
 *
 * `server-only` actions may only be imported on the server, while `contract`
 * and `shared` modules are safe for generated client references.
 */
export type ActionModuleKind = StartManifestModuleKind;

/**
 * Raw action definition before validation and id generation.
 *
 * Build tools create this shape from registered actions, then normalize it into
 * an `ActionManifestEntry` for virtual modules and diagnostics.
 */
export interface ActionManifestDefinition {
  /** Stable action name used on the action transport wire. */
  readonly name: string;
  /** Server module that owns the action implementation or contract. */
  readonly module: string;
  /** Export name in the server module. */
  readonly exportName?: string;
  /** Optional client-safe module for direct import client references. */
  readonly clientModule?: string;
  /** Export name in `clientModule`; defaults to the server export name. */
  readonly clientExportName?: string;
  /** Whether the input wire path should apply an Effect Schema. */
  readonly inputSchema?: boolean;
  /** Whether the output wire path should apply an Effect Schema. */
  readonly outputSchema?: boolean;
  /** Whether the error wire path should apply an Effect Schema. */
  readonly errorSchema?: boolean;
  /** Whether the action declares invalidation behavior. */
  readonly invalidates?: boolean;
  /** Whether the action declares optimistic behavior. */
  readonly optimistic?: boolean;
  /** Whether the action policy includes retry behavior. */
  readonly retry?: boolean;
  /** Action concurrency policy captured for diagnostics and clients. */
  readonly concurrency?: ActionConcurrency;
}

type AnyActionDefinition = ActionDefinition<any, any, any, any>;

/** Registered action plus module metadata discovered by build tools. */
export interface ActionManifestSource {
  readonly action: AnyActionDefinition;
  readonly module: string;
  readonly exportName?: string;
  readonly clientModule?: string;
  readonly clientExportName?: string;
}

/** Options that control action manifest endpoint generation and decoding. */
export interface ActionManifestOptions {
  /** Action endpoint path used by generated POST client references. */
  readonly actionPath?: string;
}

/** Schema presence flags that describe the action wire contract. */
export interface ActionWireContract {
  readonly inputSchema: boolean;
  readonly outputSchema: boolean;
  readonly errorSchema: boolean;
}

/** Tri-state flag used when behavior is present, absent, or unknown in raw artifacts. */
export type ActionBehaviorPresence = "present" | "absent" | "unknown";
/** Captured action concurrency policy, or `unknown` for untrusted raw artifacts. */
export type ActionManifestConcurrency = ActionConcurrency | "unknown";

/** Behavior metadata exposed for action diagnostics and generated clients. */
export interface ActionBehaviorMetadata {
  readonly invalidates: ActionBehaviorPresence;
  readonly optimistic: ActionBehaviorPresence;
  readonly retry: ActionBehaviorPresence;
  readonly concurrency: ActionManifestConcurrency;
}

/** Server-side module/export metadata for invoking an action. */
export interface ActionServerReference {
  readonly module: string;
  readonly exportName: string;
  readonly moduleKind: ActionModuleKind;
}

/**
 * Client-side reference strategy for a Start action.
 *
 * `Post` means submit through the action endpoint. `Import` means a client-safe
 * module can be imported directly while retaining the POST path for progressive
 * forms and transport fallback.
 */
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

/** Fully validated action manifest entry. */
export interface ActionManifestEntry {
  readonly id: ActionId;
  readonly name: string;
  readonly server: ActionServerReference;
  readonly client: ActionClientReference;
  readonly wire: ActionWireContract;
  readonly behavior: ActionBehaviorMetadata;
}

/** Complete action manifest consumed by virtual modules and action clients. */
export interface ActionManifest {
  readonly version: 1;
  readonly actionPath: string;
  readonly entries: readonly ActionManifestEntry[];
}

/** Validation error for a raw action manifest definition with missing identity fields. */
export class ActionManifestInvalidEntry extends Data.TaggedError("ActionManifestInvalidEntry")<{
  readonly index: number;
  readonly reason: "MissingName" | "MissingModule" | "MissingExportName";
  readonly entry: unknown;
}> {}

/** Error raised when two action definitions use the same public action name. */
export class ActionManifestDuplicateName extends Data.TaggedError("ActionManifestDuplicateName")<{
  readonly name: string;
  readonly firstModule: string;
  readonly secondModule: string;
}> {}

/** Error raised when two action definitions point at the same module export. */
export class ActionManifestDuplicateExport extends Data.TaggedError(
  "ActionManifestDuplicateExport",
)<{
  readonly module: string;
  readonly exportName: string;
  readonly firstName: string;
  readonly secondName: string;
}> {}

/** Error raised when two action names produce the same stable generated id. */
export class ActionManifestDuplicateId extends Data.TaggedError("ActionManifestDuplicateId")<{
  readonly id: ActionId;
  readonly firstName: string;
  readonly secondName: string;
}> {}

/** Error raised when an action declares a browser import from a server-only module. */
export class ActionManifestUnsafeClientReference extends Data.TaggedError(
  "ActionManifestUnsafeClientReference",
)<{
  readonly name: string;
  readonly clientModule: string;
}> {}

/** Error raised when the action transport endpoint is not an origin-form path. */
export class ActionManifestInvalidEndpointPath extends Data.TaggedError(
  "ActionManifestInvalidEndpointPath",
)<{
  readonly field: "actionPath";
  readonly value: unknown;
  readonly reason: StartManifestEndpointPathErrorInput["reason"];
  readonly guidance: string;
}> {}

/** Error raised while decoding a serialized action manifest artifact. */
export class ActionManifestParseError extends Data.TaggedError("ActionManifestParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** All validation errors that can occur while building an action manifest. */
export type ActionManifestError =
  | ActionManifestInvalidEntry
  | ActionManifestDuplicateName
  | ActionManifestDuplicateExport
  | ActionManifestDuplicateId
  | ActionManifestUnsafeClientReference
  | ActionManifestInvalidEndpointPath;

const compareEntries = (left: ActionManifestEntry, right: ActionManifestEntry): number =>
  compareManifestEntries(left, right);

/** Build the deterministic branded id used for one action manifest entry. */
export const stableActionId = (name: string): ActionId =>
  Schema.decodeUnknownSync(ActionId)(stableManifestEntryId("act", "action", name));

/** Convert a registered Action plus module metadata into a raw manifest definition. */
export const actionManifestDefinition = (
  action: AnyActionDefinition,
  source: Omit<ActionManifestSource, "action">,
): ActionManifestDefinition => {
  const behavior = {
    invalidates: action.invalidates !== undefined,
    optimistic: action.optimistic !== undefined,
    retry: action.policy?.retry !== undefined,
    concurrency: action.policy?.concurrency ?? "latest",
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
          ...behavior,
        }
      : {
          name: action.name,
          module: source.module,
          exportName: source.exportName,
          inputSchema: Schema.isSchema(action.input),
          outputSchema: Schema.isSchema(action.output),
          errorSchema: Schema.isSchema(action.error),
          ...behavior,
        };

  if (source.clientModule === undefined) {
    return base;
  }

  return source.clientExportName === undefined
    ? {
        ...base,
        clientModule: source.clientModule,
      }
    : {
        ...base,
        clientModule: source.clientModule,
        clientExportName: source.clientExportName,
      };
};

const sortActionEntries = (
  entries: readonly ActionManifestEntry[],
): readonly ActionManifestEntry[] => [...entries].sort(compareEntries);

const behaviorPresence = (value: boolean | undefined): ActionBehaviorPresence =>
  value === undefined ? "unknown" : value ? "present" : "absent";

const behaviorFromDefinition = (definition: ActionManifestDefinition): ActionBehaviorMetadata => ({
  invalidates: behaviorPresence(definition.invalidates),
  optimistic: behaviorPresence(definition.optimistic),
  retry: behaviorPresence(definition.retry),
  concurrency: definition.concurrency ?? "unknown",
});

const actionManifestInvalidEndpointPath = (
  input: StartManifestEndpointPathErrorInput,
): ActionManifestInvalidEndpointPath =>
  new ActionManifestInvalidEndpointPath({
    field: "actionPath",
    value: input.value,
    reason: input.reason,
    guidance: input.guidance,
  });

const normalizeActionManifestPathEffect = (
  actionPath: string | undefined,
): Effect.Effect<string, ActionManifestInvalidEndpointPath> =>
  validateManifestEndpointPathEffect(actionPath ?? defaultStartTransportEndpoints.actionPath, {
    field: "actionPath",
    invalidPath: actionManifestInvalidEndpointPath,
  });

/** Validate one raw action definition and convert it into a manifest entry. */
export const makeActionManifestEntry = (
  definition: ActionManifestDefinition,
  options: ActionManifestOptions = {},
  index = 0,
): Effect.Effect<
  ActionManifestEntry,
  | ActionManifestInvalidEntry
  | ActionManifestUnsafeClientReference
  | ActionManifestInvalidEndpointPath
> =>
  Effect.flatMap(normalizeActionManifestPathEffect(options.actionPath), (actionPath) =>
    assembleCallableManifestEntry(definition, {
      index,
      transportPath: actionPath,
      stableId: stableActionId,
      invalidEntry: (input) => new ActionManifestInvalidEntry(input),
      unsafeClientReference: (input) => new ActionManifestUnsafeClientReference(input),
      server: ({ validated, moduleKind }): ActionServerReference => ({
        module: validated.module,
        exportName: validated.exportName,
        moduleKind,
      }),
      transportClient: ({ id, name, transportPath }): ActionClientReference => ({
        _tag: "Post",
        id,
        name,
        actionPath: transportPath,
      }),
      importClient: ({
        id,
        name,
        transportPath,
        module,
        exportName,
        moduleKind,
      }): ActionClientReference => ({
        _tag: "Import",
        id,
        name,
        actionPath: transportPath,
        module,
        exportName,
        moduleKind,
      }),
      entry: ({ definition, id, name, server, client, wire }): ActionManifestEntry => ({
        id,
        name,
        server,
        client,
        wire,
        behavior: behaviorFromDefinition(definition),
      }),
    }),
  );

/** Build and validate a complete action manifest from raw definitions. */
export const makeActionManifest = (
  definitions: Iterable<ActionManifestDefinition>,
  options: ActionManifestOptions = {},
): Effect.Effect<ActionManifest, ActionManifestError> =>
  Effect.gen(function* () {
    const entries: ActionManifestEntry[] = [];
    const actionPath = yield* normalizeActionManifestPathEffect(options.actionPath);
    let index = 0;
    for (const definition of definitions) {
      entries.push(yield* makeActionManifestEntry(definition, { actionPath }, index));
      index++;
    }

    yield* validateManifestEntrySet<ActionManifestEntry, ActionManifestError>(entries, {
      duplicateName: (input) => new ActionManifestDuplicateName(input),
      duplicateId: (input) => new ActionManifestDuplicateId(input),
      duplicateExport: (input) => new ActionManifestDuplicateExport(input),
    });

    return {
      version: 1 as const,
      actionPath,
      entries: sortActionEntries(entries),
    };
  });

/** Return the client reference entries generated from an action manifest. */
export const clientReferencesForActionManifest = (
  manifest: ActionManifest,
): readonly ActionClientReference[] => manifest.entries.map((entry) => entry.client);

/** Check whether an action client reference can be imported in browser code. */
export const isBrowserSafeActionClientReference = (reference: ActionClientReference): boolean =>
  reference._tag === "Post" || !isStartManifestServerOnlyModule(reference.module);

/** Serialize an action manifest into the virtual-module JSON payload. */
export const serializeActionManifest = (manifest: ActionManifest): string =>
  JSON.stringify({
    version: 1,
    actionPath: manifest.actionPath,
    entries: sortActionEntries(manifest.entries),
  });

const isBehaviorPresence = (value: unknown): value is ActionBehaviorPresence =>
  value === "present" || value === "absent" || value === "unknown";

const isManifestConcurrency = (value: unknown): value is ActionManifestConcurrency =>
  value === "latest" || value === "parallel" || value === "exhaust" || value === "unknown";

const behaviorPresenceToDefinition = (
  field: ActionBehaviorPresence,
  name: "invalidates" | "optimistic" | "retry",
): Pick<ActionManifestDefinition, typeof name> =>
  field === "unknown"
    ? {}
    : ({ [name]: field === "present" } as Pick<ActionManifestDefinition, typeof name>);

const decodeSerializedBehavior = (
  value: unknown,
  index: number,
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
        message: `Action manifest entry ${index} has invalid behavior metadata.`,
      }),
    );
  }

  return Effect.succeed({
    ...behaviorPresenceToDefinition(value.invalidates, "invalidates"),
    ...behaviorPresenceToDefinition(value.optimistic, "optimistic"),
    ...behaviorPresenceToDefinition(value.retry, "retry"),
    ...(value.concurrency === "unknown" ? {} : { concurrency: value.concurrency }),
  });
};

const decodeSerializedEntry = (
  value: unknown,
  index: number,
  actionPath: string,
): Effect.Effect<ActionManifestDefinition, ActionManifestParseError> =>
  Effect.gen(function* () {
    const decoded = yield* decodeSerializedCallableManifestEntry(value, index, {
      transportPath: actionPath,
      transportPathField: "actionPath",
      transportClientTag: "Post",
      stableId: stableActionId,
      recordEntryLabel: "action manifest entry",
      messageEntryLabel: "Action manifest entry",
      parseError: (message) => new ActionManifestParseError({ message }),
    });
    const behavior = yield* decodeSerializedBehavior(
      isRecord(value) ? value.behavior : undefined,
      index,
    );
    const base = {
      name: decoded.name,
      module: decoded.module,
      exportName: decoded.exportName,
      inputSchema: decoded.inputSchema,
      outputSchema: decoded.outputSchema,
      errorSchema: decoded.errorSchema,
      ...behavior,
    };

    if (decoded.clientModule === undefined || decoded.clientExportName === undefined) {
      return base;
    }

    return {
      ...base,
      clientModule: decoded.clientModule,
      clientExportName: decoded.clientExportName,
    };
  });

const decodeSerializedManifest = (
  value: unknown,
): Effect.Effect<
  {
    readonly actionPath: string;
    readonly definitions: readonly ActionManifestDefinition[];
  },
  ActionManifestParseError
> =>
  Effect.map(
    decodeSerializedCallableManifest(value, {
      pathField: "actionPath",
      manifestName: "action",
      parseError: (message) => new ActionManifestParseError({ message }),
      decodeEntry: decodeSerializedEntry,
    }),
    ({ path, definitions }) => ({
      actionPath: path,
      definitions,
    }),
  );

/** Decode and validate a serialized action manifest artifact. */
export const deserializeActionManifest = (
  serialized: string,
  options: ActionManifestOptions = {},
): Effect.Effect<ActionManifest, ActionManifestParseError | ActionManifestError> =>
  parseSerializedStartManifestJson(
    serialized,
    (cause) =>
      new ActionManifestParseError({
        message: "Action manifest is not valid JSON.",
        cause,
      }),
  ).pipe(
    Effect.flatMap(decodeSerializedManifest),
    Effect.flatMap(({ definitions, actionPath }) =>
      makeActionManifest(definitions, {
        actionPath: options.actionPath ?? actionPath,
      }),
    ),
  );
