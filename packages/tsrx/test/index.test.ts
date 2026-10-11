import { describe, expect, it } from "vitest";
import { sunfallArcTsrx } from "../src/index.js";

describe("sunfallArcTsrx", () => {
  it("keeps dependency discovery policy dev-server scoped before transform plugins", () => {
    const plugins = sunfallArcTsrx();
    const dependencyPolicy = plugins[0] as {
      readonly name: string;
      readonly apply?: string;
      readonly config?: () => unknown;
    };

    expect(plugins).toHaveLength(4);
    expect(dependencyPolicy.name).toBe("sunfall-arc-tsrx-deps");
    expect(dependencyPolicy.apply).toBe("serve");
    expect(dependencyPolicy.config?.()).toEqual({
      optimizeDeps: {
        include: ["solid-js > @solidjs/signals"],
        noDiscovery: true,
      },
    });
  });

  it("defaults Vitest projects without an environment to the server posture", () => {
    const environmentPolicy = sunfallArcTsrx()[1] as {
      readonly name: string;
      readonly enforce?: string;
      readonly config?: (
        config: Record<string, unknown>,
        env: { readonly mode: string },
      ) => unknown;
    };

    expect(environmentPolicy.name).toBe("sunfall-arc-tsrx-test-environment");
    expect(environmentPolicy.enforce).toBe("pre");
    expect(environmentPolicy.config?.({}, { mode: "test" })).toEqual({
      test: { environment: "node" },
    });
    expect(
      environmentPolicy.config?.({ test: { environment: "happy-dom" } }, { mode: "test" }),
    ).toEqual({});
    expect(environmentPolicy.config?.({}, { mode: "development" })).toEqual({});
  });

  it("lets callers opt back into Vite dependency discovery without splitting Solid's runtime", () => {
    const dependencyPolicy = sunfallArcTsrx({
      optimizeDeps: {
        noDiscovery: false,
      },
    })[0] as {
      readonly config?: () => unknown;
    };

    expect(dependencyPolicy.config?.()).toEqual({
      optimizeDeps: {
        include: ["solid-js > @solidjs/signals"],
      },
    });
  });
});
