# Benchmarks: Arc, SolidStart, and TanStack Start

One small app, built three times with each framework's idiomatic tools, built
for production, served by Node, and measured the same way. The apps, the
harness, and the raw results are in
[`benchmarks/compare/`](../benchmarks/compare). One command reproduces all of
it.

The short version: Arc is the slowest of the three to load, ships the most
JavaScript, uses the most memory, and costs the most server CPU for a small
page; on the 1,000-row page its server cost sits between the other two. It is
the fastest at the thing it is built around: a mutation with an optimistic
patch and a revalidation. The reasons are profiled below, and so are the fixes.

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

|                  | Arc                                                                                                                            | SolidStart                                                                                                                                      | TanStack Start                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Reads            | `Resource` (with `rows`) preloaded by the route, server functions over RPC in the browser                                      | `query` + `createAsync`, `"use server"` functions, route `preload`                                                                              | `createServerFn` + TanStack Query via `@tanstack/react-router-ssr-query`, `queryClient.query` in loaders, `useSuspenseQuery` |
| Toggle           | served `Action` with an `optimistic` row patch and `invalidates` tags                                                          | `action` + `useSubmissions` for the optimistic flip; default revalidation, which the router sends back in the action's response (single flight) | `useMutation` with an `onMutate` cache patch and `onSettled` `invalidateQueries`                                             |
| After the toggle | refetches the list (one RPC)                                                                                                   | the action response carries the refreshed list                                                                                                  | refetches the list                                                                                                           |
| Links            | `RouterLink`                                                                                                                   | `<A>`                                                                                                                                           | `<Link>`                                                                                                                     |
| Not found        | route `error: ItemNotFound` with a typed failure view                                                                          | `<HttpStatusCode code={404} />`                                                                                                                 | `notFound()` + `notFoundComponent`                                                                                           |
| Code splitting   | lazy `*.component.tsx` route modules                                                                                           | per route, by default                                                                                                                           | per route, by default (`autoCodeSplitting`)                                                                                  |
| Node server      | `@sunfall/arc-start/node` adapter plus a 70-line static file server ([`arc/server.mjs`](../benchmarks/compare/arc/server.mjs)) | Nitro `node-server` preset                                                                                                                      | Nitro `node-server` preset                                                                                                   |

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
[`results/2026-10-12-19-08.json`](../benchmarks/compare/results/2026-10-12-19-08.json).

> [!WARNING]
> This machine was not idle: other work kept the 1-minute load average
> between 12 and 35 through the run. Absolute requests per second and the browser
> timings are noisy because of it (see the ranges); CPU per request, bytes,
> and heap sizes are stable. An earlier 5-round run the same afternoon agreed
> on every finding below; the rows it ordered differently are called out as
> noise.

### First visit to `/`: bytes downloaded

| Metric     |      Arc |  SolidStart | TanStack Start |
| ---------- | -------: | ----------: | -------------: |
| JS files   |        6 |           5 |          **4** |
| JS, raw    | 454.4 KB | **96.8 KB** |       376.3 KB |
| JS, gzip   | 149.2 KB | **33.6 KB** |       120.5 KB |
| JS, brotli | 130.2 KB | **30.2 KB** |       105.8 KB |
| HTML, raw  | 425.0 KB |    470.6 KB |   **366.0 KB** |
| HTML, gzip |  40.4 KB |     43.2 KB |    **38.5 KB** |

### Timings

Median of 7 rounds; the range below each is min–max. Bold is the best median.

