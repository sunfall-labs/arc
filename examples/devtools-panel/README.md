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
`mountDevtoolsPanelsEffect(...)` inside an Effect scope. Use
[`../devtools-extension`](../devtools-extension) for the checked browser
extension shell.
