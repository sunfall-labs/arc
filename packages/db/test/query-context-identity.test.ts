import { describe, expect, it } from "vitest";
import type { AnyCollection } from "../src/collection-contract.js";
import {
  mergeQueryContextIdentities,
  queryContextOrderIdentity,
  querySourceContextIdentity
} from "../src/query-context-identity.js";
import type { QueryPlanBuilder } from "../src/query-plan.js";

const collection = {} as AnyCollection;

const builder = (
  joins: QueryPlanBuilder<any>["joins"] = []
): QueryPlanBuilder<any> => ({
  sources: [
    ["base", collection],
    ["joined", collection]
  ],
  filters: [],
  orders: [],
  offsetCount: 0,
  limitCount: undefined,
  joins,
  grouping: undefined
});

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
    const join = {
      alias: "joined",
      collection,
      leftKey: () => "key",
      rightKeys: () => ["key"]
    };
    const identity = queryContextOrderIdentity(builder([join]), {
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
    expect(queryContextOrderIdentity(builder(), {
      base: { id: "base-row" },
      joined: { id: "joined-row" }
    })).toBeUndefined();
  });
});
