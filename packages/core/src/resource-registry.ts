import { Schema } from "effect";
import type {
  AnyResourceFamily,
  ResourceDiagnostics,
  ResourceFamilyDiagnostics,
  ResourceTagDiagnostics
} from "./resource.js";
import type { MutableResourceStore } from "./resource-store.js";

/**
 * Duplicate-name handling for the Resource Definition Registry.
 *
 * `replace` preserves the historic Resource facade behaviour where later
 * families or tags with the same name overwrite earlier process-wide entries.
 */
export type ResourceDefinitionDuplicatePolicy = "keep-first" | "replace";

/** Kind of Resource definition stored in the Resource Definition Registry. */
export type ResourceDefinitionRegistryKind = "family" | "tag";

/** Options for creating a Resource Definition Registry Adapter. */
export interface ResourceDefinitionRegistryOptions {
  /** Duplicate-name handling. Defaults to `replace` to preserve existing Resource semantics. */
  readonly duplicates?: ResourceDefinitionDuplicatePolicy;
}

/** Result of registering one Resource family or tag definition. */
export interface ResourceDefinitionRegistration<Definition = AnyResourceFamily | ResourceTagDiagnostics> {
  readonly kind: ResourceDefinitionRegistryKind;
  readonly name: string;
  readonly definition: Definition;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly retained: Definition;
}

