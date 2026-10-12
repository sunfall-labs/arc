// Browser measurements with Playwright (Chromium). Each measurement opens a
// fresh browser context, so every page load starts with a cold HTTP cache.
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { origin } from "./server.mjs";

const probeSource = readFileSync(new URL("./page-probe.js", import.meta.url), "utf8");

export const cpuThrottle = 4;

const openPage = async (browser, { throttle, probeInteractive = false }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (probeInteractive) {
    await context.addInitScript(() => {
      window.__probeInteractive = true;
    });
  }
  await context.addInitScript({ content: probeSource });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  }
  return { context, page, cdp };
};

/** Waits for the network to go idle and the main thread to stay free of long tasks. */
const waitForQuiet = async (page) => {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.__bench.settled(500));
};

const compressedSizes = (body) => ({
  raw: body.length,
  gzip: gzipSync(body, { level: 9 }).length,
  brotli: brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
});

const sumSizes = (files) =>
  files.reduce(
    (total, file) => ({
      raw: total.raw + file.raw,
      gzip: total.gzip + file.gzip,
      brotli: total.brotli + file.brotli,
    }),
    { raw: 0, gzip: 0, brotli: 0 },
  );

/**
 * Every byte the first visit to `/` downloads, by kind: the JS files (entry,
 * shared chunks, route chunks, modulepreloads), CSS, and the HTML document.
 * Unthrottled; recorded until the page is idle.
 */
export const measureTransfer = async (browser) => {
  const { context, page } = await openPage(browser, { throttle: false });
  const responses = [];
  page.on("response", (response) => responses.push(response));
  await page.goto(`${origin}/`);
  await waitForQuiet(page);
  const files = [];
  for (const response of responses) {
    const url = new URL(response.url());
    if (url.origin !== origin || response.request().method() !== "GET") continue;
    const type = response.headers()["content-type"] ?? "";
    const kind = type.includes("javascript")
      ? "js"
      : type.includes("css")
        ? "css"
        : type.includes("html")
          ? "html"
          : undefined;
    if (kind === undefined) continue;
    const body = await response.body();
    files.push({ kind, path: url.pathname + url.search, ...compressedSizes(body) });
  }
  await context.close();
  const byKind = (kind) => files.filter((file) => file.kind === kind);
  return {
    js: { files: byKind("js").length, ...sumSizes(byKind("js")) },
    css: sumSizes(byKind("css")),
    html: sumSizes(byKind("html")),
    files,
  };
};

/** Cold load of `/` with the CPU throttled: TTFB, FCP, LCP, and total blocking time. */
export const measureLoad = async (browser, path = "/") => {
  const { context, page } = await openPage(browser, { throttle: true });
  await page.goto(`${origin}${path}`);
  await waitForQuiet(page);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
    const end = performance.now();
    // TBT as Lighthouse defines it, over FCP..quiet instead of FCP..TTI: the
    // part of every long task beyond 50ms.
    const tbt = window.__bench.longTasks
      .filter((task) => fcp !== undefined && task.start + task.duration > fcp)
      .reduce((total, task) => total + Math.max(0, task.duration - 50), 0);
    return {
      ttfb: navigation.responseStart,
      domContentLoaded: navigation.domContentLoadedEventEnd,
      load: navigation.loadEventEnd,
      fcp,
      lcp: window.__bench.lcp,
      tbt,
      longTasks: window.__bench.longTasks.length,
      observedUntil: end,
    };
  });
  await context.close();
  return metrics;
};

/** Cold load of `/` with the CPU throttled: time until a click on a row's toggle is handled. */
export const measureInteractive = async (browser) => {
  const { context, page } = await openPage(browser, { throttle: true, probeInteractive: true });
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => window.__bench.interactiveAt !== undefined, undefined, {
    timeout: 60_000,
    polling: 50,
  });
  const interactive = await page.evaluate(() => window.__bench.interactiveAt);
  await context.close();
  return { interactive };
};

/**
 * Client updates on a hydrated `/`, CPU throttled. Every timing runs from the
 * input to the next frame after the DOM shows the result.
 */
