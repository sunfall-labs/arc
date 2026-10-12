# Sunfall Arc Devtools Panel

This example is the checked app-shell integration for the browser-embeddable
devtools renderer.

Run it locally:

```sh
pnpm --filter @sunfall/arc-example-devtools-panel dev
```

Verify it:

```sh
pnpm --filter @sunfall/arc-example-devtools-panel verify
```

The example mounts `Devtools.Panels` into the DOM through
`Devtools.mountPanels(...)` inside an Effect scope. Use
[`../devtools-extension`](../devtools-extension) for the checked browser
extension shell.
