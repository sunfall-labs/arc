# Effect UI Devtools Extension

This checked package builds the browser-extension shell for the public
`DevtoolsPanels` renderer and the inspected-window bridge.

Verify it:

```sh
pnpm --filter @effect-ui/example-devtools-extension verify
```

The build emits a Manifest V3 extension with `devtools.html`, `panel.html`, and
`manifest.json` in `dist`. The panel uses `mountDevtoolsPanelsEffect(...)`, so
DOM lifecycle ownership stays inside an Effect scope before crossing the
browser-extension boundary. It renders checked sample facts as a fallback, then
polls the inspected page for live panel data through:

```ts
import { installDevtoolsBridgeEffect } from "@effect-ui/devtools"

yield* installDevtoolsBridgeEffect(() => ({
  panels: store.getPanels(),
  selectedPanelId: "requests",
  title: "Effect UI Devtools"
}))
```

The extension reads that value with `chrome.devtools.inspectedWindow.eval` and
updates the mounted panel through the public renderer contract.
