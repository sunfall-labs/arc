import { describe, expect, it } from "vitest";
import { effectUiTsrx } from "../src/index.js";

describe("effectUiTsrx", () => {
  it("keeps dependency discovery policy dev-server scoped before transform plugins", () => {
    const plugins = effectUiTsrx();
    const dependencyPolicy = plugins[0] as {
      readonly name: string;
      readonly apply?: string;
      readonly config?: () => unknown;
    };

    expect(plugins).toHaveLength(3);
    expect(dependencyPolicy.name).toBe("effect-ui-tsrx-deps");
    expect(dependencyPolicy.apply).toBe("serve");
    expect(dependencyPolicy.config?.()).toEqual({
      optimizeDeps: {
        noDiscovery: true,
      },
    });
  });

  it("lets callers opt back into Vite dependency discovery", () => {
    const dependencyPolicy = effectUiTsrx({
      optimizeDeps: {
        noDiscovery: false,
      },
    })[0] as {
      readonly config?: () => unknown;
    };

    expect(dependencyPolicy.config?.()).toEqual({});
  });
});