| Metric                                    |                                   Arc |                            SolidStart |                            TanStack Start |
| ----------------------------------------- | ------------------------------------: | ------------------------------------: | ----------------------------------------: |
| **SSR, `/` (1,000 rows)**                 |                                       |                                       |                                           |
| Server CPU per request                    |    19.62 ms<br><sub>12.13–21.08</sub> |    24.00 ms<br><sub>21.07–26.45</sub> |    **11.07 ms**<br><sub>10.40–12.31</sub> |
| Requests/s                                |               60<br><sub>34–129</sub> |                48<br><sub>31–63</sub> |                **78**<br><sub>41–94</sub> |
| Latency p50                               |           148 ms<br><sub>71–248</sub> |          166 ms<br><sub>143–258</sub> |          **112 ms**<br><sub>100–232</sub> |
| Latency p99                               |        395 ms<br><sub>142–1,159</sub> |          656 ms<br><sub>425–927</sub> |          **314 ms**<br><sub>218–678</sub> |
| **SSR, `/items/42`**                      |                                       |                                       |                                           |
| Server CPU per request                    |       1.62 ms<br><sub>0.66–1.79</sub> |   **0.43 ms**<br><sub>0.39–0.48</sub> |           0.67 ms<br><sub>0.49–0.73</sub> |
| Requests/s                                |           567<br><sub>424–1,946</sub> |   **1,998**<br><sub>1,060–2,828</sub> |             1,236<br><sub>884–2,153</sub> |
| Latency p50                               |              14 ms<br><sub>3–15</sub> |            **3 ms**<br><sub>2–4</sub> |                    6 ms<br><sub>3–6</sub> |
| Latency p99                               |            56 ms<br><sub>17–114</sub> |         **30 ms**<br><sub>12–75</sub> |                 46 ms<br><sub>15–85</sub> |
| **Cold load of `/`, CPU 4x slower**       |                                       |                                       |                                           |
| TTFB                                      |             20 ms<br><sub>13–79</sub> |            30 ms<br><sub>21–121</sub> |              **16 ms**<br><sub>8–57</sub> |
| FCP (= LCP)                               |      **192 ms**<br><sub>176–336</sub> |          212 ms<br><sub>160–324</sub> |              216 ms<br><sub>144–276</sub> |
| First click handled                       |          627 ms<br><sub>402–671</sub> |      **407 ms**<br><sub>324–542</sub> |              450 ms<br><sub>346–559</sub> |
| Total blocking time                       |          259 ms<br><sub>137–486</sub> |             33 ms<br><sub>23–74</sub> |               **5 ms**<br><sub>0–13</sub> |
| **Client updates on `/`, CPU 4x slower**  |                                       |                                       |                                           |
| Filter: type `amber` (5 keystrokes)       |          130 ms<br><sub>102–166</sub> |       **102 ms**<br><sub>73–149</sub> |              146 ms<br><sub>105–169</sub> |
| Filter: clear (back to 1,000 rows)        |          208 ms<br><sub>165–374</sub> |          150 ms<br><sub>128–212</sub> |          **147 ms**<br><sub>128–200</sub> |
| Toggle: optimistic row update             |   **17.3 ms**<br><sub>13.5–38.3</sub> |       21.6 ms<br><sub>19.0–31.0</sub> |           31.8 ms<br><sub>23.7–39.1</sub> |
| Toggle: settled (server + revalidation)   |        **61 ms**<br><sub>48–126</sub> |          215 ms<br><sub>186–254</sub> |                 70 ms<br><sub>44–93</sub> |
| Navigate list → detail                    |           144 ms<br><sub>73–288</sub> |           121 ms<br><sub>61–181</sub> |           **102 ms**<br><sub>58–142</sub> |
| Navigate detail → list                    |          263 ms<br><sub>193–397</sub> |          205 ms<br><sub>163–285</sub> |          **200 ms**<br><sub>159–284</sub> |
| **Memory on `/` (unthrottled, after GC)** |                                       |                                       |                                           |
| JS heap after load                        |    11.57 MB<br><sub>11.56–11.58</sub> |       6.25 MB<br><sub>6.25–6.25</sub> |       **5.27 MB**<br><sub>5.27–5.30</sub> |
| JS heap after 100 toggles                 |    12.95 MB<br><sub>12.94–12.99</sub> |   **7.44 MB**<br><sub>7.39–7.44</sub> |           7.45 MB<br><sub>7.44–7.47</sub> |
| 100 toggles, each settled                 | 13,868 ms<br><sub>13,410–14,475</sub> | 15,012 ms<br><sub>14,863–15,183</sub> | **12,265 ms**<br><sub>12,032–14,200</sub> |

### Correctness

| Check                  |     Arc | SolidStart | TanStack Start |
| ---------------------- | ------: | ---------: | -------------: |
| `/items/9999` status   | **500** |        404 |            404 |
| `/` HTML bytes         | 435,197 |    481,859 |        374,805 |
| Filter `amber` matches |      51 |         51 |             51 |

