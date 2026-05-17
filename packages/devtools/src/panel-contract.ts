import { Data } from "effect";
import type { DevtoolsBridgePayload } from "./bridge.js";
import type {
  DevtoolsPanel,
  DevtoolsPanelId,
  DevtoolsPanelItem,
  DevtoolsPanelMetric,
  DevtoolsPanels,
  DevtoolsPanelsInput,
  DevtoolsPanelSeverity,
  DevtoolsPanelUiInput,
  DevtoolsSerializableValue,
} from "./devtools-contract.js";

/** Stable ids for the public Devtools panel contract. */
export const devtoolsPanelIds: readonly DevtoolsPanelId[] = [
  "app-graph",
  "routes",
  "resources",
  "actions",
  "programs",
  "collections",
  "requests",
  "diagnostics",
  "causal-graph",
];

/** Stable severities accepted by Devtools panels and panel items. */
export const devtoolsPanelSeverities: readonly DevtoolsPanelSeverity[] = [
  "ok",
  "info",
  "warning",
  "error",
];

const devtoolsPanelIdSet: ReadonlySet<string> = new Set(devtoolsPanelIds);
const devtoolsPanelSeveritySet: ReadonlySet<string> = new Set(devtoolsPanelSeverities);

/** Stable reason codes for public Devtools panel contract validation failures. */
export type DevtoolsPanelContractErrorReason =
  | "InvalidType"
  | "InvalidVersion"
  | "InvalidPanels"
  | "DuplicatePanel"
  | "MissingPanel"
  | "MalformedPanel"
  | "DuplicatePanelItem"
  | "InvalidBridgePayload";

/** Typed error for malformed public Devtools panel contract payloads. */
export class DevtoolsPanelContractError extends Data.TaggedError("DevtoolsPanelContractError")<{
  readonly reason: DevtoolsPanelContractErrorReason;
  readonly path: string;
  readonly message: string;
  readonly value?: unknown;
}> {}

/** Result of resolving an unknown value as a complete Devtools panel contract. */
export type DevtoolsPanelContractResolution =
  | {
      readonly _tag: "Valid";
      readonly panels: DevtoolsPanels;
    }
  | {
      readonly _tag: "Invalid";
      readonly error: DevtoolsPanelContractError;
      readonly panels: DevtoolsPanels;
    };

/** Result of resolving an inspected-window bridge payload into panel data. */
export type DevtoolsBridgePayloadContractResolution =
  | {
      readonly _tag: "Valid";
      readonly payload: DevtoolsBridgePayload;
    }
  | {
      readonly _tag: "Invalid";
      readonly error: DevtoolsPanelContractError;
      readonly panels: DevtoolsPanels;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const unsafeProperty = Symbol("DevtoolsPanelContract.unsafeProperty");
type UnsafeProperty = typeof unsafeProperty;
const maxPanelArrayEntries = 1_000;
const maxPanelStringLength = 1_000;
const maxSerializableDepth = 16;
const maxSerializableEntries = 1_000;

interface SerializableNormalizationState {
  readonly seen: WeakSet<object>;
  readonly depth: number;
}

interface PanelArrayWindow {
  readonly values: ReadonlyArray<unknown>;
  readonly total: number;
  readonly hidden: number;
}

const readProperty = (value: Record<string, unknown>, key: string): unknown | UnsafeProperty => {
  try {
    return value[key];
  } catch {
    return unsafeProperty;
  }
};

const readArrayValues = (
  value: unknown,
  maxEntries = maxPanelArrayEntries,
): ReadonlyArray<unknown> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxEntries) {
      return undefined;
    }

    const values: Array<unknown> = [];
    for (let index = 0; index < length; index++) {
      values.push(value[index]);
    }
    return values;
  } catch {
    return undefined;
  }
};

const readPanelArrayWindow = (
  value: unknown,
  maxEntries = maxPanelArrayEntries,
): PanelArrayWindow | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) {
      return undefined;
    }

    const windowSize = length > maxEntries ? Math.max(0, maxEntries - 1) : length;
    const values: Array<unknown> = [];
    for (let index = 0; index < windowSize; index++) {
      values.push(value[index]);
    }
    return {
      values,
      total: length,
      hidden: length - windowSize,
    };
  } catch {
    return undefined;
  }
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

/** Returns true when an unknown value is one of the public Devtools panel ids. */
export const isDevtoolsPanelId = (value: unknown): value is DevtoolsPanelId =>
  typeof value === "string" && devtoolsPanelIdSet.has(value);

