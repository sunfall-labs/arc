import { Collection, type CollectionOptions } from "@effect-ui/db";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly status: "active" | "blocked";
}

const projectOptions = (
  name: string,
  status: Project["status"] = "active"
): CollectionOptions<Project> => ({
  name,
  getKey: (project) => project.id,
  initialData: [
    { id: status, status }
  ]
});

describe("Collection registry", () => {
  it("keeps duplicate collection names deterministic inside an explicit registry", () => {
    const registry = Collection.makeRegistry();
    const name = "Projects.registry.keep-first";
    const First = Collection.define<Project>(projectOptions(name, "active"), registry);
    const Second = Collection.define<Project>(projectOptions(name, "blocked"), registry);

    expect(Second.name).toBe(name);
    expect(registry.definitions().get(name)).toBe(First);
    expect(Collection.definitions().get(name)).toBeUndefined();
    expect(registry.diagnostics()).toMatchObject({
      collections: [
        {
          name,
          initialData: true
        }
      ],
      duplicates: [
        {
          name,
          policy: "keep-first",
          retained: 1,
          discarded: 2
        }
      ]
    });
  });

  it("supports replacement through an explicit registry adapter policy", () => {
    const registry = Collection.makeRegistry({ duplicates: "replace" });
    const name = "Projects.registry.replace";
    Collection.define<Project>(projectOptions(name, "active"), registry);
    const Replacement = Collection.define<Project>(projectOptions(name, "blocked"), registry);

    expect(registry.definitions().get(name)).toBe(Replacement);
    expect(registry.diagnostics().duplicates).toEqual([
      {
        name,
        policy: "replace",
        retained: 2,
        discarded: 1
      }
    ]);
  });

  it("exposes the process-wide default registry through compatibility helpers", () => {
    const name = "Projects.registry.default-adapter";
    const Projects = Collection.define<Project>(projectOptions(name));

    expect(Collection.defaultRegistry.definitions().get(name)).toBe(Projects);
    expect(Collection.definitions().get(name)).toBe(Projects);
    expect(Collection.diagnostics().collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name })
      ])
    );
    expect(Collection.registryDiagnostics().collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name })
      ])
    );
  });
});
