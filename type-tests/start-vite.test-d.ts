import {
  effectUiStart,
  handleSsrDevRequestEffect,
  loadStartAppGraphDiagnosticsEffect,
  writeFileRouteDefinitionsFileEffect,
  type EffectUiStartPlugin,
  type StartDevServer
} from "@effect-ui/start/vite";

const viteExports: Array<unknown> = [
  effectUiStart,
  handleSsrDevRequestEffect,
  loadStartAppGraphDiagnosticsEffect,
  writeFileRouteDefinitionsFileEffect
];
type ViteTypes = EffectUiStartPlugin | StartDevServer;
void viteExports;
type _ViteTypes = ViteTypes;