/** Returns true when an unknown value is a public Devtools panel severity. */
export const isDevtoolsPanelSeverity = (value: unknown): value is DevtoolsPanelSeverity =>
  typeof value === "string" && devtoolsPanelSeveritySet.has(value);

const truncatePanelString = (value: string): string =>
  value.length <= maxPanelStringLength ? value : value.slice(0, maxPanelStringLength);

const normalizePanelString = (value: unknown): string | undefined =>
  typeof value === "string" ? truncatePanelString(value) : undefined;

const isBoundedPanelIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length <= maxPanelStringLength;

const normalizeDevtoolsSerializableValue = (
  value: unknown,
  state: SerializableNormalizationState = { seen: new WeakSet(), depth: 0 },
): DevtoolsSerializableValue | undefined => {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncatePanelString(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (state.depth >= maxSerializableDepth || state.seen.has(value)) {
    return undefined;
  }

  state.seen.add(value);
  try {
    const arrayValues = readArrayValues(value, maxSerializableEntries);
    if (arrayValues !== undefined) {
      const values: Array<DevtoolsSerializableValue> = [];
      for (const item of arrayValues) {
        const normalized = normalizeDevtoolsSerializableValue(item, {
          seen: state.seen,
          depth: state.depth + 1,
        });
        if (normalized === undefined) {
          return undefined;
        }
        values.push(normalized);
      }
      return values;
    }

    if (!isPlainRecord(value)) {
      return undefined;
    }

    let keys: ReadonlyArray<string>;
    try {
      keys = Object.keys(value);
    } catch {
      return undefined;
    }

    if (keys.length > maxSerializableEntries) {
      return undefined;
    }

    const record: Record<string, DevtoolsSerializableValue> = {};
    for (const key of keys) {
      if (key.length > maxPanelStringLength) {
        return undefined;
      }
      const property = readProperty(value, key);
      if (property === unsafeProperty) {
        return undefined;
      }
      const normalized = normalizeDevtoolsSerializableValue(property, {
        seen: state.seen,
        depth: state.depth + 1,
      });
      if (normalized === undefined) {
        return undefined;
      }
      record[key] = normalized;
    }
    return record;
  } finally {
    state.seen.delete(value);
  }
};

/** Runtime guard for JSON-safe Devtools payload values. */
export const isDevtoolsSerializableValue = (value: unknown): value is DevtoolsSerializableValue =>
  normalizeDevtoolsSerializableValue(value) !== undefined;

const normalizeDevtoolsPanelMetric = (value: unknown): DevtoolsPanelMetric | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const label = readProperty(value, "label");
  const metricValue = readProperty(value, "value");
  const unit = readProperty(value, "unit");
  const normalizedLabel = normalizePanelString(label);
  const normalizedMetricValue =
    typeof metricValue === "string"
      ? normalizePanelString(metricValue)
      : typeof metricValue === "number" && Number.isFinite(metricValue)
        ? metricValue
        : undefined;
  const normalizedUnit = unit === undefined ? undefined : normalizePanelString(unit);
  if (
    !(
      label !== unsafeProperty &&
      metricValue !== unsafeProperty &&
      unit !== unsafeProperty &&
      normalizedLabel !== undefined &&
      normalizedMetricValue !== undefined &&
      (unit === undefined || normalizedUnit !== undefined)
    )
  ) {
    return undefined;
  }

  return {
    label: normalizedLabel,
    value: normalizedMetricValue,
    ...(normalizedUnit === undefined ? {} : { unit: normalizedUnit }),
  };
};

/** Runtime guard for one Devtools panel metric. */
export const isDevtoolsPanelMetric = (value: unknown): value is DevtoolsPanelMetric =>
  normalizeDevtoolsPanelMetric(value) !== undefined;

