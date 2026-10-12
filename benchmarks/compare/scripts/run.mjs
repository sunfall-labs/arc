#!/usr/bin/env node
// Runs the whole comparison and writes results/<date>.json, results/<date>.md,
// and results/latest.{json,md}. Run setup.mjs first.
//
//   node benchmarks/compare/scripts/run.mjs [--rounds=5] [--ssr-seconds=10]
//     [--only=arc,solid-start] [--phases=contract,transfer,ssr,browser]
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem, platform, release, arch } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  checkContract,
  cpuThrottle,
  measureInteractive,
  measureLoad,
  measureMemory,
  measureTransfer,
  measureUpdates,
} from "./browser.mjs";
import { compareRoot, frameworks as allFrameworks, installedVersions } from "./frameworks.mjs";
import { renderMarkdown } from "./report.mjs";
import { origin, startServer } from "./server.mjs";
import { measureSsr, ssrSettings } from "./ssr.mjs";

const flag = (name, fallback) => {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  return arg === undefined ? fallback : arg.slice(name.length + 3);
};
const rounds = Number(flag("rounds", "5"));
const ssrSeconds = Number(flag("ssr-seconds", String(ssrSettings.seconds)));
const only = flag("only", undefined)?.split(",");
const phases = flag("phases", "contract,transfer,ssr,browser").split(",");
const frameworks = allFrameworks.filter((fw) => only === undefined || only.includes(fw.id));

const load = () => loadavg().map((value) => Math.round(value * 100) / 100);
const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

/** Round r starts with a different framework, so no one always runs first or last. */
const interleaved = (round) =>
  frameworks.map((_, index) => frameworks[(index + round) % frameworks.length]);

const withServer = async (framework, body) => {
  const server = await startServer(framework);
  try {
    return await body(server);
  } finally {
    await server.stop();
  }
};

/** The same warm-up for every server: JIT the render paths before measuring. */
const warm = async () => {
  for (let index = 0; index < 50; index++) {
    for (const path of ["/", "/items/42"]) {
      const response = await fetch(`${origin}${path}`);
      await response.arrayBuffer();
    }
  }
};

const results = {
  meta: {
    startedAt: new Date().toISOString(),
    machine: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      freeMemoryGbAtStart: Math.round(freemem() / 2 ** 30),
      os: `${platform()} ${release()} ${arch()}`,
      node: process.version,
    },
    loadAverageAtStart: load(),
    settings: {
      rounds,
      ssr: { ...ssrSettings, seconds: ssrSeconds },
      cpuThrottle,
      browser: "Playwright Chromium (headless shell)",
    },
    versions: Object.fromEntries(frameworks.map((fw) => [fw.id, installedVersions(fw)])),
  },
  contract: {},
  transfer: {},
  samples: Object.fromEntries(frameworks.map((fw) => [fw.id, { ssr: [], browser: [] }])),
};

const browser = await chromium.launch();
results.meta.settings.browser += ` ${browser.version()}`;

try {
  if (phases.includes("contract")) {
    for (const fw of frameworks) {
      log(`contract ${fw.id}`);
      results.contract[fw.id] = await withServer(fw, () => checkContract(browser));
      if (results.contract[fw.id].problems.length > 0) {
        throw new Error(`${fw.id} breaks the contract: ${results.contract[fw.id].problems}`);
      }
    }
  }

  if (phases.includes("transfer")) {
    for (const fw of frameworks) {
      log(`transfer ${fw.id}`);
      results.transfer[fw.id] = await withServer(fw, () => measureTransfer(browser));
    }
  }

  if (phases.includes("ssr")) {
    for (let round = 0; round < rounds; round++) {
      for (const fw of interleaved(round)) {
        log(`ssr round ${round + 1}/${rounds} ${fw.id} (load ${load()[0]})`);
        const sample = await withServer(fw, async ({ pid }) => {
          const loadBefore = load();
          const list = await measureSsr("/", { pid, seconds: ssrSeconds });
          const detail = await measureSsr("/items/42", { pid, seconds: ssrSeconds });
          return { round, loadBefore, loadAfter: load(), list, detail };
        });
        results.samples[fw.id].ssr.push(sample);
      }
    }
  }

  if (phases.includes("browser")) {
    for (let round = 0; round < rounds; round++) {
      for (const fw of interleaved(round)) {
        log(`browser round ${round + 1}/${rounds} ${fw.id} (load ${load()[0]})`);
        const sample = await withServer(fw, async () => {
          await warm();
          const loadBefore = load();
          const loadMetrics = await measureLoad(browser);
          const interactive = await measureInteractive(browser);
          const updates = await measureUpdates(browser);
          const memory = await measureMemory(browser);
          return {
            round,
            loadBefore,
            loadAfter: load(),
            load: loadMetrics,
            interactive,
            updates,
            memory,
          };
        });
        results.samples[fw.id].browser.push(sample);
      }
    }
  }
} finally {
  await browser.close();
}

results.meta.finishedAt = new Date().toISOString();
results.meta.loadAverageAtEnd = load();

const outDir = join(compareRoot, "results");
mkdirSync(outDir, { recursive: true });
const stamp = results.meta.startedAt.slice(0, 16).replace(/[:T]/g, "-");
const json = `${JSON.stringify(results, null, 2)}\n`;
const markdown = renderMarkdown(results, frameworks);
writeFileSync(join(outDir, `${stamp}.json`), json);
writeFileSync(join(outDir, `${stamp}.md`), markdown);
writeFileSync(join(outDir, "latest.json"), json);
writeFileSync(join(outDir, "latest.md"), markdown);
console.log(markdown);
log(`wrote results/${stamp}.{json,md} and results/latest.{json,md}`);
