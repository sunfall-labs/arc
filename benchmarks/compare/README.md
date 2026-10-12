# Framework comparison benchmark

One small app, built three times: with Arc, SolidStart, and TanStack Start
(React). The harness in `scripts/` builds each one for production, runs its
Node server, and measures bundle size, SSR throughput, browser load metrics,
client update speed, and memory. Results and methodology:
[`docs/benchmarks.md`](../../docs/benchmarks.md).

Each app is an isolated project with its own `package.json`,
`pnpm-workspace.yaml` (which makes it its own pnpm root), and lockfile. None of
them is part of the monorepo workspace or of `pnpm verify`.

```sh
node benchmarks/compare/scripts/setup.mjs   # install all four projects, pack Arc, build the apps
node benchmarks/compare/scripts/run.mjs     # measure; writes results/*.json and results/*.md
```

## The app contract

All three apps implement exactly this; the harness relies on it.

- Data: `shared/data.ts` (server only) builds 1,000 deterministic items and
  holds them in one in-memory store per server process. `shared/model.ts` is
  the client-safe half: the `Item` type and the formatting helpers.
- Styling: `shared/styles.css`, imported once by each app.
- Server: production build, Node server, `PORT` from the environment, bound to
  `127.0.0.1`. No response compression, no extra caching headers beyond the
  framework's defaults for its own static assets.

### `/` (list)

Loaded on the server with the framework's idiomatic data primitive, server
rendered, then hydrated. Markup inside the body:

```html
<div class="shell">
  <header class="topbar"><a class="brand" href="/">Inventory</a></header>
  <main class="page">
    <section class="list-page">
      <div class="toolbar">
        <h1>Items</h1>
        <input
          class="filter"
          type="search"
          placeholder="Filter by name"
          aria-label="Filter by name"
          data-testid="filter"
        />
        <p class="count" data-testid="count">1000 of 1000 items</p>
      </div>
      <ul class="items" data-testid="items">
        <li class="item" data-id="1" data-done="false">
          <a class="item-name" href="/items/1">Amber anchor 1</a>
          <span class="item-category">tools</span>
          <span class="item-price">$12.34</span>
          <button type="button" class="toggle" data-testid="toggle-1" aria-pressed="false">
            Open
          </button>
        </li>
        <!-- … one li per visible item, in id order … -->
      </ul>
    </section>
  </main>
</div>
```

- The filter is client-only state (not in the URL). Each input event filters
  the already-loaded list with `matchesQuery` and updates the count with
  `countLabel`. No debounce, no deferred rendering.
- Toggle: the framework's server mutation primitive, with optimistic UI where
  that is idiomatic. The row's `data-done`, `aria-pressed`, and label flip at
  once; after the server answers, the framework's idiomatic revalidation runs
  (whatever it does by default or by its documented pattern).
- Item links navigate client-side with the framework's link component.

### `/items/:id` (detail)

```html
<article class="detail" data-testid="detail" data-id="42">
  <h1>Quiet river 42</h1>
  <dl>
    <dt>Category</dt>
    <dd>garden</dd>
    <dt>Price</dt>
    <dd>$12.34</dd>
    <dt>Status</dt>
    <dd data-testid="status">Open</dd>
  </dl>
  <a class="back" href="/" data-testid="back">Back to items</a>
</article>
```

wrapped in the same `.shell` / `.topbar` / `main.page`. An unknown id renders,
in the same wrapper:

```html
<section class="not-found" data-testid="not-found">
  <h1>Item not found</h1>
  <p>No item with id 9999.</p>
  <a class="back" href="/" data-testid="back">Back to items</a>
</section>
```

with HTTP status 404 when the framework's idiomatic not-found path allows it
(the harness records the status each framework returns).
