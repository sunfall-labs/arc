import { Effect, type Scope } from "effect";
import type {
  DevtoolsPanel,
  DevtoolsPanelId,
  DevtoolsPanelItem,
  DevtoolsPanelMetric,
  DevtoolsPanelMount,
  DevtoolsPanelMountOptions,
  DevtoolsPanelUiInput,
  DevtoolsPanels,
  DevtoolsSerializableValue,
} from "./devtools-contract.js";
import { isDevtoolsPanelId, isDevtoolsPanelOverflowItem } from "./panel-contract.js";

export type DevtoolsPanelsResolver = (input: DevtoolsPanelUiInput) => DevtoolsPanels;

const defaultDevtoolsPanelTitle = "Sunfall Arc Devtools";
const defaultDevtoolsMaxPanelItems = 8;

/** Default CSS used by the embeddable Devtools panel renderer. */
export const devtoolsPanelStyles = `
.sunfall-arc-devtools {
  color: #172033;
  background: #f7f8fb;
  border: 1px solid #d8deea;
  border-radius: 8px;
  font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  max-width: 1120px;
}
.sunfall-arc-devtools * {
  box-sizing: border-box;
}
.sunfall-arc-devtools__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #d8deea;
}
.sunfall-arc-devtools__title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}
.sunfall-arc-devtools__version {
  color: #5d6b82;
  font-size: 12px;
}
.sunfall-arc-devtools__tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 12px;
  border-bottom: 1px solid #d8deea;
}
.sunfall-arc-devtools__tab {
  appearance: none;
  background: #ffffff;
  border: 1px solid #cdd5e2;
  border-radius: 6px;
  color: #172033;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  white-space: nowrap;
}
.sunfall-arc-devtools__tab[aria-selected="true"] {
  background: #173b68;
  border-color: #173b68;
  color: #ffffff;
}
.sunfall-arc-devtools__severity {
  border-radius: 999px;
  border: 1px solid currentColor;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
}
.sunfall-arc-devtools__body {
  padding: 14px 16px 16px;
}
.sunfall-arc-devtools__panel {
  display: grid;
  gap: 12px;
}
.sunfall-arc-devtools__panel[hidden] {
  display: none;
}
.sunfall-arc-devtools__panel-header {
  display: grid;
  gap: 4px;
}
.sunfall-arc-devtools__panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
.sunfall-arc-devtools__summary {
  color: #4d5c73;
  margin: 0;
}
.sunfall-arc-devtools__metrics {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  margin: 0;
}
.sunfall-arc-devtools__metric {
  background: #ffffff;
  border: 1px solid #d8deea;
  border-radius: 6px;
  padding: 8px 10px;
}
.sunfall-arc-devtools__metric-label {
  color: #5d6b82;
  display: block;
  font-size: 11px;
}
.sunfall-arc-devtools__metric-value {
  display: block;
  font-size: 14px;
  font-weight: 650;
}
.sunfall-arc-devtools__items {
  display: grid;
  gap: 8px;
}
.sunfall-arc-devtools__item {
  background: #ffffff;
  border: 1px solid #d8deea;
  border-radius: 6px;
  display: grid;
  gap: 8px;
  padding: 10px;
}
.sunfall-arc-devtools__item-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}
.sunfall-arc-devtools__item-label {
  font-weight: 650;
  overflow-wrap: anywhere;
}
.sunfall-arc-devtools__item-detail {
  color: #5d6b82;
  overflow-wrap: anywhere;
}
.sunfall-arc-devtools__data {
  margin: 0;
}
.sunfall-arc-devtools__data pre {
  background: #101828;
  border-radius: 6px;
  color: #eef4ff;
  margin: 8px 0 0;
  max-height: 280px;
  overflow: auto;
  padding: 10px;
}
.sunfall-arc-devtools__empty {
  color: #5d6b82;
  margin: 0;
}
`.trim();

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

const metricValueText = (metric: DevtoolsPanelMetric): string =>
  metric.unit === undefined ? String(metric.value) : `${metric.value} ${metric.unit}`;

