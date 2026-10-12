import { describe, expect, it } from "vitest";
import {
  mergeQueryContextIdentities,
  queryContextOrderIdentity,
  queryContextIdentityOf,
  queryRowIdentity,
  querySourceContext,
  querySourceContextIdentity,
  recordQueryRowKey,
} from "../src/query-context-identity.js";

describe("Query Context Identity", () => {
  it("distinguishes source key types", () => {
    expect(querySourceContextIdentity("project", "1")).not.toBe(
      querySourceContextIdentity("project", 1),
    );
  });

  it("distinguishes self-join aliases for the same key", () => {
    expect(querySourceContextIdentity("owner", "1")).not.toBe(
      querySourceContextIdentity("assignee", "1"),
    );
  });

  it("merges source identities without delimiter collisions", () => {
    const first = mergeQueryContextIdentities(
      querySourceContextIdentity("a", "x:y"),
      querySourceContextIdentity("b", "z"),
    );
    const second = mergeQueryContextIdentities(
      querySourceContextIdentity("a", "x"),
      querySourceContextIdentity("b", "y:z"),
    );

    expect(first).not.toBe(second);
  });

  it("orders context identity by base sources before join aliases", () => {
    const joined = { id: "joined-row" };
    const base = { id: "base-row" };
    recordQueryRowKey(joined, "joined-row");
    recordQueryRowKey(base, "base-row");
    const identity = queryContextOrderIdentity(["base", "joined"], { joined, base });
    const expected = mergeQueryContextIdentities(
      querySourceContextIdentity("base", "base-row"),
      querySourceContextIdentity("joined", "joined-row"),
    );

    expect(identity).toBe(expected);
  });

  it("returns undefined when no source row has a recorded key", () => {
    expect(
      queryContextOrderIdentity(["base", "joined"], {
        base: { id: "base-row" },
        joined: { id: "joined-row" },
      }),
    ).toBeUndefined();
  });

  it("distinguishes row key types and tags source contexts with their alias and key", () => {
    expect(queryRowIdentity("1")).not.toBe(queryRowIdentity(1));
    const context = querySourceContext("project", { id: "atlas" }, "atlas");
    expect(context.project).toEqual({ id: "atlas" });
    expect(queryContextIdentityOf(context)).toBe(querySourceContextIdentity("project", "atlas"));
  });
});
