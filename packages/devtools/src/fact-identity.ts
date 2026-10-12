import type {
  DevtoolsRuntimeEvent,
  DevtoolsSerializationPolicy,
  DevtoolsSnapshotAction,
} from "./devtools-contract.js";
import { toDevtoolsSerializableFingerprint } from "./serialization.js";

const factIdentitySerializationPolicy = {
  maxDepth: 8,
  maxEntries: 50,
  maxStringLength: 1_000,
} satisfies DevtoolsSerializationPolicy;

/**
 * Converts a Devtools fact into the bounded fingerprint used for internal fact
 * identity repair.
 *
 * The fingerprint deliberately goes through the Devtools Serialization Policy
 * so Store, Summary, and causal graph code agree on how deep, wide, and long a
 * comparable inspection value may be.
 */
export const toDevtoolsFactIdentity = (fact: unknown): string =>
  toDevtoolsSerializableFingerprint(fact, factIdentitySerializationPolicy);

/**
 * Attempts to fingerprint a Devtools fact without letting hostile inspection
 * values or trap-shaped inputs break snapshot repair.
 */
export const stableFactFingerprint = (fact: unknown): string | undefined => {
  try {
    return toDevtoolsFactIdentity(fact);
  } catch {
    return undefined;
  }
};

/**
 * Builds first-seen indexes for facts using the shared Devtools identity policy.
 *
 * Duplicate facts intentionally point at their first retained occurrence so
 * bounded history trimming cannot retarget runtime events to later duplicates.
 */
export const firstDevtoolsFactIndexes = <Fact>(
  facts: ReadonlyArray<Fact>,
): ReadonlyMap<string, number> => {
  const indexes = new Map<string, number>();
  facts.forEach((fact, index) => {
    const fingerprint = stableFactFingerprint(fact);
    if (fingerprint !== undefined && !indexes.has(fingerprint)) {
      indexes.set(fingerprint, index);
    }
  });
  return indexes;
};

/**
 * Looks up a fact index from a precomputed Devtools fact index map.
 *
 * Use this when many runtime events need to target the same retained fact
 * arrays; it keeps the fingerprint policy shared while avoiding repeated scans.
 */
export const matchingDevtoolsFactIndex = <Fact>(
  indexes: ReadonlyMap<string, number>,
  fact: Fact,
): number | undefined => {
  const fingerprint = stableFactFingerprint(fact);
  return fingerprint === undefined ? undefined : indexes.get(fingerprint);
};

/**
 * Finds the first matching fact index in a fact array.
 *
 * This is the convenience form for Store call sites that perform occasional
 * record-time deduplication and do not already own a precomputed index map.
 */
export const findMatchingDevtoolsFactIndex = <Fact>(
  facts: ReadonlyArray<Fact>,
  fact: Fact,
): number | undefined => matchingDevtoolsFactIndex(firstDevtoolsFactIndexes(facts), fact);

export const rebaseInvalidationIndexes = (
  indexes: ReadonlyArray<number> | undefined,
  dropped: number,
): ReadonlyArray<number> | undefined => {
  if (indexes === undefined) {
    return undefined;
  }

  const rebased = indexes.map((index) => index - dropped).filter((index) => index >= 0);

  return rebased.length === 0 ? undefined : rebased;
};

export const rebaseSnapshotActionInvalidations = (
  actions: ReadonlyArray<DevtoolsSnapshotAction>,
  dropped: number,
): ReadonlyArray<DevtoolsSnapshotAction> =>
  actions.map((action) => {
    const invalidationIndexes = rebaseInvalidationIndexes(action.invalidationIndexes, dropped);
    if (invalidationIndexes === action.invalidationIndexes) {
      return action;
    }

    const { invalidationIndexes: _dropped, ...rest } = action;
    return invalidationIndexes === undefined ? rest : { ...rest, invalidationIndexes };
  });

export const rebaseFactIndex = (index: number | undefined, dropped: number): number | undefined => {
  if (index === undefined) {
    return undefined;
  }

  const rebased = index - dropped;
  return rebased >= 0 ? rebased : undefined;
};

export const rebaseRuntimeEventInvalidations = (
  events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  dropped: number,
): ReadonlyArray<DevtoolsRuntimeEvent> | undefined =>
  events?.map((event) => {
    if (event._tag === "ActionState") {
      const invalidationIndexes = rebaseInvalidationIndexes(event.invalidationIndexes, dropped);
      if (invalidationIndexes === event.invalidationIndexes) {
        return event;
      }

      const { invalidationIndexes: _dropped, ...rest } = event;
      return invalidationIndexes === undefined ? rest : { ...rest, invalidationIndexes };
    }

    if (event._tag !== "Invalidation") {
      return event;
    }

    const invalidationIndex = rebaseFactIndex(event.invalidationIndex, dropped);
    if (invalidationIndex === event.invalidationIndex) {
      return event;
    }

    const { invalidationIndex: _dropped, ...rest } = event;
    return invalidationIndex === undefined ? rest : { ...rest, invalidationIndex };
  });

export const rebaseRuntimeEventRoutePlans = (
  events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  dropped: number,
): ReadonlyArray<DevtoolsRuntimeEvent> | undefined =>
  events?.map((event) => {
    if (event._tag !== "RoutePlan") {
      return event;
    }

    const routePlanIndex = rebaseFactIndex(event.routePlanIndex, dropped);
    if (routePlanIndex === event.routePlanIndex) {
      return event;
    }

    const { routePlanIndex: _dropped, ...rest } = event;
    return routePlanIndex === undefined ? rest : { ...rest, routePlanIndex };
  });
