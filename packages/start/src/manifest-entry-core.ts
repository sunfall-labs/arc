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
  typeof value === "object" && value !== null;

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
