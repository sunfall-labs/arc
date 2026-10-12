// Injected into every benchmark page before any of its own scripts run
// (Playwright `addInitScript`). Framework-neutral: it only reads standard
// performance entries, wraps `fetch`, and watches the DOM.
(() => {
  const bench = {
    longTasks: [],
    lcp: undefined,
    inflight: 0,
    lastActivity: 0,
    interactiveAt: undefined,
  };
  window.__bench = bench;

  const touch = () => {
    bench.lastActivity = performance.now();
  };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        bench.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last !== undefined) bench.lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    // A fetch body that finishes downloading counts as activity too.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest") touch();
      }
    }).observe({ type: "resource", buffered: false });
  } catch {}

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    bench.inflight++;
    touch();
    return originalFetch.apply(this, args).finally(() => {
      bench.inflight--;
      touch();
    });
  };

  const startMutationWatch = () => {
    new MutationObserver(touch).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  };
  if (document.documentElement) startMutationWatch();
  else document.addEventListener("readystatechange", startMutationWatch, { once: true });

  /** Resolves with the time `predicate` first holds, checked after every DOM change. */
  bench.waitFor = (predicate, timeout = 30000) =>
    new Promise((resolve, reject) => {
      if (predicate()) {
        resolve(performance.now());
        return;
      }
      const observer = new MutationObserver(() => {
        if (predicate()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(performance.now());
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error("waitFor timed out"));
      }, timeout);
    });

  /** Resolves after the next frame has been produced (rAF, then a task). */
  bench.nextPaint = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0)),
    );

  /**
   * Resolves once no fetch is in flight and nothing (DOM, network) has
   * happened for `quietMs`. The result is the first moment the main thread
   * was free after the last activity, so post-response work counts.
   */
  bench.settled = (quietMs = 300, timeout = 30000) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      let freeSince = performance.now();
      let seenActivity = bench.lastActivity;
      const tick = () => {
        const now = performance.now();
        if (bench.lastActivity !== seenActivity || bench.inflight > 0) {
          seenActivity = bench.lastActivity;
          freeSince = now;
        }
        if (bench.inflight === 0 && now - freeSince >= quietMs) {
          resolve(freeSince);
          return;
        }
        if (now - started > timeout) {
          reject(new Error("settled timed out"));
          return;
        }
        setTimeout(tick, 10);
      };
      setTimeout(tick, 0);
    });

  /**
   * Interactivity probe, enabled when the harness sets
   * `window.__probeInteractive = true` in an init script that runs before this
   * one. Clicks the first row's toggle every 16ms from the moment it exists
   * until the DOM reflects a click; `interactiveAt` is that moment. Clicks
   * made before hydration either do nothing or are replayed by the framework
   * once it hydrates; either way the first visible response is the measure.
   */
  if (window.__probeInteractive === true) {
    let initial;
    const probe = () => {
      if (bench.interactiveAt !== undefined) return;
      const button = document.querySelector('[data-testid="toggle-1"]');
      if (button !== null) {
        const pressed = button.getAttribute("aria-pressed");
        if (initial === undefined) {
          initial = pressed;
          new MutationObserver((_, observer) => {
            const current = document.querySelector('[data-testid="toggle-1"]');
            if (current !== null && current.getAttribute("aria-pressed") !== initial) {
              bench.interactiveAt ??= performance.now();
              observer.disconnect();
            }
          }).observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
          });
        }
        button.click();
      }
      setTimeout(probe, 16);
    };
    setTimeout(probe, 0);
  }
})();