const metricHtml = (metric: DevtoolsPanelMetric): string => `
<div class="sunfall-arc-devtools__metric">
  <span class="sunfall-arc-devtools__metric-label">${escapeHtml(metric.label)}</span>
  <span class="sunfall-arc-devtools__metric-value">${escapeHtml(metricValueText(metric))}</span>
</div>`;

const metricsHtml = (metrics: ReadonlyArray<DevtoolsPanelMetric>): string =>
  metrics.length === 0
    ? ""
    : `<div class="sunfall-arc-devtools__metrics">${metrics.map(metricHtml).join("")}</div>`;

const dataHtml = (data: DevtoolsSerializableValue | undefined): string =>
  data === undefined
    ? ""
    : `<details class="sunfall-arc-devtools__data"><summary>Data</summary><pre>${escapeHtml(JSON.stringify(data, null, 2) ?? "null")}</pre></details>`;

const itemHtml = (item: DevtoolsPanelItem): string => `
<article class="sunfall-arc-devtools__item" data-sunfall-arc-devtools-item-id="${escapeHtml(item.id)}" data-severity="${escapeHtml(item.severity)}">
  <div class="sunfall-arc-devtools__item-header">
    <div>
      <div class="sunfall-arc-devtools__item-label">${escapeHtml(item.label)}</div>
      ${item.detail === undefined ? "" : `<div class="sunfall-arc-devtools__item-detail">${escapeHtml(item.detail)}</div>`}
    </div>
    <span class="sunfall-arc-devtools__severity">${escapeHtml(item.severity)}</span>
  </div>
  ${metricsHtml(item.metrics ?? [])}
  ${dataHtml(item.data)}
</article>`;

const limitPanelItems = (
  panelId: DevtoolsPanelId,
  items: ReadonlyArray<DevtoolsPanelItem>,
  maxItems: number,
): ReadonlyArray<DevtoolsPanelItem> => {
  if (maxItems < 0 || items.length <= maxItems) {
    return items;
  }
  if (maxItems === 0) {
    return [];
  }

  let overflow: DevtoolsPanelItem | undefined;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (isDevtoolsPanelOverflowItem(panelId, item)) {
      overflow = item;
      break;
    }
  }
  if (overflow === undefined) {
    return items.slice(0, maxItems);
  }

  const limited = items.slice(0, maxItems);
  return limited.some((item) => item.id === overflow.id)
    ? limited
    : [...items.slice(0, maxItems - 1), overflow];
};

const panelHtml = (
  panel: DevtoolsPanel,
  selectedPanelId: DevtoolsPanelId | undefined,
  maxItems: number,
): string => {
  const visible = panel.id === selectedPanelId;
  const items = limitPanelItems(panel.id, panel.items, maxItems);
  const remainingCount = panel.items.length - items.length;

  return `
<section class="sunfall-arc-devtools__panel" data-panel-id="${escapeHtml(panel.id)}"${visible ? "" : " hidden"}>
  <header class="sunfall-arc-devtools__panel-header">
    <h3 class="sunfall-arc-devtools__panel-title">${escapeHtml(panel.title)}</h3>
    <p class="sunfall-arc-devtools__summary">${escapeHtml(panel.summary)}</p>
  </header>
  ${metricsHtml(panel.metrics)}
  <div class="sunfall-arc-devtools__items">
    ${items.length === 0 ? `<p class="sunfall-arc-devtools__empty">No panel items recorded.</p>` : items.map(itemHtml).join("")}
    ${remainingCount > 0 ? `<p class="sunfall-arc-devtools__empty">${remainingCount} more items hidden by the current render limit.</p>` : ""}
  </div>
</section>`;
};

const resolveMaxPanelItems = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultDevtoolsMaxPanelItems;
  }
  return Math.max(0, Math.floor(value));
};

