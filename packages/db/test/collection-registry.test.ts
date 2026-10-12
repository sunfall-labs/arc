import { Collection } from "@sunfall/arc-db";
import type { KeyValueStore } from "effect/persistence";
import {
  defaultCollectionDefinitionRegistry,
  defineCollection,
  makeCollectionDefinitionRegistry,
} from "@sunfall/arc-db/internal";
import { describe, expect, it } from "vitest";

interface Project {
  readonly id: string;
  readonly status: "active" | "blocked";
}

const projectOptions = (
  name: string,
  status: Project["status"] = "active",
): Collection.Options<Project, string> => ({
  name,
  getKey: (project) => project.id,
  initialData: [{ id: status, status }],
});

describe("Collection registry", () => {
  it("replaces a definition redefined under the same name", () => {
    const registry = makeCollectionDefinitionRegistry();
    const name = "Projects.registry.duplicate";
    defineCollection<Project>(projectOptions(name, "active"), registry);
    const Second = defineCollection<Project>(projectOptions(name, "blocked"), registry);

    expect(registry.definitions().get(name)).toBe(Second);
    expect(defaultCollectionDefinitionRegistry.definitions().get(name)).toBeUndefined();
  });

  it("treats re-registering the same definition as a no-op", () => {
    const registry = makeCollectionDefinitionRegistry();
    const Projects = defineCollection<Project>(
      projectOptions("Projects.registry.same-definition"),
      registry,
    );

    registry.register(Projects);

    expect(registry.diagnostics().collections).toEqual([
      expect.objectContaining({ name: "Projects.registry.same-definition" }),
    ]);
  });

  it("keys registrations by the collection definition name", () => {
    const sourceRegistry = makeCollectionDefinitionRegistry();
    const registry = makeCollectionDefinitionRegistry();
    const Projects = defineCollection<Project>(
      projectOptions("Projects.registry.normalized-name"),
      sourceRegistry,
    );

    registry.register(Projects);

    expect(registry.definitions().get("Projects.registry.normalized-name")).toBe(Projects);
  });

  it("returns detached definition views that cannot mutate registry state", () => {
    const registry = makeCollectionDefinitionRegistry();
    const name = "Projects.registry.detached-definitions";
    const Projects = defineCollection<Project>(projectOptions(name), registry);
    const view = registry.definitions() as Map<string, unknown>;

    view.clear();
    view.set("Projects.registry.injected", Projects);

    expect(registry.definitions().get(name)).toBe(Projects);
    expect(registry.definitions().get("Projects.registry.injected")).toBeUndefined();
    expect(registry.diagnostics().collections).toEqual([expect.objectContaining({ name })]);
  });

  it("registers Collection.define definitions in the default registry", () => {
    const name = "Projects.registry.default-detached-definitions";
    const Projects = Collection.define<Project>(projectOptions(name));
    const view = defaultCollectionDefinitionRegistry.definitions() as Map<string, unknown>;

    view.delete(name);

    expect(defaultCollectionDefinitionRegistry.definitions().get(name)).toBe(Projects);
    expect(defaultCollectionDefinitionRegistry.diagnostics().collections).toEqual(
      expect.arrayContaining([expect.objectContaining({ name })]),
    );
  });

  it("reports effective persistence defaults in diagnostics", () => {
    const registry = makeCollectionDefinitionRegistry();
    defineCollection<
      Project,
      string,
      KeyValueStore.KeyValueStoreError,
      KeyValueStore.KeyValueStore
    >(
      {
        ...projectOptions("Projects.registry.persistence-defaults"),
        persistence: {},
      },
      registry,
    );

    expect(registry.diagnostics().collections).toEqual([
      expect.objectContaining({
        name: "Projects.registry.persistence-defaults",
        persistence: {
          enabled: true,
          hydrate: true,
          restoreOnPreload: true,
          loadAfterRestore: false,
          persistOnLoad: true,
          persistOnWrite: true,
        },
      }),
    ]);
  });

  it("reports disabled persistence defaults in diagnostics", () => {
    const registry = makeCollectionDefinitionRegistry();
    defineCollection<Project>(projectOptions("Projects.registry.no-persistence"), registry);

    expect(registry.diagnostics().collections).toEqual([
      expect.objectContaining({
        name: "Projects.registry.no-persistence",
        persistence: {
          enabled: false,
          hydrate: false,
          restoreOnPreload: false,
          loadAfterRestore: false,
          persistOnLoad: false,
          persistOnWrite: false,
        },
      }),
    ]);
  });

  it("reports the backing sync adapter", () => {
    const registry = makeCollectionDefinitionRegistry();
    defineCollection<Project>(
      {
        ...projectOptions("Projects.registry.sync"),
        sync: { name: "projects-api", load: () => [] },
      },
      registry,
    );

    expect(registry.diagnostics().collections).toEqual([
      expect.objectContaining({
        name: "Projects.registry.sync",
        load: true,
        sync: { adapter: "projects-api" },
      }),
    ]);
  });
});
