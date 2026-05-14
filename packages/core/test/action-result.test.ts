import { Data, Effect, Exit, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Action, Form, read, Resource } from "../src/index.js";
import {
  ActionResult,
  type ActionResult as ActionResultValue
} from "../src/action-result.js";

describe("ActionResult", () => {
  const RenameInput = Schema.Struct({
    id: Schema.String,
    name: Schema.String
  });

  it("turns form validation into a typed success-channel result", () => {
    class ProjectNameTooShort extends Data.TaggedError("ProjectNameTooShort")<{
      readonly minimum: number;
    }> {}

    const form = Form.make<typeof RenameInput, ProjectNameTooShort>({
      schema: RenameInput,
      initial: { id: "atlas", name: "At" },
      validate: (values, validation) =>
        values.name.length < 3
          ? Effect.fail(validation.field("name", new ProjectNameTooShort({ minimum: 3 })))
          : Effect.void
    });

    return Effect.runPromise(
      Effect.exit(ActionResult.validateFormEffect(form)).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isSuccess(exit)).toBe(true);
            if (Exit.isSuccess(exit)) {
              expect(exit.value._tag).toBe("ValidationFailure");
              if (ActionResult.isValidationFailure(exit.value)) {
                const error = exit.value.fieldErrors.name?.[0];
                expect(error).toBeInstanceOf(ProjectNameTooShort);
              }
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("lets Effect actions return redirects without throwing untyped values", () => {
    type SubmitResult = ActionResultValue<
      { readonly id: string },
      { readonly name: string },
      never,
      never
    >;

    const SubmitProject = Action.define<"save" | "redirect", SubmitResult>({
      name: "project.submit.progressive",
      run: (intent) => {
        const result: SubmitResult =
          intent === "redirect"
            ? ActionResult.redirect("/projects/atlas", { status: 303, replace: true })
            : ActionResult.success({ id: "atlas" });

        return Effect.succeed(result);
      }
    });
    const action = Action.use(SubmitProject);

    return Effect.runPromise(
      action.submitEffect("redirect").pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            expect(ActionResult.isRedirect(result)).toBe(true);
            if (ActionResult.isRedirect(result)) {
              expect(result.location).toBe("/projects/atlas");
              expect(result.status).toBe(303);
              expect(result.replace).toBe(true);
            }
            expect(read(action.state)).toMatchObject({
              _tag: "Success",
              value: {
                _tag: "Redirect",
                location: "/projects/atlas"
              }
            });
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("captures domain failures as typed result data", () => {
    class ProjectNameConflict extends Data.TaggedError("ProjectNameConflict")<{
      readonly name: string;
    }> {}

    return Effect.runPromise(
      Effect.exit(
        ActionResult.fromEffect(
          Effect.fail(new ProjectNameConflict({ name: "Atlas" }))
        )
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isSuccess(exit)).toBe(true);
            if (Exit.isSuccess(exit)) {
              expect(ActionResult.isFailure(exit.value)).toBe(true);
              if (ActionResult.isFailure(exit.value)) {
                expect(exit.value.error).toBeInstanceOf(ProjectNameConflict);
              }
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("builds typed single-field validation failures", () => {
    class ProjectNameTooShort extends Data.TaggedError("ProjectNameTooShort")<{
      readonly minimum: number;
    }> {}

    const error = new ProjectNameTooShort({ minimum: 3 });
    const result = ActionResult.fieldError<{ readonly name: string }, "name", ProjectNameTooShort>(
      "name",
      error
    );

    expect(result).toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: [error]
      },
      formErrors: []
    });
  });

  it("automatically invalidates resources carried by ActionResult values", () => {
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "ActionResult.invalidate",
      load
    });
    const ref = Count(undefined);

    type IncrementResult = ActionResultValue<number>;
    const Increment = Action.define<void, IncrementResult>({
      name: "action-result.increment",
      run: () =>
        Effect.sync(() => {
          value++;
          return ActionResult.withInvalidation(ActionResult.success(value), [ref]);
        })
    });
    const action = Action.use(Increment);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(ref);
        yield* action.submitEffect(undefined);

        yield* Effect.sync(() => {
          expect(read(ref)).toBe(1);
          expect(load).toHaveBeenCalledTimes(2);
          expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
        });
      })
    );
  });

  it("merges ActionResult invalidations with definition invalidations", () => {
    let left = 0;
    let right = 0;
    const Left = Resource.family({
      name: "ActionResult.invalidate-left",
      load: () => Effect.succeed(left)
    });
    const Right = Resource.family({
      name: "ActionResult.invalidate-right",
      load: () => Effect.succeed(right)
    });
    const leftRef = Left(undefined);
    const rightRef = Right(undefined);

    const IncrementBoth = Action.define<void, ActionResultValue<number>>({
      name: "action-result.increment-both",
      run: () =>
        Effect.sync(() => {
          left++;
          right++;
          return ActionResult.withInvalidation(ActionResult.success(left + right), [rightRef]);
        }),
      invalidates: () => [leftRef]
    });
    const action = Action.use(IncrementBoth);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(leftRef);
        yield* Resource.prefetchEffect(rightRef);
        yield* action.submitEffect(undefined);

        yield* Effect.sync(() => {
          expect(read(leftRef)).toBe(1);
          expect(read(rightRef)).toBe(1);
          expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key).sort()).toEqual([
            leftRef.key,
            rightRef.key
          ].sort());
        });
      })
    );
  });
});
