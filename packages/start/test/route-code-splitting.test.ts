import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sunfallArcStart } from "../src/vite.js";
import {
  loadStartRouteComponentSplitModule,
  resolveStartRouteComponentSplitModuleId,
  transformStartRouteAutoCodeSplitting,
} from "../src/route-code-splitting.js";

const splitImportId = (transformed: string): string => {
  const match = transformed.match(/import\("([^"]+)"\)/);
  expect(match?.[1]).toBeDefined();
  return match?.[1] ?? "";
};

const homeRouteModule = (...lines: readonly string[]): string =>
  ['import { Route } from "@sunfall/arc-core";', ...lines].join("\n");

describe("Start route code splitting", () => {
  it("rewrites imported Route.withComponent components into lazy split modules", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        'import { HomePage } from "./HomePage.js";',
        "",
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    if (transformed === null) {
      return expect.fail("expected route code splitting to transform the module");
    }
    expect(transformed).toContain('import { Effect as __SunfallArcEffect } from "effect";');
    expect(transformed).not.toContain('import { HomePage } from "./HomePage.js";');
    expect(transformed).toContain(
      'Route.withComponent(Route.define("/"), Route.lazyComponent(__SunfallArcEffect.tryPromise({ try: () => import("virtual:sunfall-arc/route-component?',
    );
    expect(transformed).toContain("source=%2Fsrc%2FHomePage.js");
    expect(transformed).toContain("import=HomePage");
    expect(transformed).toContain("export=HomePage");
  });

  it("keeps the props mapper and splits aliased Route imports", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      [
        'import { Route as CoreRoute } from "@sunfall/arc-core";',
        'import { ProjectPage } from "./ProjectPage.js";',
        'import { ProjectRoute } from "./routes.js";',
        "export const routes = [",
        "  CoreRoute.withComponent(ProjectRoute, ProjectPage, ({ params }) => ({ id: params.id, tags: [1, 2] })),",
        "] as const;",
      ].join("\n"),
      "/workspace/src/app.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toContain(
      "CoreRoute.withComponent(ProjectRoute, CoreRoute.lazyComponent(__SunfallArcEffect.tryPromise(",
    );
    expect(transformed).toContain(
      '"ProjectPage"), ({ params }) => ({ id: params.id, tags: [1, 2] })),',
    );
    expect(transformed).toContain('import { ProjectRoute } from "./routes.js";');
    expect(transformed).not.toContain("./ProjectPage.js");
  });

  it("resolves TypeScript sources for the split chunk", () => {
    const root = mkdtempSync(join(tmpdir(), "sunfall-arc-route-split-source-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "src", "ProjectPage.tsx"),
        "export const ProjectPage = () => null;\n",
      );
      const transformed = transformStartRouteAutoCodeSplitting(
        homeRouteModule(
          'import { ProjectPage } from "./ProjectPage.js";',
          'export const ProjectRoute = Route.withComponent(Route.define("/"), ProjectPage);',
        ),
        join(root, "src", "app.tsx"),
        { root },
      );
      expect(loadStartRouteComponentSplitModule(splitImportId(transformed ?? ""))).toBe(
        'export { ProjectPage } from "/src/ProjectPage.tsx";',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps component imports eager when the component identifier is used elsewhere", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        'import { HomePage } from "./HomePage.js";',
        "",
        "export const title = HomePage.title;",
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("ignores withComponent calls in strings and comments, and modules without Core's Route", () => {
    expect(
      transformStartRouteAutoCodeSplitting(
        homeRouteModule(
          'import { HomePage } from "./HomePage.js";',
          'export const example = "Route.withComponent(HomeRoute, HomePage)";',
          "// Route.withComponent(HomeRoute, HomePage)",
        ),
        "/workspace/src/docs.tsx",
        { root: "/workspace" },
      ),
    ).toBeNull();
    expect(
      transformStartRouteAutoCodeSplitting(
        [
          'import { Route } from "./local-route.js";',
          'import { HomePage } from "./HomePage.js";',
          'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
        ].join("\n"),
        "/workspace/src/routes.tsx",
        { root: "/workspace" },
      ),
    ).toBeNull();
  });

  it("serves virtual modules that re-export the split component", () => {
    const id =
      "virtual:sunfall-arc/route-component?source=%2Fsrc%2FHomePage.js&import=HomePage&export=HomePage";
    expect(resolveStartRouteComponentSplitModuleId(id)).toBe(`\0${id}`);
    expect(loadStartRouteComponentSplitModule(`\0${id}`)).toBe(
      'export { HomePage } from "/src/HomePage.js";',
    );
  });

  it("extracts same-file function components into generated virtual chunks", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        'import { Button } from "./Button.js";',
        'import "./styles.css";',
        'import { unused } from "./unused.js";',
        "",
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
        "",
        "function HomePage() {",
        "  return Button();",
        "}",
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    expect(transformed).not.toBeNull();
    expect(transformed).toContain("Route.lazyComponent");
    expect(transformed).not.toContain("function HomePage()");
    expect(transformed).not.toContain('import { Button } from "./Button.js";');
    // Imports the module already had and did not use are not the split's to drop.
    expect(transformed).toContain('import { unused } from "./unused.js";');
    expect(transformed).toContain('import "./styles.css";');

    const moduleId = splitImportId(transformed ?? "");
    const moduleCode = loadStartRouteComponentSplitModule(moduleId);
    expect(moduleCode).toBe(
      [
        'import { Button } from "/src/Button.js";',
        "",
        "export function HomePage() {",
        "  return Button();",
        "}",
      ].join("\n"),
    );
  });

  it("extracts same-file const components into generated virtual chunks", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
        "",
        'const HomePage = () => "Home";',
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    expect(transformed).not.toBeNull();
    expect(transformed).not.toContain('const HomePage = () => "Home";');

    const moduleId = splitImportId(transformed ?? "");
    expect(loadStartRouteComponentSplitModule(moduleId)).toBe(
      'export const HomePage = () => "Home";',
    );
  });

  it("keeps same-file components eager when they depend on module-local bindings", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        'const title = "Home";',
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
        "",
        "function HomePage() {",
        "  return title;",
        "}",
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("keeps same-file components eager when the component identifier is used elsewhere", () => {
    const transformed = transformStartRouteAutoCodeSplitting(
      homeRouteModule(
        "const alsoHome = HomePage;",
        'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
        "",
        "function HomePage() {",
        '  return "Home";',
        "}",
      ),
      "/workspace/src/routes.tsx",
      { root: "/workspace" },
    );

    expect(transformed).toBeNull();
  });

  it("applies automatic code splitting from the Start Vite transform to browser app modules only", () => {
    const plugin = sunfallArcStart({
      fileRouteOptions: { routeDirectory: "src/routes" },
    });
    plugin.config({ root: "/workspace" });
    plugin.configResolved({ root: "/workspace", command: "serve" });
    const code = homeRouteModule(
      'import { HomePage } from "./HomePage.js";',
      'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
    );

    expect(plugin.transform(code, "/workspace/src/App.tsx", { ssr: true })).toBeNull();
    expect(
      plugin.transform(code, "/workspace/node_modules/lib/index.js", { ssr: false }),
    ).toBeNull();
    expect(plugin.transform(code, "/elsewhere/src/App.tsx", { ssr: false })).toBeNull();
    const transformed = plugin.transform(code, "/workspace/src/App.tsx", { ssr: false });
    expect(transformed).toContain("Route.lazyComponent");
  });

  it("lets apps disable automatic route component splitting", () => {
    const plugin = sunfallArcStart({
      autoCodeSplitting: false,
      fileRouteOptions: { routeDirectory: "src/routes" },
    });
    plugin.config({ root: "/workspace" });
    plugin.configResolved({ root: "/workspace", command: "serve" });
    const code = homeRouteModule(
      'import { HomePage } from "./HomePage.js";',
      'export const HomeRoute = Route.withComponent(Route.define("/"), HomePage);',
    );

    expect(plugin.transform(code, "/workspace/src/App.tsx", { ssr: false })).toBeNull();
  });
});
