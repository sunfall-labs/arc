import { describe, expect, it } from "vitest";
import {
  mergeQueryContextIdentities,
  queryContextOrderIdentity,
  querySourceContextIdentity
} from "../src/query-context-identity.js";

describe("Query Context Identity", () => {
  it("distinguishes source key types", () => {
    expect(querySourceContextIdentity("project", "1")).not.toBe(
      querySourceContextIdentity("project", 1)
    );
  });

  it("distinguishes self-join aliases for the same key", () => {
    expect(querySourceContextIdentity("owner", "1")).not.toBe(
      querySourceContextIdentity("assignee", "1")
    );
  });

  it("merges source identities without delimiter collisions", () => {
    const first = mergeQueryContextIdentities(
      querySourceContextIdentity("a", "x:y"),
      querySourceContextIdentity("b", "z")
    );
    const second = mergeQueryContextIdentities(
      querySourceContextIdentity("a", "x"),
      querySourceContextIdentity("b", "y:z")
    );

    expect(first).not.toBe(second);
  });

  it("orders context identity by base sources before join aliases", () => {
    const identity = queryContextOrderIdentity(["base", "joined"], {
      joined: { $key: "joined-row" },
      base: { $key: "base-row" }
    });
    const expected = mergeQueryContextIdentities(
      querySourceContextIdentity("base", "base-row"),
      querySourceContextIdentity("joined", "joined-row")
    );

    expect(identity).toBe(expected);
  });

  it("returns undefined when no source row exposes a collection key", () => {
    expect(queryContextOrderIdentity(["base", "joined"], {
      base: { id: "base-row" },
      joined: { id: "joined-row" }
    })).toBeUndefined();
  });
});
