# Effect UI Devtools Extension

This checked package builds the browser-extension shell for the public
`DevtoolsPanels` renderer.

Verify it:

```sh
pnpm --filter @effect-ui/example-devtools-extension verify
```

The build emits a Manifest V3 extension with `devtools.html`, `panel.html`, and
`manifest.json` in `dist`. The panel uses `mountDevtoolsPanelsEffect(...)`, so
DOM lifecycle ownership stays inside an Effect scope before crossing the
browser-extension boundary.