/** Diagnostic entry recorded when duplicate Resource definitions are encountered. */
export interface ResourceDefinitionDuplicateDiagnostics {
  readonly kind: ResourceDefinitionRegistryKind;
  readonly name: string;
  readonly policy: ResourceDefinitionDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

/** Snapshot of registered Resource families and tag definitions. */
export interface ResourceDefinitionRegistryDefinitions {
  readonly families: ReadonlyMap<string, AnyResourceFamily>;
  readonly tags: ReadonlyMap<string, ResourceTagDiagnostics>;
}

/** Resource diagnostics plus duplicate registration facts. */
export interface ResourceDefinitionRegistryDiagnostics extends ResourceDiagnostics {
  readonly duplicates: readonly ResourceDefinitionDuplicateDiagnostics[];
}

/** Options for resolving hydration snapshots to active or registered families. */
export interface ResourceDefinitionHydrationLookupOptions {
  readonly store?: Pick<MutableResourceStore, "families">;
}

/**
 * Registry adapter used by Resource factories, diagnostics, and hydration.
 *
 * Hydration lookup checks the active Resource Store first, then the retained
 * process-wide definitions, matching existing runtime/request locality rules.
 */
export interface ResourceDefinitionRegistryAdapter {
  registerFamily(name: string, definition: AnyResourceFamily): ResourceDefinitionRegistration<AnyResourceFamily>;
  registerTag(name: string, definition: ResourceTagDiagnostics): ResourceDefinitionRegistration<ResourceTagDiagnostics>;
  definitions(): ResourceDefinitionRegistryDefinitions;
  lookupHydrationFamily(name: string, options?: ResourceDefinitionHydrationLookupOptions): AnyResourceFamily | undefined;
  diagnostics(): ResourceDefinitionRegistryDiagnostics;
}

interface ResourceDefinitionRegistryEntry<Definition> {
  readonly definition: Definition;
  readonly sequence: number;
}

const resourceFamilyDiagnostics = (
  family: AnyResourceFamily
): ResourceFamilyDiagnostics => {
  const policy = family.options.policy;
  return {
    name: family.options.name,
    inputSchema: Schema.isSchema(family.options.input),
    outputSchema: Schema.isSchema(family.options.output),
    errorSchema: Schema.isSchema(family.options.error),
    providesTags: family.options.provides !== undefined,
    policy: {
      ...(policy?.staleFor === undefined ? {} : { staleFor: policy.staleFor }),
      ...(policy?.gcFor === undefined ? {} : { gcFor: policy.gcFor }),
      retry: policy?.retry !== undefined
    }
  };
};

const makeRegistration = <Definition>(
  kind: ResourceDefinitionRegistryKind,
  name: string,
  definitions: Map<string, Definition>,
  entries: Map<string, ResourceDefinitionRegistryEntry<Definition>>,
  duplicates: Array<ResourceDefinitionDuplicateDiagnostics>,
  duplicatePolicy: ResourceDefinitionDuplicatePolicy,
  nextSequence: () => number,
  definition: Definition
): ResourceDefinitionRegistration<Definition> => {
  const existing = entries.get(name);

  if (existing?.definition === definition) {
    return {
      kind,
      name,
      definition,
      sequence: existing.sequence,
      duplicate: false,
      retained: definition
    };
  }

  const sequence = nextSequence();
  if (existing === undefined) {
    definitions.set(name, definition);
    entries.set(name, { definition, sequence });
    return {
      kind,
      name,
      definition,
      sequence,
      duplicate: false,
      retained: definition
    };
  }

  if (duplicatePolicy === "replace") {
    definitions.set(name, definition);
    entries.set(name, { definition, sequence });
    duplicates.push({
      kind,
      name,
      policy: duplicatePolicy,
      retained: sequence,
      discarded: existing.sequence
    });
    return {
      kind,
      name,
      definition,
      sequence,
      duplicate: true,
      retained: definition
    };
  }

  duplicates.push({
    kind,
    name,
    policy: duplicatePolicy,
    retained: existing.sequence,
    discarded: sequence
  });
  return {
    kind,
    name,
    definition,
    sequence,
    duplicate: true,
    retained: existing.definition
  };
};

/** Creates a mutable Resource Definition Registry Adapter. */
export const makeResourceDefinitionRegistry = (
  options: ResourceDefinitionRegistryOptions = {}
): ResourceDefinitionRegistryAdapter => {
  const duplicatePolicy = options.duplicates ?? "replace";
  const families = new Map<string, AnyResourceFamily>();
  const familyEntries = new Map<string, ResourceDefinitionRegistryEntry<AnyResourceFamily>>();
  const tags = new Map<string, ResourceTagDiagnostics>();
  const tagEntries = new Map<string, ResourceDefinitionRegistryEntry<ResourceTagDiagnostics>>();
  const duplicates: Array<ResourceDefinitionDuplicateDiagnostics> = [];
  let nextSequenceValue = 1;
  const nextSequence = (): number => nextSequenceValue++;

  return {
    registerFamily: (name, definition) =>
      makeRegistration(
        "family",
        name,
        families,
        familyEntries,
        duplicates,
        duplicatePolicy,
        nextSequence,
        definition
      ),
    registerTag: (name, definition) =>
      makeRegistration(
        "tag",
        name,
        tags,
        tagEntries,
        duplicates,
        duplicatePolicy,
        nextSequence,
        definition
      ),
    definitions: () => ({
      families,
      tags
    }),
    lookupHydrationFamily: (name, options) =>
      options?.store?.families.get(name) as AnyResourceFamily | undefined ??
      families.get(name),
    diagnostics: () => ({
      families: Array.from(families.values(), resourceFamilyDiagnostics)
        .sort((left, right) => left.name.localeCompare(right.name)),
      tags: Array.from(tags.values())
        .sort((left, right) => left.name.localeCompare(right.name)),
      duplicates: duplicates
        .slice()
        .sort((left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.name.localeCompare(right.name) ||
          left.discarded - right.discarded
        )
    })
  };
};

/** Process-wide Resource Definition Registry used by Resource factories. */
export const defaultResourceDefinitionRegistry = makeResourceDefinitionRegistry();

/** Registers a Resource family in the process-wide registry. */
export const registerResourceDefinition = (
  name: string,
  definition: AnyResourceFamily
): void => {
  defaultResourceDefinitionRegistry.registerFamily(name, definition);
};

/** Registers a Resource tag definition in the process-wide registry. */
export const registerResourceTagDefinition = (
  name: string,
  definition: ResourceTagDiagnostics
): void => {
  defaultResourceDefinitionRegistry.registerTag(name, definition);
};

/** Process-wide Resource family definitions keyed by family name. */
export const resourceDefinitionRegistry = (): ReadonlyMap<string, AnyResourceFamily> =>
  defaultResourceDefinitionRegistry.definitions().families;

/** Process-wide Resource tag definitions keyed by tag name. */
export const resourceTagDefinitionRegistry = (): ReadonlyMap<string, ResourceTagDiagnostics> =>
  defaultResourceDefinitionRegistry.definitions().tags;

/** Resolves a Resource hydration family, preferring the active Resource Store. */
export const lookupResourceHydrationFamily = (
  name: string,
  store: MutableResourceStore
): AnyResourceFamily | undefined =>
  defaultResourceDefinitionRegistry.lookupHydrationFamily(name, { store });

/** Returns process-wide Resource family/tag diagnostics. */
export const resourceDiagnostics = (): ResourceDiagnostics => {
  const diagnostics = defaultResourceDefinitionRegistry.diagnostics();
  return {
    families: diagnostics.families,
    tags: diagnostics.tags
  };
};

/** Returns Resource diagnostics including duplicate registration facts. */
export const resourceRegistryDiagnostics = (): ResourceDefinitionRegistryDiagnostics =>
  defaultResourceDefinitionRegistry.diagnostics();