const resolveSelectedPanelId = (
  panels: DevtoolsPanels,
  requested: DevtoolsPanelId | undefined,
): DevtoolsPanelId | undefined => {
  if (requested !== undefined && panels.panels.some((panel) => panel.id === requested)) {
    return requested;
  }
  return panels.panels[0]?.id;
};

export const renderDevtoolsPanelsHtmlWithResolver = (
  input: DevtoolsPanelUiInput,
  resolvePanels: DevtoolsPanelsResolver,
): string => {
  const panels = resolvePanels(input);
  const selectedPanelId = resolveSelectedPanelId(panels, input.selectedPanelId);
  const maxItems = resolveMaxPanelItems(input.maxItemsPerPanel);
  const title = input.title ?? defaultDevtoolsPanelTitle;
  const includeStyles = input.includeStyles ?? true;

  return `${includeStyles ? `<style>${devtoolsPanelStyles}</style>` : ""}
<article class="sunfall-arc-devtools" data-sunfall-arc-devtools-version="${panels.version}"${selectedPanelId === undefined ? "" : ` data-selected-panel="${escapeHtml(selectedPanelId)}"`}>
  <header class="sunfall-arc-devtools__header">
    <h2 class="sunfall-arc-devtools__title">${escapeHtml(title)}</h2>
    <span class="sunfall-arc-devtools__version">panel contract v${panels.version}</span>
  </header>
  <nav class="sunfall-arc-devtools__tabs" aria-label="Sunfall Arc devtools panels">
    ${panels.panels
      .map(
        (panel) => `
      <button
        type="button"
        class="sunfall-arc-devtools__tab"
        data-sunfall-arc-devtools-panel-target="${escapeHtml(panel.id)}"
        aria-selected="${panel.id === selectedPanelId ? "true" : "false"}"
      >
        <span>${escapeHtml(panel.title)}</span>
        <span class="sunfall-arc-devtools__severity">${escapeHtml(panel.severity)}</span>
      </button>
    `,
      )
      .join("")}
  </nav>
  <div class="sunfall-arc-devtools__body">
    ${panels.panels.map((panel) => panelHtml(panel, selectedPanelId, maxItems)).join("")}
  </div>
</article>`;
};

export const mountDevtoolsPanelsWithResolver = (
  options: DevtoolsPanelMountOptions,
  resolvePanels: DevtoolsPanelsResolver,
): DevtoolsPanelMount => {
  const { root, ...initialInput } = options;
  let input: DevtoolsPanelUiInput = initialInput;
  let mounted = true;

  const render = (): void => {
    root.innerHTML = renderDevtoolsPanelsHtmlWithResolver(input, resolvePanels);
  };

  const selectPanel = (panelId: DevtoolsPanelId): void => {
    input = {
      ...input,
      selectedPanelId: panelId,
    };
    render();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const trigger = target.closest<HTMLElement>("[data-sunfall-arc-devtools-panel-target]");
    if (trigger === null || !root.contains(trigger)) {
      return;
    }
    const panelId = trigger.dataset.sunfallArcDevtoolsPanelTarget;
    if (!isDevtoolsPanelId(panelId)) {
      return;
    }
    event.preventDefault();
    selectPanel(panelId);
  };

  root.addEventListener("click", onClick);
  render();

  return {
    root,
    update: (nextInput: DevtoolsPanelUiInput = {}) => {
      if (!mounted) {
        return;
      }
      input = {
        ...input,
        ...nextInput,
      };
      render();
    },
    unmount: () => {
      if (!mounted) {
        return;
      }
      mounted = false;
      root.removeEventListener("click", onClick);
      root.innerHTML = "";
    },
  };
};

export const mountDevtoolsPanelsEffectWithResolver = (
  options: DevtoolsPanelMountOptions,
  resolvePanels: DevtoolsPanelsResolver,
): Effect.Effect<DevtoolsPanelMount, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => mountDevtoolsPanelsWithResolver(options, resolvePanels)),
    (mount) =>
      Effect.sync(() => {
        mount.unmount();
      }),
  );
