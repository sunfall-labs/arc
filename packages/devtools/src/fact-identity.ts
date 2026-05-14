import type {
  DevtoolsRequestTrace,
  DevtoolsRuntimeEvent,
  DevtoolsSnapshotAction
} from "./index.js";

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

export const rebaseRuntimeEventInvalidations = (
  events: ReadonlyArray<DevtoolsRuntimeEvent> | undefined,
  dropped: number
): ReadonlyArray<DevtoolsRuntimeEvent> | undefined =>
  events?.map((event) => {
    if (event._tag !== "ActionState") {
      return event;
    }

    const invalidationIndexes = rebaseInvalidationIndexes(event.invalidationIndexes, dropped);
    if (invalidationIndexes === event.invalidationIndexes) {
      return event;
    }

    const { invalidationIndexes: _dropped, ...rest } = event;
    return invalidationIndexes === undefined
      ? rest
      : { ...rest, invalidationIndexes };
  });

export const ensureRequestTraceId = (
  trace: DevtoolsRequestTrace,
  fallbackId: string
): DevtoolsRequestTrace =>
  trace.request.id === undefined
    ? {
        ...trace,
        request: {
          ...trace.request,
          id: fallbackId
        }
      }
    : trace;
