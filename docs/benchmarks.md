# Benchmarks: Arc, SolidStart, and TanStack Start

One small app, built three times with each framework's idiomatic tools, built
for production, served by Node, and measured the same way. The apps, the
harness, and the raw results are in
[`benchmarks/compare/`](../benchmarks/compare). One command reproduces all of
it.

The short version, after the optimizations described below: Arc now
server-renders the 1,000-row page fastest of the three and still settles a
mutation fastest. It still ships the most JavaScript, has the most blocking
time on load, uses the most memory, and costs the most server CPU for a small
page, each by a smaller margin than in the first run (kept under
[History](#history-the-first-run)).

## The app

The same app in all three, held to one [contract](../benchmarks/compare/README.md):

- `/` lists 1,000 items loaded on the server from an in-memory, deterministic
  dataset ([`shared/data.ts`](../benchmarks/compare/shared/data.ts)), server
  rendered, then hydrated. A filter input narrows the list on the client, and
  each row has a toggle button that calls a server mutation with an
  optimistic update.
- `/items/:id` shows one item; an unknown id shows a not-found view.
- Identical markup, the same stylesheet, the same data, the same formatting
  helpers ([`shared/model.ts`](../benchmarks/compare/shared/model.ts)).

Each framework uses its own idiomatic data and mutation path:

|                  | Arc                                                                                                                | SolidStart                                                                                                                                      | TanStack Start                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Reads            | `Resource` (with `rows`) preloaded by the route, server functions over RPC in the browser                          | `query` + `createAsync`, `"use server"` functions, route `preload`                                                                              | `createServerFn` + TanStack Query via `@tanstack/react-router-ssr-query`, `queryClient.query` in loaders, `useSuspenseQuery` |
| Toggle           | served `Action` with an `optimistic` row patch and `invalidates` tags                                              | `action` + `useSubmissions` for the optimistic flip; default revalidation, which the router sends back in the action's response (single flight) | `useMutation` with an `onMutate` cache patch and `onSettled` `invalidateQueries`                                             |
| After the toggle | refetches the list (one RPC)                                                                                       | the action response carries the refreshed list                                                                                                  | refetches the list                                                                                                           |
| Links            | `RouterLink`                                                                                                       | `<A>`                                                                                                                                           | `<Link>`                                                                                                                     |
| Not found        | route `error: ItemNotFound` with a typed failure view                                                              | `<HttpStatusCode code={404} />`                                                                                                                 | `notFound()` + `notFoundComponent`                                                                                           |
| Code splitting   | lazy `*.component.tsx` route modules                                                                               | per route, by default                                                                                                                           | per route, by default (`autoCodeSplitting`)                                                                                  |
| Node server      | `node dist/server/index.js`, the production server `vite build` emits (`serveMain` from `@sunfall/arc-start/node`) | Nitro `node-server` preset                                                                                                                      | Nitro `node-server` preset                                                                                                   |

Versions: Arc `0.1.0-alpha.1` (this repository, packed from `packages/*`), Solid
`2.0.0-rc.14`, Effect `4.0.3`; SolidStart `2.0.6` with `@solidjs/router` `1.0.0`
and Solid `1.9.17`; TanStack Start `1.168.61` with React Router `1.170.42`,
Query `5.104.2`, and React `19.3.0`. All three build with Vite `8.3.4`.
Nitro is `3.0.260903-beta`, which is npm's `latest` and what both frameworks'
docs use.

## What is measured, and how

All numbers come from [`scripts/run.mjs`](../benchmarks/compare/scripts/run.mjs).

- **Bytes on first visit.** Every JS, CSS, and HTML response the browser
  downloads for a first visit to `/` until the page is idle, including
  modulepreloads and the lazily loaded route chunk. Compressed by the harness
  with gzip level 9 and brotli quality 11 (no server compresses anything).
- **SSR.** [autocannon](https://github.com/mcollina/autocannon), 10
  connections, a 3 s warm-up then 10 s per route per round, against `/` and
  `/items/42`. Reported: requests per second, latency p50 and p99, and the
  server process's CPU time per request (user + system CPU from `ps` over the
  measured window, divided by requests served). CPU per request is the
  number to trust on a shared machine: it moves far less with other load than
  requests per second does.
- **Cold load of `/`.** Playwright Chromium (headless shell), a fresh browser
  context per load (cold HTTP cache), CPU throttled 4x through the DevTools
  protocol, no network throttling (localhost). Each server is warmed with 100
  requests first. TTFB is `responseStart`; FCP and LCP come from the
  standard performance entries; total blocking time is the Lighthouse
  definition (the part of every long task over 50 ms) summed from FCP until
  the page has been quiet for 500 ms.
- **First click handled.** A separate cold load with a probe injected before
  any page script: from the moment row 1's toggle exists, it clicks it every
  16 ms until the DOM reflects a click (`aria-pressed` flips). Clicks before
  hydration either do nothing (React) or are captured and replayed once
  hydration finishes (Solid's event replay); either way the first visible
  response is the measure. The time is from navigation start.
- **Client updates.** On a hydrated `/`, CPU throttled 4x, each timing runs
  from the input to the next frame after the DOM shows the result:
  typing `amber` one character at a time (5 input events, until the count
  and the row count match), clearing the filter (back to 1,000 rows),
  toggling 5 rows (median; the optimistic flip, and "settled": until no
  request is in flight and the DOM has not changed for 300 ms, counted from
  the first free main-thread moment after the last activity), and
  navigating list to `/items/42` and back by clicking the links in-page (a
  plain `element.click()`, so no hover preload starts first).
- **Memory.** Unthrottled, after two forced garbage collections, the used JS
  heap after loading `/` and after toggling rows 1 to 100 one at a time, each
  settled before the next.
- **Fairness.** Production builds, framework defaults, no tuning. Rounds are
  interleaved, and each round starts with a different framework. Every server
  is restarted for every round. Medians are reported with min–max ranges.

## Results

Run on 2026-10-12: Apple M5 Pro (18 cores, 48 GB), macOS 26 (Darwin 25.6.0),
Node 25.9.0, Chromium 156 headless shell, 7 interleaved rounds. Raw data:
[`results/2026-10-12-20-41.json`](../benchmarks/compare/results/2026-10-12-20-41.json).
Arc is this repository after the optimizations below; the first run, before
them, is kept in [History](#history-the-first-run).

> [!NOTE]
> The machine was shared: the 1-minute load average fell from 21 to 4 during
> the run. Ranges show the spread. CPU per request, bytes, and heap sizes are
> the stable numbers; the first run was taken under heavier load (12 to 35),
> so compare its absolute browser timings and requests per second with this
> run's only through the ratios between frameworks.

### First visit to `/`: bytes downloaded

| Metric     |      Arc |  SolidStart | TanStack Start |
| ---------- | -------: | ----------: | -------------: |
| JS files   |        6 |           5 |          **4** |
| JS, raw    | 416.9 KB | **96.8 KB** |       376.3 KB |
| JS, gzip   | 137.7 KB | **33.6 KB** |       120.5 KB |
| JS, brotli | 120.6 KB | **30.2 KB** |       105.8 KB |
| HTML, raw  | 424.2 KB |    470.6 KB |   **366.0 KB** |
| HTML, gzip |  40.5 KB |     43.2 KB |    **38.5 KB** |

### Timings

Median of 7 rounds; the range below each is min–max. Bold is the best median.

| Metric                                    |                                   Arc |                            SolidStart |                            TanStack Start |
| ----------------------------------------- | ------------------------------------: | ------------------------------------: | ----------------------------------------: |
| **SSR, `/` (1,000 rows)**                 |                                       |                                       |                                           |
| Server CPU per request                    |   **5.24 ms**<br><sub>4.43–9.03</sub> |    19.45 ms<br><sub>15.03–24.52</sub> |          7.75 ms<br><sub>6.98–11.18</sub> |
| Requests/s                                |         **324**<br><sub>131–397</sub> |               77<br><sub>52–101</sub> |                  134<br><sub>80–145</sub> |
| Latency p50                               |         **26 ms**<br><sub>22–67</sub> |           115 ms<br><sub>84–169</sub> |                66 ms<br><sub>57–111</sub> |
| Latency p99                               |        **65 ms**<br><sub>49–244</sub> |          263 ms<br><sub>187–439</sub> |              164 ms<br><sub>140–299</sub> |
| **SSR, `/items/42`**                      |                                       |                                       |                                           |
| Server CPU per request                    |       0.51 ms<br><sub>0.45–1.39</sub> |   **0.28 ms**<br><sub>0.17–0.43</sub> |           0.33 ms<br><sub>0.18–0.83</sub> |
| Requests/s                                |         2,765<br><sub>727–2,932</sub> |   **3,910**<br><sub>1,978–5,734</sub> |           3,436<br><sub>1,031–7,215</sub> |
| Latency p50                               |               2 ms<br><sub>2–12</sub> |            **1 ms**<br><sub>1–3</sub> |                    2 ms<br><sub>1–7</sub> |
| Latency p99                               |              12 ms<br><sub>8–39</sub> |              12 ms<br><sub>4–76</sub> |               **8 ms**<br><sub>3–43</sub> |
| **Cold load of `/`, CPU 4x slower**       |                                       |                                       |                                           |
| TTFB                                      |            **5 ms**<br><sub>4–8</sub> |             15 ms<br><sub>10–30</sub> |                   9 ms<br><sub>8–12</sub> |
| FCP (= LCP)                               |      **132 ms**<br><sub>120–140</sub> |          144 ms<br><sub>128–160</sub> |              148 ms<br><sub>128–152</sub> |
| First click handled                       |          309 ms<br><sub>294–331</sub> |      **264 ms**<br><sub>224–289</sub> |              289 ms<br><sub>284–317</sub> |
| Total blocking time                       |             61 ms<br><sub>52–73</sub> |                2 ms<br><sub>0–6</sub> |                **0 ms**<br><sub>0–0</sub> |
| **Client updates on `/`, CPU 4x slower**  |                                       |                                       |                                           |
| Filter: type `amber` (5 keystrokes)       |             75 ms<br><sub>70–94</sub> |         **65 ms**<br><sub>59–77</sub> |                 88 ms<br><sub>75–94</sub> |
| Filter: clear (back to 1,000 rows)        |           104 ms<br><sub>94–108</sub> |           100 ms<br><sub>90–105</sub> |            **95 ms**<br><sub>91–101</sub> |
| Toggle: optimistic row update             |   **10.5 ms**<br><sub>10.0–11.2</sub> |       14.7 ms<br><sub>13.9–15.4</sub> |           21.2 ms<br><sub>19.6–23.1</sub> |
| Toggle: settled (server + revalidation)   |         **25 ms**<br><sub>21–33</sub> |          131 ms<br><sub>122–142</sub> |                 35 ms<br><sub>33–38</sub> |
| Navigate list → detail                    |             41 ms<br><sub>31–53</sub> |             40 ms<br><sub>34–45</sub> |             **38 ms**<br><sub>32–45</sub> |
| Navigate detail → list                    |           114 ms<br><sub>95–129</sub> |           112 ms<br><sub>95–116</sub> |           **108 ms**<br><sub>83–144</sub> |
| **Memory on `/` (unthrottled, after GC)** |                                       |                                       |                                           |
| JS heap after load                        |       7.96 MB<br><sub>7.96–7.96</sub> |       6.25 MB<br><sub>6.25–6.25</sub> |       **5.27 MB**<br><sub>5.27–5.29</sub> |
| JS heap after 100 toggles                 |       9.42 MB<br><sub>9.41–9.43</sub> |   **7.44 MB**<br><sub>7.41–7.44</sub> |           7.44 MB<br><sub>7.43–7.45</sub> |
| 100 toggles, each settled                 | 12,476 ms<br><sub>12,387–12,499</sub> | 13,307 ms<br><sub>13,135–13,554</sub> | **11,668 ms**<br><sub>11,408–12,405</sub> |

### Arc before and after

Arc's numbers in the first run and in this one, with each framework's
standing relative to the best of the other two (lower is better; 1.0x means
level with it). The ratios are the comparable figures across the two runs.

| Metric                                  | First run | This run | vs best other, first run | vs best other, this run |
| --------------------------------------- | --------: | -------: | -----------------------: | ----------------------: |
| JS, brotli                              |  130.2 KB | 120.6 KB |                     4.3x |                    4.0x |
| SSR `/`: server CPU per request         |  19.62 ms |  5.24 ms |                     1.8x |  0.68x (fastest of all) |
| SSR `/items/42`: server CPU per request |   1.62 ms |  0.51 ms |                     3.8x |                    1.8x |
| First click handled (4x)                |    627 ms |   309 ms |                     1.5x |                    1.2x |
| Total blocking time (4x)                |    259 ms |    61 ms |          7.8x (vs 33 ms) |           30x (vs 2 ms) |
| JS heap after load                      |  11.57 MB |  7.96 MB |                     2.2x |                    1.5x |
| Navigate detail → list (4x)             |    263 ms |   114 ms |                     1.3x |                    1.1x |

### Correctness

| Check                  |     Arc | SolidStart | TanStack Start |
| ---------------------- | ------: | ---------: | -------------: |
| `/items/9999` status   | **500** |        404 |            404 |
| `/` HTML bytes         | 434,389 |    481,859 |        374,805 |
| Filter `amber` matches |      51 |         51 |             51 |

## Read the table honestly

**Arc now server-renders the 1,000-row page fastest.** 5.2 ms of CPU per
render against 7.8 ms for TanStack Start and 19.5 ms for SolidStart, with the
best requests per second and latency. Before the optimizations it was 1.8x
TanStack Start. `RouterLink` was half of that render, and every copy of the
hydration payload was a copy of 1,000 rows.

**Arc still loses the first load, by less.** It downloads 4x SolidStart's
JavaScript (121 KB brotli against 30 KB) and 1.14x TanStack Start's. A click
is handled 45 ms after SolidStart's and 20 ms after TanStack Start's (309 ms
against 264 ms and 289 ms at 4x), where it was about 200 ms behind. Total
blocking time is 61 ms against 2 ms and 0 ms: two long tasks remain,
evaluating the Effect-heavy chunk and hydrating the rows, and the other two
frameworks break theirs up or have less to do. FCP is a wash.

**Arc still loses server rendering of a small page, by less.** `/items/42`
costs 0.51 ms of CPU against 0.28 ms (SolidStart) and 0.33 ms (TanStack
Start): 1.8x, down from 3.8x. What remains is per-request Effect and
framework overhead (see below), not rendering.

**Arc wins the mutation, as before.** The optimistic flip paints in 10.5 ms
(SolidStart 14.7 ms, TanStack Start 21.2 ms) and the toggle settles, server
and revalidation included, in 25 ms (TanStack Start 35 ms, SolidStart 131
ms), for the reasons the first run gave: the Action patches one row, and the
reloaded list shares unchanged rows by identity.

**Client re-rendering is level now.** Clearing the filter (1,000 rows back)
and returning to the list from a detail page are within 10 ms of the others;
both were Arc's weak spots, mostly because every re-created row built a
`RouterLink` with its memos, effect, and preloader.

**Arc still uses the most memory, by less.** 7.96 MB of JS heap after load
against 6.25 MB and 5.27 MB, down from 11.57 MB. Per row it is about 5.4 KB
(SolidStart about 5 KB, TanStack Start 3.4 KB); the rest is the Effect
runtime and Arc's stores, about 2.6 MB on the detail page.

**Arc answers an unknown item with 500.** The compare app ends its preload
with the route's typed failure, which Start answers with 500. `Route.notFound()`
(added since the first run) is the way to answer 404; the app has not been
changed to use it, so this check still differs.

## What changed

Each change was measured on its own against the commit before it: A/B runs of
the compare app (interleaved, on a loaded machine) and in-process request
timing (server CPU per request, 60 batches, P-core-limited minimum and
quartiles). The numbers are in each change's CHANGELOG entry.

1. **`RouterLink` is cheap.** The server renders a plain `<a href>`; in the
   browser the hover/focus preloader, its effect, and its cleanup are created
   on the first intent, the anchor is one static element instead of a
   `<Dynamic>` (two memos), and route patterns are parsed once. Behavior
   moved to a prototype, so a link holds one object and four functions. On
   `/`: server CPU per render 18.2 to 10.3 ms, JS heap after load 12.0 to
   8.25 MB, first click 528 to 455 ms in an A/B run.
2. **Live queries moved to `@sunfall/arc-solid/live-query`.** The `Component`
   namespace cannot be tree-shaken, so `Component.liveQuery` shipped
   `@sunfall/arc-db`, `@tanstack/db-ivm`, and `fractional-indexing` to every
   app. Now `LiveQuery.bind` from its own entry: 153.3 to 140.5 KB gzip of JS
   for this app.
3. **A production server build.** `vite build` builds the client and a server
   whose `dist/server/index.js` serves the app (`serveMain` from
   `@sunfall/arc-start/node`), with `modulepreload` for the entry and the
   matched route's lazy chunk. The route chunk started downloading at about
   300 ms (after the entry ran) and now starts with the entry at about 25 ms.
   The compare app's hand-written `server.mjs` is gone.
4. **Lower fixed cost per request.** A Resource Store creates its event
   `PubSub` for its first subscriber (an SSR request's store never allocates
   it), the Node adapter copies the body to the response directly instead of
   `stream.pipeline` over `Readable.fromWeb` (no `DOMException` per request),
   and route lists are ordered once. `/items/42` in process: median 0.93 to
   0.78 ms.
5. **Hydration payloads are copied once.** Validation no longer deep-copies
   snapshots; the server copied the 1,000 rows four times, the browser
   validated the payload twice. `/` in process: p25 6.2 to 5.3 ms.

Measured and not changed:

- **Lazy-loading Effect in the browser.** The RPC client and HTTP stack are
  about 25 KB of the 417 KB of JS, and evaluating the whole entry chunk that
  holds them costs about 4–5 ms at 4x throttle. Loading them on first use
  would save a few milliseconds before hydration and add a chunk request to
  the first server call, so they stay.
- **Per-row memory.** Of about 5.4 KB per row, the remaining cost is Solid's
  own nodes (the row's owner, its render effects, and the keyed `<For>`
  entry) and the Resource reader's fine-grained projection: each row object
  is a store proxy with a signal per property read, which is what lets a
  toggle update one cell. Rendering rows from plain values instead would
  change how every Resource reaches render code; it is not a clean fix.

## What Arc still pays for

- **The browser's first task.** The entry chunk is 417 KB raw: Effect is 44%
  (the fiber runtime, `Schema`/`SchemaAST`, `PubSub`, `Queue`, `Stream`,
  `Cache`), Arc core 26%, Solid 2's `@solidjs/signals` 16%. Evaluating it and
  starting the runtime is one long task; hydrating the 1,000 rows (about 66
  ms at 4x, mostly inside Solid's keyed `<For>` and the row projection) is
  the other.
- **Per-request Effect overhead on the server.** On `/items/42`,
  `renderToString` is about a third of the request. Most of the rest is
  Effect fibers (request runtime, preload, hydration plan, response
  lifecycle) and the Web stream between Start's HTML stream and the Node
  response (about 10%). Writing a fully rendered document to Node without a
  Web stream is the next candidate.

## History: the first run

The first run, before the changes above, on the same machine under heavier
load (1-minute load average 12 to 35). Raw data:
[`results/2026-10-12-19-08.json`](../benchmarks/compare/results/2026-10-12-19-08.json).

| Metric                                  |       Arc |  SolidStart | TanStack Start |
| --------------------------------------- | --------: | ----------: | -------------: |
| JS, brotli                              |  130.2 KB | **30.2 KB** |       105.8 KB |
| SSR `/`: server CPU per request         |  19.62 ms |    24.00 ms |   **11.07 ms** |
| SSR `/items/42`: server CPU per request |   1.62 ms | **0.43 ms** |        0.67 ms |
| FCP (4x)                                |    192 ms |      212 ms |         216 ms |
| First click handled (4x)                |    627 ms |  **407 ms** |         450 ms |
| Total blocking time (4x)                |    259 ms |       33 ms |       **5 ms** |
| Filter: clear (4x)                      |    208 ms |      150 ms |     **147 ms** |
| Toggle: settled (4x)                    | **61 ms** |      215 ms |          70 ms |
| Navigate detail → list (4x)             |    263 ms |      205 ms |     **200 ms** |
| JS heap after load                      |  11.57 MB |     6.25 MB |    **5.27 MB** |

Its profiles found what the changes above address: `RouterLink` was 56% of
the `/` render on the server and 131 ms of hydrating the rows, the live-query
packages shipped unused, the route chunk was a request waterfall, and the
small page paid for a 1,024-slot `PubSub`, a `stream.pipeline`, and
repeated payload copies on every request.

## Reproduce

Requirements: Node 24 or newer, pnpm 10, and about 1 GB of disk for the four
isolated installs and Chromium.

```sh
pnpm install
node benchmarks/compare/scripts/setup.mjs   # build + pack Arc, install and build the three apps, install the harness
node benchmarks/compare/scripts/run.mjs     # about 20 minutes with --rounds=7
```

`run.mjs` takes `--rounds=N`, `--ssr-seconds=N`, `--only=arc,solid-start`,
and `--phases=contract,transfer,ssr,browser`. It writes
`benchmarks/compare/results/<date>.json` and `.md` and refreshes
`results/latest.{json,md}`. The run stops early if any app breaks the
contract (1,000 rows, the detail and not-found views, a toggle that sticks).
For the steadiest numbers, close other work first; the load average is
recorded with every sample.

The apps are standalone projects with their own `pnpm-workspace.yaml` and
lockfile. They are not part of the monorepo workspace or `pnpm verify`. Arc is
installed from tarballs packed from `packages/*`, the way an app gets it from
npm.
