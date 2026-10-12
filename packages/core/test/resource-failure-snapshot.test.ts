import { Resource, ResourceFailureCodecError, ResourceUntypedFailure } from "@sunfall/arc-core";
import {
  resourceFailureSnapshot,
  resourceRenderCause,
  resourceRenderCauseFromSnapshot,
  resourceRenderError,
} from "@sunfall/arc-core/internal";
import { Cause, Data, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: Schema.String,
}) {}
class DatabaseDown extends Data.TaggedError("DatabaseDown")<{ readonly secret: string }> {}

const Typed = Resource.define({
  name: "ResourceFailureSnapshotTest.typed",
  error: ProjectNotFound,
  load: (id: string): Effect.Effect<string, ProjectNotFound> =>
    Effect.fail(new ProjectNotFound({ id })),
});
const Untyped = Resource.define({
  name: "ResourceFailureSnapshotTest.untyped",
  load: (_: string): Effect.Effect<string, DatabaseDown> =>
    Effect.fail(new DatabaseDown({ secret: "s3cret" })),
});

describe("Resource failure snapshots", () => {
  it("encodes a schema-declared failure with only its declared fields and decodes the class", () => {
    const failure = Object.assign(new ProjectNotFound({ id: "atlas" }), { secret: "s3cret" });
    const snapshot = resourceFailureSnapshot(Typed.family, Cause.fail(failure));
    expect(snapshot).toEqual({
      resource: "ResourceFailureSnapshotTest.typed",
      failure: { _tag: "Encoded", value: { _tag: "ProjectNotFound", id: "atlas" } },
    });
    expect(JSON.stringify(snapshot)).not.toContain("s3cret");
    const decoded = Cause.findErrorOption(resourceRenderCauseFromSnapshot(snapshot));
    expect(Option.getOrThrow(decoded)).toBeInstanceOf(ProjectNotFound);
    expect(Option.getOrThrow(decoded)).toMatchObject({ id: "atlas" });
  });

  it("sends only the tag of a failure without a schema and renders it as ResourceUntypedFailure", () => {
    const cause = Cause.fail(new DatabaseDown({ secret: "s3cret" }));
    const snapshot = resourceFailureSnapshot(Untyped.family, cause);
    expect(snapshot.failure).toEqual({ _tag: "Untyped", tag: "DatabaseDown" });
    const expected = new ResourceUntypedFailure({
      resource: "ResourceFailureSnapshotTest.untyped",
      tag: "DatabaseDown",
    });
    expect(
      Option.getOrThrow(Cause.findErrorOption(resourceRenderCauseFromSnapshot(snapshot))),
    ).toEqual(expected);
    // The client renders the same value from the live failure.
    expect(Option.getOrThrow(resourceRenderError(Untyped.family, cause))).toEqual(expected);
    expect(Cause.squash(resourceRenderCause(Untyped.family, cause))).toEqual(expected);
  });

  it("sends nothing for a defect, and rebuilds codec mismatches as data-free defects", () => {
    const defect = resourceFailureSnapshot(Typed.family, Cause.die(new Error("s3cret")));
    expect(defect.failure).toEqual({ _tag: "Defect" });
    expect(Cause.hasFails(resourceRenderCauseFromSnapshot(defect))).toBe(false);
    expect(Option.isNone(resourceRenderError(Typed.family, Cause.die("boom")))).toBe(true);

    const unencodable = resourceFailureSnapshot(Typed.family, Cause.fail({ _tag: "Other" }));
    expect(unencodable.failure).toEqual({ _tag: "Unencodable" });
    expect(Cause.squash(resourceRenderCauseFromSnapshot(unencodable))).toEqual(
      new ResourceFailureCodecError({
        resource: "ResourceFailureSnapshotTest.typed",
        operation: "encode",
      }),
    );
    // An untyped wire for a family that declares a schema is a mismatch.
    expect(
      Cause.squash(
        resourceRenderCauseFromSnapshot({
          resource: "ResourceFailureSnapshotTest.typed",
          failure: { _tag: "Untyped", tag: "ProjectNotFound" },
        }),
      ),
    ).toBeInstanceOf(ResourceFailureCodecError);
  });
});
