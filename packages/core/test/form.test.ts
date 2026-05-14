import { Context, Data, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Form, read } from "../src/index.js";

describe("Form", () => {
  const RenameInput = Schema.Struct({
    id: Schema.String,
    name: Schema.String
  });

  it("initializes schema-backed form state", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    expect(read(form.state)).toEqual({
      status: "Idle",
      initial: { id: "atlas", name: "Atlas Billing" },
      values: { id: "atlas", name: "Atlas Billing" },
      fieldErrors: {},
      formErrors: [],
      dirty: {},
      touched: {}
    });
  });

  it("updates known fields and tracks dirty and touched state", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    form.setField("name", "Atlas Revenue");

    expect(read(form.state)).toMatchObject({
      values: { id: "atlas", name: "Atlas Revenue" },
      dirty: { name: true },
      touched: { name: true }
    });

    form.setField("name", "Atlas Billing");

    expect(read(form.state)).toMatchObject({
      values: { id: "atlas", name: "Atlas Billing" },
      dirty: { name: false },
      touched: { name: true }
    });
  });

  it("touches fields without changing values", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    form.touchField("name");

    expect(read(form.state)).toMatchObject({
      values: { id: "atlas", name: "Atlas Billing" },
      touched: { name: true },
      dirty: {}
    });
  });

  it("validates successfully with Effect Schema and resets errors", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    return Effect.runPromise(
      form.validateEffect().pipe(
        Effect.tap((value) =>
          Effect.sync(() =>
            expect(value).toEqual({
              id: "atlas",
              name: "Atlas Billing"
            })
          )
        ),
        Effect.tap(() =>
          Effect.sync(() =>
            expect(read(form.state)).toMatchObject({
              status: "Valid",
              fieldErrors: {},
              formErrors: []
            })
          )
        ),
        Effect.asVoid
      )
    );
  });

  it("maps schema failures to field errors", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    // @ts-expect-error invalid field value is rejected by schema validation at runtime
    form.setField("name", 42);

    return Effect.runPromise(
      Effect.exit(form.validateEffect()).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const state = read(form.state);
            expect(state.status).toBe("Invalid");
            expect(state.fieldErrors.name?.[0]).toBeInstanceOf(Schema.SchemaError);
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("preserves typed domain validation errors per field", () => {
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
      Effect.exit(form.validateEffect()).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            const error = read(form.state).fieldErrors.name?.[0];
            expect(error).toBeInstanceOf(ProjectNameTooShort);
            if (error instanceof ProjectNameTooShort) {
              expect(error.minimum).toBe(3);
            }
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("keeps domain validation dependency-injected through Effect services", () => {
    interface ReservedNames {
      readonly has: (name: string) => Effect.Effect<boolean>;
    }

    const ReservedNames = Context.Service<ReservedNames>("@effect-ui/core/test/ReservedNames");

    class ProjectNameReserved extends Data.TaggedError("ProjectNameReserved")<{
      readonly name: string;
    }> {}

    const form = Form.make<typeof RenameInput, ProjectNameReserved, ReservedNames>({
      schema: RenameInput,
      initial: { id: "atlas", name: "Admin" },
      validate: (values, validation) =>
        ReservedNames.use((reserved) =>
          reserved.has(values.name).pipe(
            Effect.flatMap((isReserved) =>
              isReserved
                ? Effect.fail(validation.field("name", new ProjectNameReserved({ name: values.name })))
                : Effect.void
            )
          )
        )
    });

    return Effect.runPromise(
      Effect.exit(
        Effect.provideService(form.validateEffect(), ReservedNames, {
          has: () => Effect.succeed(true)
        })
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit)).toBe(true);
            expect(read(form.state).fieldErrors.name?.[0]).toBeInstanceOf(ProjectNameReserved);
          })
        ),
        Effect.asVoid
      )
    );
  });

  it("resets values and validation state", () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    form.setField("name", "Atlas Revenue");
    form.reset({ id: "phoenix", name: "Phoenix Ops" });

    expect(read(form.state)).toEqual({
      status: "Idle",
      initial: { id: "phoenix", name: "Phoenix Ops" },
      values: { id: "phoenix", name: "Phoenix Ops" },
      fieldErrors: {},
      formErrors: [],
      dirty: {},
      touched: {}
    });
  });

  it("does not commit stale validation failures after field changes", () => {
    class ProjectNameTooShort extends Data.TaggedError("ProjectNameTooShort")<{
      readonly minimum: number;
    }> {}

    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const form = Form.make<typeof RenameInput, ProjectNameTooShort>({
      schema: RenameInput,
      initial: { id: "atlas", name: "At" },
      validate: (values, validation) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          if (values.name.length < 3) {
            return yield* Effect.fail(validation.field("name", new ProjectNameTooShort({ minimum: 3 })));
          }
        })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const validation = Effect.runFork(form.validateEffect());
        yield* Deferred.await(started);
        form.setField("name", "Atlas Revenue");
        yield* Deferred.succeed(release, undefined);

        const exit = yield* Fiber.await(validation);
        const state = read(form.state);

        expect(Exit.isFailure(exit)).toBe(true);
        expect(state.status).toBe("Idle");
        expect(state.values.name).toBe("Atlas Revenue");
        expect(state.fieldErrors).toEqual({});
      })
    );
  });

  it("does not commit stale validation success after reset", () => {
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" },
      validate: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
        })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const validation = Effect.runFork(form.validateEffect());
        yield* Deferred.await(started);
        form.reset({ id: "phoenix", name: "Phoenix Ops" });
        yield* Deferred.succeed(release, undefined);

        const value = yield* Fiber.join(validation);
        const state = read(form.state);

        expect(value).toEqual({ id: "atlas", name: "Atlas Billing" });
        expect(state).toEqual({
          status: "Idle",
          initial: { id: "phoenix", name: "Phoenix Ops" },
          values: { id: "phoenix", name: "Phoenix Ops" },
          fieldErrors: {},
          formErrors: [],
          dirty: {},
          touched: {}
        });
      })
    );
  });
});
