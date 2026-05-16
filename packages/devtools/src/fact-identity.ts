import type {
  DevtoolsRequestTrace,
  DevtoolsRequestTraceAction,
  DevtoolsRuntimeEvent,
  DevtoolsSerializationPolicy,
  DevtoolsSnapshotAction
} from "./devtools-contract.js";
import { toDevtoolsSerializableFingerprint } from "./serialization.js";

const factIdentitySerializationPolicy = {
  maxDepth: 8,
  maxEntries: 50,
  maxStringLength: 1_000
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
  facts: ReadonlyArray<Fact>
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
  fact: Fact
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
  fact: Fact
): number | undefined =>
  matchingDevtoolsFactIndex(firstDevtoolsFactIndexes(facts), fact);

export const rebaseInvalidationIndexes = (
  indexes: ReadonlyArray<number> | undefined,
  dropped: number
): ReadonlyArray<number> | undefined => {
  if (indexes === undefined) {
    return undefined;
  }

  const rebased = indexes
    .map((index) => index - dropped)
    .filter((index) => index >= 0);

  return rebased.length === 0 ? undefined : rebased;
};

export const rebaseSnapshotActionInvalidations = (
  actions: ReadonlyArray<DevtoolsSnapshotAction>,
  dropped: number
): ReadonlyArray<DevtoolsSnapshotAction> =>
  actions.map((action) => {
    const invalidationIndexes = rebaseInvalidationIndexes(action.invalidationIndexes, dropped);
    if (invalidationIndexes === action.invalidationIndexes) {
      return action;
    }

    const { invalidationIndexes: _dropped, ...rest } = action;
    return invalidationIndexes === undefined
      ? rest
      : { ...rest, invalidationIndexes };
  });

const rebaseRequestTraceActionInvalidations = (
  action: DevtoolsRequestTraceAction,
  dropped: number
): DevtoolsRequestTraceAction => {
  const invalidationIndexes = rebaseInvalidationIndexes(action.invalidationIndexes, dropped);
  if (invalidationIndexes === action.invalidationIndexes) {
    return action;
  }

  const { invalidationIndexes: _dropped, ...rest } = action;
  return invalidationIndexes === undefined
    ? rest
    : { ...rest, invalidationIndexes };
};

export const rebaseRequestTraceInvalidations = (
  traces: ReadonlyArray<DevtoolsRequestTrace> | undefined,
  dropped: number
): ReadonlyArray<DevtoolsRequestTrace> | undefined =>
  traces?.map((trace) => {
    const actions = trace.actions.map((action) => rebaseRequestTraceActionInvalidations(action, dropped));
    const changed = actions.some((action, index) => action !== trace.actions[index]);
    return changed
      ? { ...trace, actions }
      : trace;
  });

export const rebaseFactIndex = (
  index: number | undefined,
  dropped: number
): number | undefined => {
  if (index === undefined) {
    return undefined;
  }

  const rebased = index - dropped;
  return rebased >= 0 ? rebased : undefined;
};

export const rebaseRuntimeEventInvalidations = (
  events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  dropped: number
): ReadonlyArray<DevtoolsRuntimeEvent> | undefined =>
  events?.map((event) => {
    if (event._tag === "ActionState") {
      const invalidationIndexes = rebaseInvalidationIndexes(event.invalidationIndexes, dropped);
      if (invalidationIndexes === event.invalidationIndexes) {
        return event;
      }

      const { invalidationIndexes: _dropped, ...rest } = event;
      return invalidationIndexes === undefined
        ? rest
        : { ...rest, invalidationIndexes };
    }

    if (event._tag !== "Invalidation") {
      if (event._tag === "RequestTrace") {
        const trace = rebaseRequestTraceInvalidations([event.trace], dropped)?.[0] ?? event.trace;
        return trace === event.trace
          ? event
          : { ...event, trace };
      }

      return event;
    }

    const invalidationIndex = rebaseFactIndex(event.invalidationIndex, dropped);
    if (invalidationIndex === event.invalidationIndex) {
      return event;
    }

    const { invalidationIndex: _dropped, ...rest } = event;
    return invalidationIndex === undefined
      ? rest
      : { ...rest, invalidationIndex };
  });

export const rebaseRuntimeEventRoutePlans = (
  events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  dropped: number
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
    return routePlanIndex === undefined
      ? rest
      : { ...rest, routePlanIndex };
  });

export const ensureRequestTraceId = (
  trace: DevtoolsRequestTrace,
  fallbackId: string
): DevtoolsRequestTrace =>
  trace.request.id === undefined
    ? Object.defineProperties({}, {
        ...Object.getOwnPropertyDescriptors(trace),
        request: {
          value: {
            ...trace.request,
            id: fallbackId
          },
          enumerable: true,
          configurable: true,
          writable: true
        }
      }) as DevtoolsRequestTrace
    : trace;