const normalizeDevtoolsPanelItem = (value: unknown): DevtoolsPanelItem | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readProperty(value, "id");
  const label = readProperty(value, "label");
  const severity = readProperty(value, "severity");
  const detail = readProperty(value, "detail");
  const metrics = readProperty(value, "metrics");
  const data = readProperty(value, "data");
  const normalizedLabel = normalizePanelString(label);
  const normalizedDetail = detail === undefined ? undefined : normalizePanelString(detail);
  if (
    !(
      id !== unsafeProperty &&
      label !== unsafeProperty &&
      severity !== unsafeProperty &&
      detail !== unsafeProperty &&
      metrics !== unsafeProperty &&
      data !== unsafeProperty &&
      isBoundedPanelIdentifier(id) &&
      normalizedLabel !== undefined &&
      isDevtoolsPanelSeverity(severity) &&
      (detail === undefined || normalizedDetail !== undefined)
    )
  ) {
    return undefined;
  }

  const normalizedMetrics =
    metrics === undefined ? undefined : readArrayValues(metrics)?.map(normalizeDevtoolsPanelMetric);
  if (metrics !== undefined && normalizedMetrics === undefined) {
    return undefined;
  }
  if (normalizedMetrics?.some((metric) => metric === undefined)) {
    return undefined;
  }

  const normalizedData = data === undefined ? undefined : normalizeDevtoolsSerializableValue(data);
  if (data !== undefined && normalizedData === undefined) {
    return undefined;
  }

  return {
    id,
    label: normalizedLabel,
    severity,
    ...(normalizedDetail === undefined ? {} : { detail: normalizedDetail }),
    ...(normalizedMetrics === undefined
      ? {}
      : { metrics: normalizedMetrics as ReadonlyArray<DevtoolsPanelMetric> }),
    ...(normalizedData === undefined ? {} : { data: normalizedData }),
  };
};

/** Runtime guard for one Devtools panel row. */
export const isDevtoolsPanelItem = (value: unknown): value is DevtoolsPanelItem =>
  normalizeDevtoolsPanelItem(value) !== undefined;

const panelOverflowItemIdPrefix = (panelId: DevtoolsPanelId): string =>
  `__sunfall-arc-devtools-overflow:${panelId}`;

const panelOverflowItemId = (panelId: DevtoolsPanelId, usedIds: ReadonlySet<string>): string => {
  const base = panelOverflowItemIdPrefix(panelId);
  if (!usedIds.has(base)) {
    return base;
  }

  let suffix = 1;
  while (usedIds.has(`${base}:${suffix}`)) {
    suffix += 1;
  }
  return `${base}:${suffix}`;
};

const panelOverflowItem = (
  panelId: DevtoolsPanelId,
  usedIds: ReadonlySet<string>,
  total: number,
  shown: number,
): DevtoolsPanelItem => {
  const hidden = total - shown;
  return {
    id: panelOverflowItemId(panelId, usedIds),
    label: `${hidden} panel items hidden`,
    severity: "info",
    detail: `Panel contract window shows ${shown} of ${total} items.`,
    metrics: [
      { label: "shown", value: shown },
      { label: "hidden", value: hidden },
      { label: "total", value: total },
    ],
    data: {
      total,
      shown,
      hidden,
    },
  };
};

/** Returns true when a panel row is the contract-generated overflow marker. */
export const isDevtoolsPanelOverflowItem = (
  panelId: DevtoolsPanelId,
  item: DevtoolsPanelItem,
): boolean => {
  const prefix = panelOverflowItemIdPrefix(panelId);
  return item.id === prefix || item.id.startsWith(`${prefix}:`);
};

const normalizeDevtoolsPanel = (value: unknown): DevtoolsPanel | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readProperty(value, "id");
  const title = readProperty(value, "title");
  const summary = readProperty(value, "summary");
  const severity = readProperty(value, "severity");
  const metrics = readProperty(value, "metrics");
  const items = readProperty(value, "items");
  const normalizedTitle = normalizePanelString(title);
  const normalizedSummary = normalizePanelString(summary);
  if (
    !(
      id !== unsafeProperty &&
      title !== unsafeProperty &&
      summary !== unsafeProperty &&
      severity !== unsafeProperty &&
      metrics !== unsafeProperty &&
      items !== unsafeProperty &&
      isDevtoolsPanelId(id) &&
      normalizedTitle !== undefined &&
      normalizedSummary !== undefined &&
      isDevtoolsPanelSeverity(severity)
    )
  ) {
    return undefined;
  }

  const itemWindow = readPanelArrayWindow(items);
  if (itemWindow === undefined) {
    return undefined;
  }

  const normalizedMetrics = readArrayValues(metrics)?.map(normalizeDevtoolsPanelMetric);
  const normalizedItems = itemWindow.values.map(normalizeDevtoolsPanelItem);
  if (
    normalizedMetrics === undefined ||
    normalizedMetrics.some((metric) => metric === undefined) ||
    normalizedItems.some((item) => item === undefined)
  ) {
    return undefined;
  }
  const itemIds = new Set<string>();
  for (const item of normalizedItems as ReadonlyArray<DevtoolsPanelItem>) {
    if (itemIds.has(item.id)) {
      return undefined;
    }
    itemIds.add(item.id);
  }
  const panelItems: Array<DevtoolsPanelItem> = [
    ...(normalizedItems as ReadonlyArray<DevtoolsPanelItem>),
  ];
  if (itemWindow.hidden > 0) {
    panelItems.push(panelOverflowItem(id, itemIds, itemWindow.total, panelItems.length));
  }

  return {
    id,
    title: normalizedTitle,
    summary: normalizedSummary,
    severity,
    metrics: normalizedMetrics as ReadonlyArray<DevtoolsPanelMetric>,
    items: panelItems,
  };
};

