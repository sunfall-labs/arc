# Effect UI Devtools Panel

This example is the checked app-shell integration for the browser-embeddable
devtools renderer.

Run it locally:

```sh
pnpm --filter @effect-ui/example-devtools-panel dev
```

Verify it:

```sh
pnpm --filter @effect-ui/example-devtools-panel verify
```

The example mounts `DevtoolsPanels` into the DOM through
`mountDevtoolsPanels(...)`. It is intentionally smaller than a browser
extension; it proves the package renderer can be used by an app shell without
private runtime access.
