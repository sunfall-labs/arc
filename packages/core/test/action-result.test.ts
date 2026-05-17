import { Data, Effect, Exit, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  Action,
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  Form,
  read,
  Resource,
} from "../src/index.js";
import { ActionResult, type ActionResult as ActionResultValue } from "../src/action-result.js";

describe("ActionResult", () => {
  const RenameInput = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
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
          : Effect.void,
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
          }),
        ),
        Effect.asVoid,
      ),
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
      },
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
                location: "/projects/atlas",
              },
            });
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("rejects Promise-shaped success and failure result payloads", () => {
    for (const build of [
      () => ActionResult.success(Promise.resolve({ id: "atlas" }) as never),
      () => ActionResult.successEffect(Promise.resolve({ id: "atlas" }) as never),
      () => ActionResult.failure(Promise.resolve("failed") as never),
      () => ActionResult.failureEffect(Promise.resolve("failed") as never),
    ]) {
      try {
        build();
        throw new Error("expected ActionResult Promise payload rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
      }
    }
  });

  it("rejects Effect-shaped success and failure result payloads", () => {
    for (const build of [
      () => ActionResult.success(Effect.succeed({ id: "atlas" }) as never),
      () => ActionResult.successEffect(Effect.succeed({ id: "atlas" }) as never),
      () => ActionResult.failure(Effect.succeed("failed") as never),
      () => ActionResult.failureEffect(Effect.succeed("failed") as never),
    ]) {
      try {
        build();
        throw new Error("expected ActionResult Effect payload rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);
      }
    }
  });

  it("rejects Effect-shaped successes from ActionResult.fromEffect", () =>
    Effect.runPromise(
      Effect.exit(
        ActionResult.fromEffect(Effect.succeed(Effect.succeed({ id: "atlas" })) as never),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
              const defect = exit.cause.reasons.find((reason) => reason._tag === "Die");
              expect(defect?.defect).toBeInstanceOf(EffectInputCallbackError);
            }
          }),
        ),
        Effect.asVoid,
      ),
    ));

  it("rejects Promise-shaped and Effect-shaped invalidation entries", () => {
    const Project = Resource.family({
      name: "Project.action-result-invalidations",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ref = Project("atlas");

    for (const build of [
      () => ActionResult.success("ok", { invalidates: [Promise.resolve(ref) as never] }),
      () => ActionResult.failure("failed", { invalidates: [Effect.succeed(ref) as never] }),
      () =>
        ActionResult.withInvalidation(ActionResult.success("ok"), [Promise.resolve(ref) as never]),
    ]) {
      try {
        build();
        throw new Error("expected ActionResult invalidation rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EffectInputCallbackError);
      }
    }
  });

  it("rejects Promise-shaped validation error payloads", () => {
    for (const build of [
      () =>
        ActionResult.fieldError<{ readonly name: string }, "name", string>(
          "name",
          Promise.resolve("too short") as never,
        ),
      () =>
        ActionResult.formError<{ readonly name: string }, string>(
          Promise.resolve("invalid") as never,
        ),
      () =>
        ActionResult.fields<{ readonly name: string }, string>({
          name: [Promise.resolve("too short") as never],
        }),
      () =>
        ActionResult.validation<{ readonly name: string }, string>({
          formErrors: [Promise.resolve("invalid") as never],
        }),
    ]) {
      try {
        build();
        throw new Error("expected ActionResult Promise validation rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
      }
    }
  });

  it("rejects Effect-shaped validation error payloads", () => {
    for (const build of [
      () =>
        ActionResult.fieldError<{ readonly name: string }, "name", string>(
          "name",
          Effect.succeed("too short") as never,
        ),
      () =>
        ActionResult.formError<{ readonly name: string }, string>(
          Effect.succeed("invalid") as never,
        ),
      () =>
        ActionResult.fields<{ readonly name: string }, string>({
          name: [Effect.succeed("too short") as never],
        }),
      () =>
        ActionResult.validation<{ readonly name: string }, string>({
          formErrors: [Effect.succeed("invalid") as never],
        }),
    ]) {
      try {
        build();
        throw new Error("expected ActionResult Effect validation rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(EffectInputCallbackError);
        expect((error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);
      }
    }
  });

  it("reports erased Promise-shaped ActionResult payloads from action runs as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const SubmitProject = Action.define<string, ActionResultValue<unknown>>({
          name: "project.submit.promise-result-payload",
          run: () => ActionResult.success(Promise.resolve({ id: "atlas" }) as never),
        });
        const action = Action.use(SubmitProject);

        const exit = yield* Effect.exit(action.submitEffect("save"));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
          expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
          expect(failure?.error).toMatchObject({
            operation: "ActionResult.success",
            cause: expect.any(EffectInputPromiseRejected),
          });
          expect(read(action.state)).toMatchObject({
            _tag: "Failure",
            input: "save",
          });
        }
      }),
    ));

  it("captures domain failures as typed result data", () => {
    class ProjectNameConflict extends Data.TaggedError("ProjectNameConflict")<{
      readonly name: string;
    }> {}

    return Effect.runPromise(
      Effect.exit(
        ActionResult.fromEffect(Effect.fail(new ProjectNameConflict({ name: "Atlas" }))),
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
          }),
        ),
        Effect.asVoid,
      ),
    );
  });

  it("builds typed single-field validation failures", () => {
    class ProjectNameTooShort extends Data.TaggedError("ProjectNameTooShort")<{
      readonly minimum: number;
    }> {}

    const error = new ProjectNameTooShort({ minimum: 3 });
    const result = ActionResult.fieldError<{ readonly name: string }, "name", ProjectNameTooShort>(
      "name",
      error,
    );

    expect(result).toMatchObject({
      _tag: "ValidationFailure",
      fieldErrors: {
        name: [error],
      },
      formErrors: [],
    });
  });

  it("automatically invalidates resources carried by ActionResult values", () => {
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "ActionResult.invalidate",
      load,
    });
    const ref = Count(undefined);

    type IncrementResult = ActionResultValue<number>;
    const Increment = Action.define<void, IncrementResult>({
      name: "action-result.increment",
      run: () =>
        Effect.sync(() => {
          value++;
          return ActionResult.withInvalidation(ActionResult.success(value), [ref]);
        }),
    });
    const action = Action.use(Increment);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(ref);
        yield* action.submitEffect(undefined);

        yield* Effect.sync(() => {
          expect(read(ref)).toBe(1);
          expect(load).toHaveBeenCalledTimes(2);
          expect(read(action.invalidationPlan)?.entries.map((entry) => entry.ref.key)).toEqual([
            ref.key,
          ]);
        });
      }),
    );
  });

  it("snapshots and freezes invalidations carried by ActionResult values", () => {
    const First = Resource.family({
      name: "ActionResult.freeze-first",
      load: () => Effect.succeed(1),
    });
    const Second = Resource.family({
      name: "ActionResult.freeze-second",
      load: () => Effect.succeed(2),
    });
    const firstRef = First(undefined);
    const secondRef = Second(undefined);
    const invalidates = [firstRef];

    const result = ActionResult.success(1, { invalidates });
    invalidates.push(secondRef);
    const carried = ActionResult.invalidations(result);

    expect(carried).toEqual([firstRef]);
    expect(Object.isFrozen(carried)).toBe(true);
    expect(() => (carried as Resource.Invalidation[]).push(secondRef)).toThrow(TypeError);

    const extended = ActionResult.withInvalidation(result, [secondRef]);
    expect(ActionResult.invalidations(extended)).toEqual([firstRef, secondRef]);
    expect(Object.isFrozen(ActionResult.invalidations(extended))).toBe(true);
  });

  it("snapshots and freezes redirect headers", () => {
    const headers = {
      "x-action": "created",
    };

    const result = ActionResult.redirect("/projects/atlas", { headers });
    headers["x-action"] = "mutated";
    headers["x-extra"] = "ignored";

    expect(result.headers).toEqual({ "x-action": "created" });
    expect(Object.isFrozen(result.headers)).toBe(true);
  });

  it("snapshots and freezes validation error containers", () => {
    const fieldError = { code: "too-short" };
    const formError = { code: "invalid-form" };
    const fieldErrors = {
      name: [fieldError],
    };
    const formErrors = [formError];

    const result = ActionResult.validation<{ readonly name: string }, { code: string }>({
      fieldErrors,
      formErrors,
    });
    fieldErrors.name.push({ code: "mutated-field" });
    fieldErrors.name = [{ code: "replaced-field" }];
    formErrors.push({ code: "mutated-form" });

    expect(result.fieldErrors).toEqual({ name: [fieldError] });
    expect(result.formErrors).toEqual([formError]);
    expect(Object.isFrozen(result.fieldErrors)).toBe(true);
    expect(Object.isFrozen(result.fieldErrors.name)).toBe(true);
    expect(Object.isFrozen(result.formErrors)).toBe(true);
    expect(Object.isFrozen(fieldError)).toBe(false);
    expect(Object.isFrozen(formError)).toBe(false);
  });

  it("merges ActionResult invalidations with definition invalidations", () => {
    let left = 0;
    let right = 0;
    const Left = Resource.family({
      name: "ActionResult.invalidate-left",
      load: () => Effect.succeed(left),
    });
    const Right = Resource.family({
      name: "ActionResult.invalidate-right",
      load: () => Effect.succeed(right),
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
      invalidates: () => [leftRef],
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
          expect(
            read(action.invalidationPlan)
              ?.entries.map((entry) => entry.ref.key)
              .sort(),
          ).toEqual([leftRef.key, rightRef.key].sort());
        });
      }),
    );
  });
});
