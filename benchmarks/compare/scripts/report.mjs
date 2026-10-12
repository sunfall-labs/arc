// Turns results JSON into the markdown table docs/benchmarks.md quotes.

export const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const spread = (values) => {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? undefined : { min: Math.min(...finite), max: Math.max(...finite) };
};

const kb = (bytes) => bytes / 1024;
const mb = (bytes) => bytes / 2 ** 20;
const sum = (values) => values.reduce((total, value) => total + value, 0);

/** Each row: where its number comes from, its unit, and which direction is better. */
const sampledMetrics = [
  { section: "SSR, `/` (1,000 rows)" },
  {
    label: "Requests/s",
    kind: "ssr",
    get: (s) => s.list.requestsPerSecond,
    unit: "",
    better: "higher",
    digits: 0,
  },
  {
    label: "Latency p50",
    kind: "ssr",
    get: (s) => s.list.p50,
    unit: "ms",
    better: "lower",
    digits: 1,
  },
  {
    label: "Latency p99",
    kind: "ssr",
    get: (s) => s.list.p99,
    unit: "ms",
    better: "lower",
    digits: 1,
  },
  {
    label: "Server CPU per request",
    kind: "ssr",
    get: (s) => s.list.cpuMsPerRequest,
    unit: "ms",
    better: "lower",
    digits: 2,
  },
  { section: "SSR, `/items/42`" },
  {
    label: "Requests/s",
    kind: "ssr",
    get: (s) => s.detail.requestsPerSecond,
    unit: "",
    better: "higher",
    digits: 0,
  },
  {
    label: "Latency p50",
    kind: "ssr",
    get: (s) => s.detail.p50,
    unit: "ms",
    better: "lower",
    digits: 1,
  },
  {
    label: "Latency p99",
    kind: "ssr",
    get: (s) => s.detail.p99,
    unit: "ms",
    better: "lower",
    digits: 1,
  },
  {
    label: "Server CPU per request",
    kind: "ssr",
    get: (s) => s.detail.cpuMsPerRequest,
    unit: "ms",
    better: "lower",
    digits: 2,
  },
  { section: "Cold load of `/`, CPU 4x slower" },
  {
    label: "TTFB",
    kind: "browser",
    get: (s) => s.load.ttfb,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  { label: "FCP", kind: "browser", get: (s) => s.load.fcp, unit: "ms", better: "lower", digits: 0 },
  { label: "LCP", kind: "browser", get: (s) => s.load.lcp, unit: "ms", better: "lower", digits: 0 },
  {
    label: "First click handled",
    kind: "browser",
    get: (s) => s.interactive.interactive,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  {
    label: "Total blocking time",
    kind: "browser",
    get: (s) => s.load.tbt,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  { section: "Client updates on `/`, CPU 4x slower (input to next frame)" },
  {
    label: "Filter: type `amber` (5 keystrokes)",
    kind: "browser",
    get: (s) => sum(s.updates.filter.slice(0, 5).map((step) => step.ms)),
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  {
    label: "Filter: clear (back to 1,000 rows)",
    kind: "browser",
    get: (s) => s.updates.filter[5].ms,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  {
    label: "Toggle: optimistic row update",
    kind: "browser",
    get: (s) => median(s.updates.toggles.map((t) => t.toPaint)),
    unit: "ms",
    better: "lower",
    digits: 1,
  },
  {
    label: "Toggle: settled (server + revalidation)",
    kind: "browser",
    get: (s) => median(s.updates.toggles.map((t) => t.toSettled)),
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  {
    label: "Navigate list → detail",
    kind: "browser",
    get: (s) => s.updates.navigation.toDetail,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  {
    label: "Navigate detail → list",
    kind: "browser",
    get: (s) => s.updates.navigation.toList,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
  { section: "Memory on `/` (unthrottled, after forced GC)" },
  {
    label: "JS heap after load",
    kind: "browser",
    get: (s) => mb(s.memory.afterLoad),
    unit: "MB",
    better: "lower",
    digits: 2,
  },
  {
    label: "JS heap after 100 toggles",
    kind: "browser",
    get: (s) => mb(s.memory.afterToggles),
    unit: "MB",
    better: "lower",
    digits: 2,
  },
  {
    label: "100 toggles, each settled",
    kind: "browser",
    get: (s) => s.memory.toggleMs,
    unit: "ms",
    better: "lower",
    digits: 0,
  },
];

const transferMetrics = [
  { label: "JS files", get: (t) => t.js.files, unit: "", better: "lower", digits: 0 },
  { label: "JS, raw", get: (t) => kb(t.js.raw), unit: "KB", better: "lower", digits: 1 },
  { label: "JS, gzip", get: (t) => kb(t.js.gzip), unit: "KB", better: "lower", digits: 1 },
  { label: "JS, brotli", get: (t) => kb(t.js.brotli), unit: "KB", better: "lower", digits: 1 },
  { label: "HTML, raw", get: (t) => kb(t.html.raw), unit: "KB", better: "lower", digits: 1 },
  { label: "HTML, gzip", get: (t) => kb(t.html.gzip), unit: "KB", better: "lower", digits: 1 },
];

const format = (value, digits, unit) =>
  value === undefined
    ? "n/a"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit === "" ? "" : ` ${unit}`}`;

const best = (values, better) => {
  const finite = values.filter((value) => value !== undefined);
  if (finite.length < 2) return undefined;
  return better === "higher" ? Math.max(...finite) : Math.min(...finite);
};

/** Summary statistics for every sampled metric: median, min, max, n. */
export const summarize = (results, frameworks) =>
  Object.fromEntries(
    frameworks.map((fw) => [
      fw.id,
      Object.fromEntries(
        sampledMetrics
          .filter((metric) => metric.label !== undefined)
          .map((metric) => {
            const samples = results.samples[fw.id]?.[metric.kind] ?? [];
            const values = samples.map((sample) => metric.get(sample));
            return [
              `${metric.kind}:${metric.label}:${sampledMetrics.indexOf(metric)}`,
              { median: median(values), ...spread(values), n: values.length },
            ];
          }),
      ),
    ]),
  );

export const renderMarkdown = (results, frameworks) => {
  const lines = [];
  const header = `| Metric | ${frameworks.map((fw) => fw.label).join(" | ")} |`;
  const divider = `| --- | ${frameworks.map(() => "---:").join(" | ")} |`;
  const { meta } = results;
  lines.push(`# Comparison results, ${meta.startedAt.slice(0, 10)}`, "");
  lines.push(
    `- Machine: ${meta.machine.cpu}, ${meta.machine.cores} cores, ${meta.machine.memoryGb} GB, ${meta.machine.os}`,
    `- Node ${meta.machine.node}; ${meta.settings.browser}; CPU throttle ${meta.settings.cpuThrottle}x for browser timings`,
    `- ${meta.settings.rounds} interleaved rounds; SSR: autocannon, ${meta.settings.ssr.connections} connections, ${meta.settings.ssr.warmupSeconds}s warm-up + ${meta.settings.ssr.seconds}s per route per round`,
    `- Load average (1/5/15 min) at start ${meta.loadAverageAtStart.join(" / ")}, at end ${meta.loadAverageAtEnd?.join(" / ") ?? "n/a"}`,
    `- Run: ${meta.startedAt} to ${meta.finishedAt ?? "n/a"}`,
    "",
  );
  lines.push("Versions:", "");
  for (const fw of frameworks) {
    const versions = Object.entries(meta.versions[fw.id] ?? {})
      .map(([name, version]) => `${name} ${version}`)
      .join(", ");
    lines.push(`- ${fw.label}: ${versions}`);
  }
  lines.push("");

  if (Object.keys(results.transfer).length > 0) {
    lines.push("## First visit to `/`: bytes downloaded", "", header, divider);
    for (const metric of transferMetrics) {
      const values = frameworks.map((fw) =>
        results.transfer[fw.id] === undefined ? undefined : metric.get(results.transfer[fw.id]),
      );
      const top = best(values, metric.better);
      lines.push(
        `| ${metric.label} | ${values
          .map((value) => {
            const text = format(value, metric.digits, metric.unit);
            return value !== undefined && value === top ? `**${text}**` : text;
          })
          .join(" | ")} |`,
      );
    }
    lines.push("");
  }

  const summary = summarize(results, frameworks);
  const hasSamples = frameworks.some(
    (fw) => results.samples[fw.id].ssr.length + results.samples[fw.id].browser.length > 0,
  );
  if (hasSamples) {
    lines.push("## Timings", "", "Median of all rounds; the range below each is min–max.", "");
    lines.push(header, divider);
    for (const metric of sampledMetrics) {
      if (metric.section !== undefined) {
        lines.push(`| **${metric.section}** | ${frameworks.map(() => "").join(" | ")} |`);
        continue;
      }
      const key = `${metric.kind}:${metric.label}:${sampledMetrics.indexOf(metric)}`;
      const stats = frameworks.map((fw) => summary[fw.id][key]);
      const top = best(
        stats.map((stat) => stat.median),
        metric.better,
      );
      lines.push(
        `| ${metric.label} | ${stats
          .map((stat) => {
            if (stat.median === undefined) return "n/a";
            const text = format(stat.median, metric.digits, metric.unit);
            const range = `<br><sub>${format(stat.min, metric.digits, "")}–${format(stat.max, metric.digits, "")}</sub>`;
            return `${stat.median === top ? `**${text}**` : text}${range}`;
          })
          .join(" | ")} |`,
      );
    }
    lines.push("");
  }

  if (Object.keys(results.contract).length > 0) {
    lines.push("## Contract checks", "", header, divider);
    lines.push(
      `| \`/items/9999\` status | ${frameworks.map((fw) => results.contract[fw.id]?.notFoundStatus ?? "n/a").join(" | ")} |`,
      `| \`/\` HTML bytes | ${frameworks.map((fw) => results.contract[fw.id]?.listHtmlBytes?.toLocaleString("en-US") ?? "n/a").join(" | ")} |`,
      `| Filter \`amber\` | ${frameworks.map((fw) => results.contract[fw.id]?.filteredAmber ?? "n/a").join(" | ")} |`,
    );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};