export const requestTraceSequence = (id: string | undefined): number | undefined => {
  if (id === undefined || !id.startsWith("trace:")) {
    return undefined;
  }

  const sequence = Number(id.slice("trace:".length));
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : undefined;
};

const requestTraceFingerprint = (trace: DevtoolsRequestTrace): string =>
  JSON.stringify([
    trace.request.method,
    trace.request.url,
    trace.request.path,
    trace.request.transport
  ]);

const requestTraceIdentityFingerprint = (trace: DevtoolsRequestTrace): string => {
  const { id: _id, ...request } = trace.request;
  const withoutRequestId = Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(trace),
    request: {
      value: request,
      enumerable: true,
      configurable: true,
      writable: true
    }
  });
  return stableFactFingerprint(withoutRequestId) ?? requestTraceFingerprint(trace);
};

interface ImportedRequestTraceId {
  readonly id: string;
  consumed: boolean;
}

const pushImportedRequestTraceId = (
  map: Map<string, Array<ImportedRequestTraceId>>,
  fingerprint: string,
  imported: ImportedRequestTraceId
): void => {
  const ids = map.get(fingerprint);
  if (ids === undefined) {
    map.set(fingerprint, [imported]);
    return;
  }
  ids.push(imported);
};

const consumeImportedRequestTraceId = (
  ids: Array<ImportedRequestTraceId> | undefined
): string | undefined => {
  const imported = ids?.find((id) => !id.consumed);
  if (imported === undefined) {
    return undefined;
  }

  imported.consumed = true;
  return imported.id;
};

/**
 * Normalizes request trace facts that may have been captured before trace ids
 * existed.
 *
 * Snapshot traces receive deterministic fallback ids, matching runtime
 * `RequestTrace` events reuse those ids when their fingerprints line up, and
 * the returned sequence lets the Store allocate later ids without collisions.
 */
export const normalizeRequestTraceFacts = (
  requestTraceInputs: ReadonlyArray<DevtoolsRequestTrace> = [],
  eventInputs: ReadonlyArray<DevtoolsRuntimeEvent> = []
): {
  readonly requestTraces: ReadonlyArray<DevtoolsRequestTrace>;
  readonly events: ReadonlyArray<DevtoolsRuntimeEvent>;
  readonly nextRequestTraceSequence: number;
} => {
  let sequence = 0;
  const importedIdsByTraceFingerprint = new Map<string, Array<ImportedRequestTraceId>>();
  const importedIdsByRequestFingerprint = new Map<string, Array<ImportedRequestTraceId>>();
  const seedSequence = (trace: DevtoolsRequestTrace): void => {
    const traceSequence = requestTraceSequence(trace.request.id);
    if (traceSequence !== undefined) {
      sequence = Math.max(sequence, traceSequence + 1);
    }
  };

  for (const trace of requestTraceInputs) {
    seedSequence(trace);
  }
  for (const event of eventInputs) {
    if (event._tag === "RequestTrace") {
      seedSequence(event.trace);
    }
  }

  const allocateId = (): string => `trace:${sequence++}`;
  const normalizeTrace = (trace: DevtoolsRequestTrace): DevtoolsRequestTrace => {
    if (trace.request.id !== undefined) {
      return trace;
    }

    return ensureRequestTraceId(trace, allocateId());
  };
  const normalizedRequestTraceInputs = requestTraceInputs.map((trace) => {
    const normalized = normalizeTrace(trace);
    const imported = {
      id: normalized.request.id!,
      consumed: false
    };
    pushImportedRequestTraceId(importedIdsByTraceFingerprint, requestTraceIdentityFingerprint(trace), imported);
    pushImportedRequestTraceId(importedIdsByRequestFingerprint, requestTraceFingerprint(trace), imported);
    return normalized;
  });
  const events = eventInputs.map((event) => {
    if (event._tag !== "RequestTrace" || event.trace.request.id !== undefined) {
      return event;
    }

    const importedId =
      consumeImportedRequestTraceId(importedIdsByTraceFingerprint.get(requestTraceIdentityFingerprint(event.trace))) ??
      consumeImportedRequestTraceId(importedIdsByRequestFingerprint.get(requestTraceFingerprint(event.trace)));
    return {
      ...event,
      trace: ensureRequestTraceId(event.trace, importedId ?? allocateId())
    };
  });
  const tracesById = new Map<string, DevtoolsRequestTrace>();
  const appendRequestTrace = (trace: DevtoolsRequestTrace): void => {
    const id = trace.request.id;
    if (id !== undefined && !tracesById.has(id)) {
      tracesById.set(id, trace);
    }
  };

  for (const trace of normalizedRequestTraceInputs) {
    appendRequestTrace(trace);
  }
  for (const event of events) {
    if (event._tag === "RequestTrace") {
      appendRequestTrace(event.trace);
    }
  }

  return {
    requestTraces: Array.from(tracesById.values()),
    events,
    nextRequestTraceSequence: sequence
  };
};