/** Runtime guard for one ordered Devtools panel. */
export const isDevtoolsPanel = (value: unknown): value is DevtoolsPanel =>
  normalizeDevtoolsPanel(value) !== undefined;

/** Normalizes an unknown value into the complete public Devtools panel model. */
export const normalizeDevtoolsPanels = (value: unknown): DevtoolsPanels | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const version = readProperty(value, "version");
  const panels = readProperty(value, "panels");
  if (!(version !== unsafeProperty && panels !== unsafeProperty && version === 1)) {
    return undefined;
  }

  const normalizedPanels = readArrayValues(panels)?.map(normalizeDevtoolsPanel);
  if (normalizedPanels === undefined || normalizedPanels.some((panel) => panel === undefined)) {
    return undefined;
  }

  const panelById = new Map<DevtoolsPanelId, DevtoolsPanel>();
  for (const panel of normalizedPanels as ReadonlyArray<DevtoolsPanel>) {
    if (panelById.has(panel.id)) {
      return undefined;
    }
    panelById.set(panel.id, panel);
  }

  if (panelById.size !== devtoolsPanelIds.length) {
    return undefined;
  }

  return {
    version: 1,
    panels: devtoolsPanelIds.map((id) => panelById.get(id)!),
  };
};

/** Runtime guard for the complete public Devtools panel model. */
export const isDevtoolsPanels = (value: unknown): value is DevtoolsPanels =>
  normalizeDevtoolsPanels(value) !== undefined;

const contractError = (options: {
  readonly reason: DevtoolsPanelContractErrorReason;
  readonly path: string;
  readonly message: string;
  readonly value?: unknown;
}): DevtoolsPanelContractError => new DevtoolsPanelContractError(options);

const devtoolsPanelContractDiagnosticsPanels = (
  error: DevtoolsPanelContractError,
): DevtoolsPanels => ({
  version: 1,
  panels: devtoolsPanelIds.map(
    (id): DevtoolsPanel =>
      id === "diagnostics"
        ? {
            id,
            title: "Diagnostics",
            summary: "Panel contract error",
            severity: "error",
            metrics: [{ label: "contract", value: "invalid" }],
            items: [
              {
                id: "panel-contract-error",
                label: "Invalid Devtools panel contract",
                severity: "error",
                detail: error.message,
                data: {
                  reason: error.reason,
                  path: error.path,
                  message: error.message,
                },
              },
            ],
          }
        : {
            id,
            title: id
              .split("-")
              .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
              .join(" "),
            summary: "Suppressed while panel contract diagnostics are shown",
            severity: "info",
            metrics: [],
            items: [],
          },
  ),
});

const diagnosePanelItemIds = (
  panel: Record<string, unknown>,
  panelIndex: number,
): DevtoolsPanelContractError | undefined => {
  const panelId = readProperty(panel, "id");
  const items = readProperty(panel, "items");
  const itemValues = readArrayValues(items);
  if (itemValues === undefined) {
    return undefined;
  }

  const ids = new Set<string>();
  for (let index = 0; index < itemValues.length; index++) {
    const item = itemValues[index];
    if (!isRecord(item)) {
      continue;
    }
    const itemId = readProperty(item, "id");
    if (typeof itemId !== "string") {
      continue;
    }
    if (ids.has(itemId)) {
      return contractError({
        reason: "DuplicatePanelItem",
        path: `panels[${panelIndex}].items[${index}].id`,
        message: `Duplicate panel item id "${itemId}" in panel "${String(panelId)}".`,
        value: item,
      });
    }
    ids.add(itemId);
  }
  return undefined;
};

