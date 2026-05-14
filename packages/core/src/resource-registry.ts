import type {
  AnyResourceFamily,
  ResourceDiagnostics,
  ResourceFamilyDiagnostics,
  ResourceTagDiagnostics
} from "./resource.js";
import type { ResourceStore as ResourceStoreState } from "./resource-store.js";

/**
 * Duplicate-name handling for the Resource Definition Registry.
 *
 * `replace` preserves the historic Resource facade behaviour where later
 * families or tags with the same name overwrite earlier process-wide entries.
 */
export type ResourceDefinitionDuplicatePolicy = "keep-first" | "replace";

export type ResourceDefinitionRegistryKind = "family" | "tag";

export interface ResourceDefinitionRegistryOptions {
  /** Duplicate-name handling. Defaults to `replace` to preserve existing Resource semantics. */
  readonly duplicates?: ResourceDefinitionDuplicatePolicy;
}

export interface ResourceDefinitionRegistration<Definition = AnyResourceFamily | ResourceTagDiagnostics> {
  readonly kind: ResourceDefinitionRegistryKind;
  readonly name: string;
  readonly definition: Definition;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly retained: Definition;
}

export interface ResourceDefinitionDuplicateDiagnostics {
  readonly kind: ResourceDefinitionRegistryKind;
  readonly name: string;
  readonly policy: ResourceDefinitionDuplicatePolicy;
  readonly retained: number;
  readonly discarded: number;
}

export interface ResourceDefinitionRegistryDefinitions {
  readonly families: ReadonlyMap<string, AnyResourceFamily>;
  readonly tags: ReadonlyMap<string, ResourceTagDiagnostics>;
}

export interface ResourceDefinitionRegistryDiagnostics extends ResourceDiagnostics {
  readonly duplicates: readonly ResourceDefinitionDuplicateDiagnostics[];
}

export interface ResourceDefinitionHydrationLookupOptions {
  readonly store?: Pick<ResourceStoreState, "families">;
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
    inputSchema: family.options.input !== undefined,
    outputSchema: family.options.output !== undefined,
    errorSchema: family.options.error !== undefined,
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

export const defaultResourceDefinitionRegistry = makeResourceDefinitionRegistry();

export const registerResourceDefinition = (
  name: string,
  definition: AnyResourceFamily
): void => {
  defaultResourceDefinitionRegistry.registerFamily(name, definition);
};

export const registerResourceTagDefinition = (
  name: string,
  definition: ResourceTagDiagnostics
): void => {
  defaultResourceDefinitionRegistry.registerTag(name, definition);
};

export const resourceDefinitionRegistry = (): ReadonlyMap<string, AnyResourceFamily> =>
  defaultResourceDefinitionRegistry.definitions().families;

export const resourceTagDefinitionRegistry = (): ReadonlyMap<string, ResourceTagDiagnostics> =>
  defaultResourceDefinitionRegistry.definitions().tags;

export const lookupResourceHydrationFamily = (
  name: string,
  store: ResourceStoreState
): AnyResourceFamily | undefined =>
  defaultResourceDefinitionRegistry.lookupHydrationFamily(name, { store });

export const resourceDiagnostics = (): ResourceDiagnostics => {
  const diagnostics = defaultResourceDefinitionRegistry.diagnostics();
  return {
    families: diagnostics.families,
    tags: diagnostics.tags
  };
};

export const resourceRegistryDiagnostics = (): ResourceDefinitionRegistryDiagnostics =>
  defaultResourceDefinitionRegistry.diagnostics();