## Read the table honestly

**Arc loses the first load, clearly.** It downloads 4.3x SolidStart's
JavaScript (130 KB brotli against 30 KB) and 1.2x TanStack Start's, its total
blocking time is 259 ms against 33 ms and 5 ms, and a click is handled about
200 ms later than on the other two (627 ms against 407 ms and 450 ms, 4x
throttled). FCP is a wash: the server-rendered HTML paints at the same time in
all three, and the earlier run put SolidStart first; the 20 ms between them is
noise.

**Arc loses server rendering of a small page by 2.4x to 3.8x.** `/items/42`
costs 1.62 ms of server CPU in Arc, 0.67 ms in TanStack Start, and 0.43 ms in
SolidStart. That is fixed per-request overhead, not rendering: the page is a
dozen elements.

**On the 1,000-row page the server picture is mixed.** Arc spends 19.6 ms of
CPU per render, less than SolidStart (24.0 ms) and 1.8x TanStack Start (11.1
ms). Requests per second agree on the order here, but the earlier run ranked
Arc last at 24/s against 25/s and 30/s, which is how noisy that column is on a
loaded machine.

**Arc wins the mutation.** The optimistic row flip paints in 17 ms (SolidStart
22 ms, TanStack Start 32 ms), and the toggle is settled, server answer and
revalidated list included, in 61 ms (TanStack Start 70 ms, SolidStart 215 ms).
The reason is in the design: the Action patches one row of the Resource, and
the reloaded list is shared structurally with the old one, so unchanged rows
keep their identity and nothing re-renders. SolidStart's single-flight
response arrives fast, but `createAsync` hands back 1,000 fresh objects and the
keyed `<For>` re-creates every row; `createAsyncStore` would avoid that, but it
is not the default and was not used. TanStack Start's React re-render after
the refetch is cheap because React reconciles to the same DOM. Over 100
sequential toggles, the 300 ms-quiet settle rule makes the totals close
(TanStack Start 12.3 s, Arc 13.9 s, SolidStart 15.0 s).

**Re-rendering many rows is Arc's weak spot on the client.** Clearing the
filter (1,000 rows back) takes 208 ms against about 150 ms for both others,
and returning to the list from a detail page takes 263 ms against about 200
ms. Typing into the filter (rows going away) is between the two. List to
detail navigation is close in all three; the earlier run put Arc first.

**Arc uses about twice the memory.** 11.6 MB of JS heap after load against
6.3 MB and 5.3 MB; 100 toggles add about the same 1.4 MB in every framework, so
nothing leaks. On the detail page (no list) the heaps are 2.5 MB, 1.0 MB, and
1.8 MB: the gap is mostly per row, about 9 KB per row in Arc against 5 KB in
SolidStart and 3.4 KB in TanStack Start.

**Arc answers an unknown item with 500.** A route preload that fails with its
typed `error` renders the failure view, but Start sets status 500 for every
route preload failure, and an app cannot set 404 from the failure path (the
handler sets the status after preload, so `ResponseContext.setStatus(404)` in
the preload is overwritten). SolidStart and TanStack Start both return 404
idiomatically. Only a path whose params the route schema rejects gets 404 in
Arc.

## Why Arc loses: profiles

Profiles taken with the DevTools protocol (browser, 4x throttle, unminified
build) and `node --cpu-prof` (server, under autocannon), on the same apps.

### The browser load

- **Bundle composition.** Of Arc's 1.6 MB of unminified JS, Effect is 56%
  (912 KB: `Effect`, the fiber runtime, `Schema`/`SchemaAST`, `PubSub`,
  `Channel`, `Queue`, `Stream`, `Layer`, `Cache`, `RpcClient`), Arc core 16%,
  Solid 2's `@solidjs/signals` 12%. Arc ships **`@sunfall/arc-db`,
  `@tanstack/db-ivm`, and `fractional-indexing` (about 99 KB unminified, 24 KB
  gzip) to an app that never uses a live query**: `@sunfall/arc-solid`
  imports the live-query binding, and it does not tree-shake away.