const diagnoseDevtoolsPanels = (value: unknown): DevtoolsPanelContractError => {
  if (!isRecord(value)) {
    return contractError({
      reason: "InvalidType",
      path: "$",
      message: "DevtoolsPanels contract must be an object.",
      value,
    });
  }

  const version = readProperty(value, "version");
  if (version !== 1) {
    return contractError({
      reason: "InvalidVersion",
      path: "version",
      message: "DevtoolsPanels contract version must be 1.",
      value: version,
    });
  }

  const panels = readProperty(value, "panels");
  const panelValues = readArrayValues(panels);
  if (panelValues === undefined) {
    return contractError({
      reason: "InvalidPanels",
      path: "panels",
      message: "DevtoolsPanels.panels must be a bounded array.",
      value: panels,
    });
  }

  const ids = new Set<DevtoolsPanelId>();
  for (let index = 0; index < panelValues.length; index++) {
    const panel = panelValues[index];
    if (!isRecord(panel)) {
      return contractError({
        reason: "MalformedPanel",
        path: `panels[${index}]`,
        message: `Panel at index ${index} must be an object.`,
        value: panel,
      });
    }
    const id = readProperty(panel, "id");
    if (isDevtoolsPanelId(id)) {
      if (ids.has(id)) {
        return contractError({
          reason: "DuplicatePanel",
          path: `panels[${index}].id`,
          message: `Duplicate panel id "${id}".`,
          value: panel,
        });
      }
      ids.add(id);
    }
    const duplicateItem = diagnosePanelItemIds(panel, index);
    if (duplicateItem !== undefined) {
      return duplicateItem;
    }
  }

  for (const id of devtoolsPanelIds) {
    if (!ids.has(id)) {
      return contractError({
        reason: "MissingPanel",
        path: "panels",
        message: `Missing required panel "${id}".`,
        value: panels,
      });
    }
  }

  return contractError({
    reason: "MalformedPanel",
    path: "panels",
    message: "DevtoolsPanels payload does not satisfy the public panel contract.",
    value,
  });
};

/** Returns normalized panels or a diagnostics panel carrying the typed contract error. */
export const resolveDevtoolsPanelContract = (value: unknown): DevtoolsPanelContractResolution => {
  const normalized = normalizeDevtoolsPanels(value);
  if (normalized !== undefined) {
    return {
      _tag: "Valid",
      panels: normalized,
    };
  }

  const error = diagnoseDevtoolsPanels(value);
  return {
    _tag: "Invalid",
    error,
    panels: devtoolsPanelContractDiagnosticsPanels(error),
  };
};

/** Resolves explicit panel UI input or derives panels from summary inputs. */
export const resolveDevtoolsPanelsInput = (
  input: DevtoolsPanelUiInput,
  describePanels: (input: DevtoolsPanelsInput) => DevtoolsPanels,
): DevtoolsPanels =>
  input.panels === undefined
    ? describePanels(input)
    : resolveDevtoolsPanelContract(input.panels).panels;

/**
 * Normalizes an unknown inspected-window bridge value into a panel payload.
 *
 * Invalid payloads return `undefined`; invalid selected ids are simply ignored
 * so an extension can still render the valid panel model.
 */
export const normalizeSunfallArcDevtoolsBridgePayload = (
  value: unknown,
): DevtoolsBridgePayload | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const panels = readProperty(value, "panels");
  const normalizedPanels = normalizeDevtoolsPanels(panels);
  if (normalizedPanels === undefined) {
    return undefined;
  }

  const selectedPanelId = readProperty(value, "selectedPanelId");
  const title = readProperty(value, "title");
  const normalizedTitle = normalizePanelString(title);
  return {
    panels: normalizedPanels,
    ...(isDevtoolsPanelId(selectedPanelId) ? { selectedPanelId } : {}),
    ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
  };
};

/** Resolves an inspected-window bridge value with typed panel-contract diagnostics on failure. */
export const resolveSunfallArcDevtoolsBridgePayload = (
  value: unknown,
): DevtoolsBridgePayloadContractResolution => {
  if (!isRecord(value)) {
    const error = contractError({
      reason: "InvalidBridgePayload",
      path: "$",
      message: "Devtools bridge payload must be an object.",
      value,
    });
    return {
      _tag: "Invalid",
      error,
      panels: devtoolsPanelContractDiagnosticsPanels(error),
    };
  }

  const panels = readProperty(value, "panels");
  const resolution = resolveDevtoolsPanelContract(panels);
  if (resolution._tag === "Invalid") {
    return resolution;
  }

  const selectedPanelId = readProperty(value, "selectedPanelId");
  const title = readProperty(value, "title");
  const normalizedTitle = normalizePanelString(title);
  return {
    _tag: "Valid",
    payload: {
      panels: resolution.panels,
      ...(isDevtoolsPanelId(selectedPanelId) ? { selectedPanelId } : {}),
      ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
    },
  };
};
