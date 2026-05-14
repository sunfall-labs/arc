import { Context, Data, Effect, Exit, Schema } from "effect";
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

  it("validates successfully with Effect Schema and resets errors", async () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    await expect(Effect.runPromise(form.validateEffect())).resolves.toEqual({
      id: "atlas",
      name: "Atlas Billing"
    });

    expect(read(form.state)).toMatchObject({
      status: "Valid",
      fieldErrors: {},
      formErrors: []
    });
  });

  it("maps schema failures to field errors", async () => {
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" }
    });

    // @ts-expect-error invalid field value is rejected by schema validation at runtime
    form.setField("name", 42);
    const exit = await Effect.runPromiseExit(form.validateEffect());

    expect(Exit.isFailure(exit)).toBe(true);
    const state = read(form.state);
    expect(state.status).toBe("Invalid");
    expect(state.fieldErrors.name?.[0]).toBeInstanceOf(Schema.SchemaError);
  });

  it("preserves typed domain validation errors per field", async () => {
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

    const exit = await Effect.runPromiseExit(form.validateEffect());

    expect(Exit.isFailure(exit)).toBe(true);
    const error = read(form.state).fieldErrors.name?.[0];
    expect(error).toBeInstanceOf(ProjectNameTooShort);
    if (error instanceof ProjectNameTooShort) {
      expect(error.minimum).toBe(3);
    }
  });

  it("keeps domain validation dependency-injected through Effect services", async () => {
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

    const exit = await Effect.runPromiseExit(
      Effect.provideService(form.validateEffect(), ReservedNames, {
        has: () => Effect.succeed(true)
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(read(form.state).fieldErrors.name?.[0]).toBeInstanceOf(ProjectNameReserved);
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
});