- **Hydrating the rows.** Of about 570 ms of JS at 4x throttle (SolidStart:
  about 205 ms), hydrating the root is 322 ms, and 221 ms of that is the 1,000
  rows of the `<For>`. **`RouterLink` alone is 131 ms**: every link creates two
  memos, a render effect, and a hover preloader with its own Effect wiring,
  and parses the route pattern to build its `href`.
- **Startup work before hydration.** Evaluating the 424 KB chunk, building the
  runtime and its Layers, and validating and decoding the hydration payload
  (about 12 ms for the 1,000-row Resource snapshot, plus a structural clone of
  it) come before the first row hydrates.
- **A request waterfall.** Arc has no production server build, so the page
  only modulepreloads the entry's static imports. The matched route's lazy
  component chunk is discovered after the entry runs, one round trip later.
  SolidStart and TanStack Start preload the route's chunk from the HTML.

### The server

- **`/` (1,000 rows): `RouterLink` is 56% of the request.** In a profile of
  autocannon against `/`, `RouterLink` is 3.3 s of 5.9 s total request time.
  On the server it still builds the browser preloader
  (`makeBrowserRouterLinkPreloader`, `bindPreloadIdentity`: 0.9 s), runs a
  render effect that forks Effect programs (0.55 s in the Effect run loop),
  and rebuilds each `href` by parsing the route pattern (`buildRoutePath` and
  `parseRoutePathSegments`: 0.45 s). Validating and encoding the hydration
  snapshot of 1,000 rows is a further 0.3 s, and Web Streams plumbing about
  0.5 s.
- **`/items/42`: fixed per-request cost.** `renderToString` is only about 40%
  of the request. The rest is per-request setup and plumbing: converting the
  Node request to a Web `Request` and the streamed Web `Response` back
  through `stream.pipeline` (whose abort on finish constructs a
  `DOMException` on every request), a fresh request runtime with a Resource
  Store that allocates a 1,024-slot sliding `PubSub` per request, Effect fiber
  overhead around preload, hydration plan, and response lifecycle, and Solid
  2's server tracing (`traceFor`, which generates random trace ids per render,
  about 4% of request time).

## Proposed optimizations

Not made on the branch that measured them; each is a candidate for its own
change, and each can be checked by rerunning this benchmark.

1. **Make `RouterLink` cheap.** On the server, render a plain `<a href>` with no
   memos, effects, or preloader. In the browser, create the preloader lazily on
   the first `mouseenter`/`focus`, and drop the per-link render effect. Cache
   the parsed route pattern per route definition so `Route.href` does not
   reparse it. Expected: the largest single win on both SSR of `/` (up to
   about half the CPU) and hydration of `/` (about 130 ms of 570 ms at 4x).
2. **Keep `@sunfall/arc-db` out of apps that do not use live queries.** Move
   the live-query binding to a separate entry (`@sunfall/arc-solid/live-query`)
   or make it tree-shakable. About 24 KB gzip.
3. **Trim Effect from the browser path.** Audit which modules the client
   runtime pulls in (`PubSub`, `Channel`, `Queue`, `Stream`, `Cache`) and which
   could be lazy, for example the RPC client and Action transport until the
   first call, and the outbox until the first durable Action.
4. **Lighter per-request server setup.** Create the Resource Store's event
   `PubSub` lazily (or small) on the server; write the HTML stream to the Node
   response directly instead of `stream.pipeline` over a Web stream; reuse
   request-independent runtime parts across requests.
5. **Ship a production server build.** A `sunfallArcStart` build step that
   emits the SSR bundle and a Node entry wired to Vite's manifest, adding
   modulepreload for the matched route's lazy chunk to remove the waterfall.
   Today every app writes `server.mjs` itself.
6. **Let a typed route failure choose its status.** For example an
   `errorStatus` on `Route.define`, or letting `ResponseContext` set by the
   preload win over the default 500, so a missing item answers 404.
7. **Hydration payload.** Validate and decode the snapshot once, without the
   extra structural clone, and consider skipping schema validation of
   server-produced payloads in production.
8. **Per-row memory.** Most of Arc's extra heap is per row (about 9 KB against
   3 to 5 KB); fixing `RouterLink` (1) removes much of it.

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
