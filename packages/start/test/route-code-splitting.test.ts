import { describe, expect, it } from "vitest";
import {
  effectUiStart,
  loadStartRouteComponentSplitModule,
  resolveStartRouteComponentSplitModuleId,
  transformStartRouteAutoCodeSplitting,
} from "../src/vite.js";

const splitImportId = (transformed: string): string => {
  const match = transformed.match(/import\("([^"]+)"\)/);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
};

describe("Start route code splitting", () => {
  it("rewrites imported route components into lazy split modules", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { defineFileRoute } from "@effect-ui/start";',
        'import { HomePage } from "../HomePage.js";',
        "",
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toContain('import { Route as __EffectUiRoute } from "@effect-ui/core";');
    expect(transformed).toContain('import { Effect as __EffectUiEffect } from "effect";');
    expect(transformed).not.toContain('import { HomePage } from "../HomePage.js";');
    expect(transformed).toContain(
      'component: __EffectUiRoute.lazyComponent(__EffectUiEffect.tryPromise({ try: () => import("virtual:effect-ui/route-component?',
    );
    expect(transformed).toContain("source=%2Fsrc%2FHomePage.js");
    expect(transformed).toContain("import=HomePage");
    expect(transformed).toContain("export=HomePage");
  });

  it("keeps component imports eager when the component identifier is used elsewhere", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { defineFileRoute } from "@effect-ui/start";',
        'import { HomePage } from "../HomePage.js";',
        "",
        "export const title = HomePage.title;",
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("serves virtual modules that re-export the split component", () => {
    const id =
      "virtual:effect-ui/route-component?source=%2Fsrc%2FHomePage.js&import=HomePage&export=HomePage";
    expect(resolveStartRouteComponentSplitModuleId(id)).toBe(`\0${id}`);
    expect(loadStartRouteComponentSplitModule(`\0${id}`)).toBe(
      'export { HomePage } from "/src/HomePage.js";',
    );
  });

  it("extracts same-file function route components into generated virtual chunks", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { defineFileRoute } from "@effect-ui/start";',
        'import { Button } from "../Button.js";',
        "",
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
        "",
        "function HomePage() {",
        "  return Button();",
        "}",
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).not.toBeNull();
    expect(transformed).toContain("__EffectUiRoute.lazyComponent");
    expect(transformed).not.toContain("function HomePage()");
    expect(transformed).not.toContain('import { Button } from "../Button.js";');
    expect(transformed).toContain('import { defineFileRoute } from "@effect-ui/start";');

    const moduleId = splitImportId(transformed ?? "");
    const moduleCode = loadStartRouteComponentSplitModule(moduleId);
    expect(moduleCode).toBe(
      [
        'import { Button } from "../Button.js";',
        "export function HomePage() {",
        "  return Button();",
        "}",
      ].join("\n"),
    );
  });

  it("extracts same-file const route components into generated virtual chunks", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
        "",
        'const HomePage = () => "Home";',
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).not.toBeNull();
    expect(transformed).not.toContain('const HomePage = () => "Home";');

    const moduleId = splitImportId(transformed ?? "");
    expect(loadStartRouteComponentSplitModule(moduleId)).toBe(
      'export const HomePage = () => "Home";',
    );
  });

  it("keeps same-file components eager when they depend on route-local bindings", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { defineFileRoute } from "@effect-ui/start";',
        'const title = "Home";',
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
        "",
        "function HomePage() {",
        "  return title;",
        "}",
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("keeps same-file components eager when the component identifier is used elsewhere", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { defineFileRoute } from "@effect-ui/start";',
        "const alsoHome = HomePage;",
        'export const Route = defineFileRoute("/")({',
        "  component: HomePage,",
        "});",
        "",
        "function HomePage() {",
        '  return "Home";',
        "}",
      ].join("\n"),
      "/workspace/src/routes/index.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("applies automatic code splitting from the Start Vite transform in browser builds only", () => {
    const plugin = effectUiStart({
      fileRouteOptions: { routeDirectory: "src/routes" },
    });
    plugin.config({ root: "/workspace" });
    plugin.configResolved({ root: "/workspace", command: "serve" });
    const code = [
      'import { defineFileRoute } from "@effect-ui/start";',
      'import { HomePage } from "../HomePage.js";',
      'export const Route = defineFileRoute("/")({ component: HomePage });',
    ].join("\n");

    expect(plugin.transform(code, "/workspace/src/routes/index.tsx", { ssr: true })).toBeNull();
    const transformed = plugin.transform(code, "/workspace/src/routes/index.tsx", {
      ssr: false,
    });
    expect(transformed).toContain("__EffectUiRoute.lazyComponent");
  });

  it("lets apps disable automatic route component splitting", () => {
    const plugin = effectUiStart({
      autoCodeSplitting: false,
      fileRouteOptions: { routeDirectory: "src/routes" },
    });
    plugin.config({ root: "/workspace" });
    plugin.configResolved({ root: "/workspace", command: "serve" });
    const code = [
      'import { defineFileRoute } from "@effect-ui/start";',
      'import { HomePage } from "../HomePage.js";',
      'export const Route = defineFileRoute("/")({ component: HomePage });',
    ].join("\n");

    expect(plugin.transform(code, "/workspace/src/routes/index.tsx", { ssr: false })).toBeNull();
  });
});
