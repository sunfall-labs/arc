import { ActionTransportError } from "@sunfall/arc-core";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { defectReference } from "../src/failure-boundary.js";

describe("defectReference", () => {
  it("reads an Action transport error's request id", () => {
    const error = new ActionTransportError({
      reason: "Defect",
      message: "Start action failed with a defect.",
      requestId: "req-42",
    });
    expect(defectReference(Cause.fail(error))).toBe("req-42");
  });

  it("reads the reference an opaque server defect's message carries", () => {
    const defect = new Error("The server failed to handle the request. (reference req-7)");
    defect.name = "StartServerDefect";
    expect(defectReference(Cause.die(defect))).toBe("req-7");
  });

  it("finds nothing in an ordinary defect", () => {
    expect(defectReference(Cause.die(new Error("boom")))).toBeUndefined();
  });
});
