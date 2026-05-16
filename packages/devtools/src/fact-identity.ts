import type {
  DevtoolsRequestTrace,
  DevtoolsRequestTraceAction,
  DevtoolsRuntimeEvent,
  DevtoolsSerializationPolicy,
  DevtoolsSnapshot,
  DevtoolsSnapshotAction
} from "./devtools-contract.js";
import { toDevtoolsSerializableFingerprint } from "./serialization.js";

const factIdentitySerializationPolicy = {
  maxDepth: 8,
  maxEntries: 50,
  maxStringLength: 1_000
} satisfies DevtoolsSerializationPolicy;

export const toDevtoolsFactIdentity = (fact: unknown): string =>
  toDevtoolsSerializableFingerprint(fact, factIdentitySerializationPolicy);

export const stableFactFingerprint = (fact: unknown): string | undefined => {
  try {
    return toDevtoolsFactIdentity(fact);
  } catch {
    return undefined;
  }
};

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

/**
 * Normalizes imported snapshot facts whose request traces were captured before
 * trace ids existed.
 *
 * Snapshot request traces and runtime `RequestTrace` events describe the same
 * host request facts but can arrive without ids. This Adapter seeds the next
 * trace sequence from existing ids, assigns ids to imported trace snapshots,
 * and reuses those ids for matching imported runtime events when the request
 * fingerprint matches.
 */
export const normalizeImportedRequestTraceFacts = (
  copied: DevtoolsSnapshot
): {
  readonly snapshot: DevtoolsSnapshot;
  readonly nextRequestTraceSequence: number;
} => {
  const normalized = normalizeRequestTraceFacts(copied.requestTraces ?? [], copied.events ?? []);

  return {
    snapshot: {
      ...copied,
      ...(copied.requestTraces === undefined ? {} : { requestTraces: normalized.requestTraces }),
      ...(copied.events === undefined ? {} : { events: normalized.events })
    },
    nextRequestTraceSequence: normalized.nextRequestTraceSequence
  };
};
