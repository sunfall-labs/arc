import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Resource, makeResourceDefinitionRegistry, type AnyResourceFamily } from "../src/index.js";

let registryTestId = 0;

const registryName = (name: string): string =>
  `Resource.registry.${++registryTestId}.${name}`;

describe("Resource definition registry", () => {
  it("preserves replacing global resource definitions and records duplicate diagnostics", () => {
    const familyName = registryName("duplicate-family");
    const First = Resource.family({
      name: familyName,
      load: () => Effect.succeed(1)
    });
    const Second = Resource.family({
      name: familyName,
      load: () => Effect.succeed(2)
    });
    const tagName = registryName("duplicate-tag");
    Resource.tag(tagName);
    Resource.tag(tagName);

    expect(Resource.definitions().get(familyName)).toBe(Second.family);
    expect(Resource.definitions().get(familyName)).not.toBe(First.family);
    expect(Resource.registryDiagnostics().duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "family",
          name: familyName,
          policy: "replace"
        }),
        expect.objectContaining({
          kind: "tag",
          name: tagName,
          policy: "replace"
        })
      ])
    );
  });

  it("can create an isolated keep-first registry adapter with store-first hydration lookup", () => {
    const name = registryName("isolated");
    const first = {
      options: { name }
    } as unknown as AnyResourceFamily;
    const second = {
      options: { name }
    } as unknown as AnyResourceFamily;
    const registry = makeResourceDefinitionRegistry({ duplicates: "keep-first" });

    registry.registerFamily(name, first);
    const registration = registry.registerFamily(name, second);

    expect(registration).toMatchObject({
      kind: "family",
      name,
      duplicate: true,
      retained: first
    });
    expect(registry.definitions().families.get(name)).toBe(first);
    expect(registry.lookupHydrationFamily(name)).toBe(first);
    expect(registry.lookupHydrationFamily(name, {
      store: { families: new Map([[name, second]]) }
    })).toBe(second);
    expect(registry.diagnostics().duplicates).toEqual([
      {
        kind: "family",
        name,
        policy: "keep-first",
        retained: 1,
        discarded: 2
      }
    ]);
  });
});