export const measureUpdates = async (browser) => {
  const { context, page } = await openPage(browser, { throttle: true });
  await page.goto(`${origin}/`);
  await waitForQuiet(page);

  const filter = await page.evaluate(async () => {
    const bench = window.__bench;
    const input = document.querySelector('[data-testid="filter"]');
    const names = [...document.querySelectorAll('[data-testid="items"] > li .item-name')].map(
      (link) => link.textContent.toLowerCase(),
    );
    const total = names.length;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const steps = [];
    for (const query of ["a", "am", "amb", "ambe", "amber", ""]) {
      const expected = names.filter((name) => name.includes(query)).length;
      const label = `${expected} of ${total} items`;
      const started = performance.now();
      setValue.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await bench.waitFor(
        () =>
          document.querySelector('[data-testid="count"]')?.textContent === label &&
          document.querySelectorAll('[data-testid="items"] > li').length === expected,
      );
      const painted = await bench.nextPaint();
      steps.push({ query, expected, ms: painted - started });
    }
    return steps;
  });

  const toggles = await page.evaluate(async () => {
    const bench = window.__bench;
    const results = [];
    for (const id of ["500", "501", "502", "503", "504"]) {
      await bench.settled(300);
      const selector = `[data-testid="toggle-${id}"]`;
      const before = document.querySelector(selector).getAttribute("aria-pressed");
      const started = performance.now();
      document.querySelector(selector).click();
      await bench.waitFor(
        () => document.querySelector(selector)?.getAttribute("aria-pressed") !== before,
      );
      const painted = await bench.nextPaint();
      const settled = await bench.settled(300);
      const after = document.querySelector(selector).getAttribute("aria-pressed");
      results.push({
        id,
        toPaint: painted - started,
        toSettled: settled - started,
        stuck: after !== before,
      });
    }
    return results;
  });

  const navigation = await page.evaluate(async () => {
    const bench = window.__bench;
    await bench.settled(300);
    let started = performance.now();
    document.querySelector('[data-testid="items"] a[href="/items/42"]').click();
    await bench.waitFor(() => document.querySelector('[data-testid="detail"][data-id="42"]'));
    const toDetail = (await bench.nextPaint()) - started;
    await bench.settled(300);
    started = performance.now();
    document.querySelector('[data-testid="back"]').click();
    await bench.waitFor(
      () => document.querySelectorAll('[data-testid="items"] > li').length === 1000,
    );
    const toList = (await bench.nextPaint()) - started;
    return { toDetail, toList };
  });
  const documents = await page.evaluate(() => performance.getEntriesByType("navigation").length);

  await context.close();
  return { filter, toggles, navigation, fullPageLoads: documents };
};

/** JS heap after load and after 100 sequential toggles (each settled), unthrottled, after GC. */
export const measureMemory = async (browser) => {
  const { context, page, cdp } = await openPage(browser, { throttle: false });
  await page.goto(`${origin}/`);
  await waitForQuiet(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = await cdp.send("Runtime.getHeapUsage");
    return usedSize;
  };
  const domNodes = () => page.evaluate(() => document.getElementsByTagName("*").length);
  const afterLoad = await heap();
  const nodesAfterLoad = await domNodes();
  const toggleMs = await page.evaluate(async () => {
    const bench = window.__bench;
    const started = performance.now();
    for (let id = 1; id <= 100; id++) {
      const selector = `[data-testid="toggle-${id}"]`;
      const before = document.querySelector(selector).getAttribute("aria-pressed");
      document.querySelector(selector).click();
      await bench.waitFor(
        () => document.querySelector(selector)?.getAttribute("aria-pressed") !== before,
      );
      await bench.settled(100);
    }
    return performance.now() - started;
  });
  const afterToggles = await heap();
  const nodesAfterToggles = await domNodes();
  await context.close();
  return { afterLoad, afterToggles, nodesAfterLoad, nodesAfterToggles, toggleMs };
};

/** Contract checks: fails loudly if an app does not do what the benchmark assumes. */
export const checkContract = async (browser) => {
  const problems = [];
  const fetchStatus = async (path) => {
    const response = await fetch(`${origin}${path}`);
    const html = await response.text();
    return { status: response.status, html };
  };
  const list = await fetchStatus("/");
  const rows = (list.html.match(/<li\b[^>]*class="item"/g) ?? []).length;
  if (list.status !== 200 || rows !== 1000) problems.push(`/ -> ${list.status}, ${rows} rows`);
  const detail = await fetchStatus("/items/42");
  if (detail.status !== 200 || !detail.html.includes('data-testid="detail"')) {
    problems.push(`/items/42 -> ${detail.status}`);
  }
  const missing = await fetchStatus("/items/9999");
  if (!missing.html.includes('data-testid="not-found"')) {
    problems.push(`/items/9999 -> ${missing.status} without the not-found view`);
  }

  const { context, page } = await openPage(browser, { throttle: false });
  await page.goto(`${origin}/`);
  await waitForQuiet(page);
  const behaviour = await page.evaluate(async () => {
    const bench = window.__bench;
    const button = () => document.querySelector('[data-testid="toggle-7"]');
    const before = button().getAttribute("aria-pressed");
    button().click();
    await bench.waitFor(() => button().getAttribute("aria-pressed") !== before, 5000);
    await bench.settled(300);
    const toggled = button().getAttribute("aria-pressed") !== before;
    const input = document.querySelector('[data-testid="filter"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setValue.call(input, "amber");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await bench.waitFor(
      () => document.querySelectorAll('[data-testid="items"] > li').length < 1000,
      5000,
    );
    return { toggled, filtered: document.querySelector('[data-testid="count"]').textContent };
  });
  await context.close();
  if (!behaviour.toggled) problems.push("toggle did not stick after the server answered");
  return {
    problems,
    notFoundStatus: missing.status,
    listHtmlBytes: Buffer.byteLength(list.html),
    filteredAmber: behaviour.filtered,
  };
};
