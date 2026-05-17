# Solid And React Adapters

Sunfall Arc keeps Resources, Actions, Programs, Routes, Collections, and runtime
ownership in renderer-independent core packages. The Solid and React adapters
exist to bridge that core model into each renderer's reactivity and lifecycle
rules.

## Shared Surface

Both adapters expose the same golden-path concepts:

- runtime providers and component scopes;
- Signal and Stream subscriptions;
- Resource reads, preload, refresh, and Suspense reads;
- Action submission handles;
- Program handles with model, failures, timeline, and dispatch APIs;
- browser router providers, outlets, links, typed navigation helpers, and route
  preload integration;
- collection and live-query handles through the matching DB adapter package.

Use `@sunfall/arc-solid` with `@sunfall/arc-solid-db` for Solid apps. Use
`@sunfall/arc-react` with `@sunfall/arc-react-db` for React apps.

## React Values

React hooks return direct values because React render already reruns when
`useSyncExternalStore(...)` observes a changed Sunfall Arc Signal.

```tsx
const project = useResource(ProjectById("atlas"));

return project.match({
  initial: () => <p>Loading</p>,
  pending: (previous) => <p>{previous?.name ?? "Loading"}</p>,
  success: (value) => <h1>{value.name}</h1>,
  failure: (error) => <p>{String(error)}</p>,
});
```

Program and DB handles follow the same shape:

```tsx
const counter = useProgram(CounterProgram);
const projects = useCollection(ProjectCollection);

counter.model;
projects.rows;
```

Effects returned by the handles are already bound to the nearest React runtime:

```tsx
const refresh = useRuntimeEffect();

<button onClick={() => refresh(project.refreshEffect())}>Refresh</button>;
```

## Solid Accessors

Solid hooks expose accessor-shaped values where the renderer expects fine-grain
reactive reads.

```tsx
const project = useResource(ProjectById("atlas"));

return project.match({
  initial: () => <p>Loading</p>,
  pending: (previous) => <p>{previous?.name ?? "Loading"}</p>,
  success: (value) => <h1>{value.name}</h1>,
  failure: (error) => <p>{String(error)}</p>,
});
```

Program and DB handles keep the same distinction:

```tsx
const counter = useProgram(CounterProgram);
const projects = useCollection(ProjectCollection);

counter.model();
projects.rows();
```

## Package And Test Shape

React starter apps use Vite's React plugin, Tailwind v4, shadcn-compatible
`components.json`, and can install Base UI from `@base-ui/react`. The checked
starter at `examples/react-starter` proves:

- route-owned Resource preload;
- Start SSR and browser hydration;
- shadcn CLI component installation;
- Base UI headless primitives styled through the same Tailwind layer;
- server-only leak scanning.

Workspace tests are split into renderer-specific Vitest projects so React TSX is
transformed by `@vitejs/plugin-react`, while Solid and TSRX tests keep the
Solid/TSRX transform chain.
