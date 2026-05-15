import { Context, Data, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { EffectInputCallbackError, Form, read } from "../src/index.js";

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

  it("tracks dirty fields with the same structural policy used for snapshots", () => {
    const NestedInput = Schema.Struct({
      id: Schema.String,
      details: Schema.Struct({
        name: Schema.String,
        tags: Schema.Array(Schema.String)
      })
    });
    const form = Form.make({
      schema: NestedInput,
      initial: {
        id: "atlas",
        details: {
          name: "Atlas Billing",
          tags: ["billing", "core"]
        }
      }
    });

    form.setField("details", {
      name: "Atlas Billing",
      tags: ["billing", "core"]
    });

    expect(read(form.state)).toMatchObject({
      dirty: { details: false },
      touched: { details: true }
    });

    form.setField("details", {
      name: "Atlas Billing",
      tags: ["core", "billing"]
    });

    expect(read(form.state)).toMatchObject({
      dirty: { details: true },
      touched: { details: true }
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

  it("captures synchronous validator throws in the Effect error channel", async () => {
    const thrown = new Error("validator failed");
    const form = Form.make({
      schema: RenameInput,
      initial: { id: "atlas", name: "Atlas Billing" },
      validate: () => {
        throw thrown;
      }
    });

    const exit = await Effect.runPromise(Effect.exit(form.validateEffect()));

    expect(Exit.isFailure(exit)).toBe(true);
    const state = read(form.state);
    expect(state.status).toBe("Invalid");
    expect(state.fieldErrors).toEqual({});
    expect(state.formErrors[0]).toBeInstanceOf(EffectInputCallbackError);
    expect((state.formErrors[0] as EffectInputCallbackError).cause).toBe(thrown);
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

  it("decodes FormData through Effect Schema with repeated fields", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const TagsInput = Schema.Struct({
          name: Schema.String,
          tags: Schema.Array(Schema.String)
        });
        const formData = new FormData();
        formData.set("name", "Atlas Billing");
        formData.append("tags", "billing");
        formData.append("tags", "core");
        formData.set("__framework", "hidden");

        const decoded = yield* Form.decodeFormDataEffect(TagsInput, formData, {
          omitFields: ["__framework"]
        });

        expect(decoded).toEqual({
          name: "Atlas Billing",
          tags: ["billing", "core"]
        });
        expect(Form.data(formData, { omitFields: ["__framework"] })).toEqual({
          name: "Atlas Billing",
          tags: ["billing", "core"]
        });
      })
    ));

  it("maps FormData schema failures to typed field errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ProgressInput = Schema.Struct({
          progress: Schema.Number
        });
        const formData = new FormData();
        formData.set("progress", "not-a-number");

        const failure = yield* Effect.flip(
          Form.decodeFormDataEffect(ProgressInput, formData)
        );

        expect(failure.fieldErrors.progress?.[0]).toBeInstanceOf(Schema.SchemaError);
        expect(failure.formErrors).toEqual([]);
      })
    ));

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

  it("snapshots caller-owned initial, reset, and exposed state values", () => {
    const NestedInput = Schema.Struct({
      id: Schema.String,
      details: Schema.Struct({
        name: Schema.String
      })
    });
    const initial = { id: "atlas", details: { name: "Atlas Billing" } };
    const form = Form.make({
      schema: NestedInput,
      initial
    });

    initial.details.name = "Mutated";
    expect(read(form.state).initial.details.name).toBe("Atlas Billing");
    expect(read(form.state).values.details.name).toBe("Atlas Billing");

    const exposed = read(form.state) as any;
    exposed.initial.details.name = "Externally Mutated";
    exposed.values.details.name = "Externally Mutated";
    expect(read(form.state).initial.details.name).toBe("Atlas Billing");
    expect(read(form.state).values.details.name).toBe("Atlas Billing");

    const resetValues = { id: "phoenix", details: { name: "Phoenix Ops" } };
    form.reset(resetValues);
    resetValues.details.name = "Mutated Reset";
    expect(read(form.state).initial.details.name).toBe("Phoenix Ops");
    expect(read(form.state).values.details.name).toBe("Phoenix Ops");

    const exposedAfterReset = read(form.state) as any;
    exposedAfterReset.initial.details.name = "Externally Mutated Reset";
    form.reset();
    expect(read(form.state).initial.details.name).toBe("Phoenix Ops");
    expect(read(form.state).values.details.name).toBe("Phoenix Ops");
  });

  it("detaches Map, Set, and custom object form snapshots", () => {
    class Owner {
      constructor(readonly name: string) {}
    }

    const FlexibleInput = Schema.Struct({
      meta: Schema.Unknown,
      labels: Schema.Unknown,
      owner: Schema.Unknown
    });
    const team = { name: "Core" };
    const label = { id: "atlas" };
    const owner = new Owner("Ada");
    const initial = {
      meta: new Map<string, { name: string }>([["team", team]]),
      labels: new Set<{ id: string }>([label]),
      owner
    };
    const form = Form.make({
      schema: FlexibleInput,
      initial
    });

    const state = read(form.state) as any;
    expect(state.initial.meta).toBeInstanceOf(Map);
    expect(state.initial.meta).not.toBe(initial.meta);
    expect(state.initial.meta.get("team")).not.toBe(team);
    expect(state.initial.labels).toBeInstanceOf(Set);
    expect(state.initial.labels).not.toBe(initial.labels);
    expect(Array.from(state.initial.labels)[0]).not.toBe(label);
    expect(state.initial.owner).toBeInstanceOf(Owner);
    expect(state.initial.owner).not.toBe(owner);

    team.name = "Mutated";
    label.id = "mutated";
    (owner as { name: string }).name = "Grace";
    expect((read(form.state) as any).initial.meta.get("team").name).toBe("Core");
    expect((Array.from((read(form.state) as any).initial.labels)[0] as { id: string }).id).toBe("atlas");
    expect((read(form.state) as any).initial.owner.name).toBe("Ada");

    const exposed = read(form.state) as any;
    exposed.initial.meta.get("team").name = "Externally Mutated";
    exposed.initial.labels.add({ id: "external" });
    exposed.initial.owner.name = "External";
    expect((read(form.state) as any).initial.meta.get("team").name).toBe("Core");
    expect((read(form.state) as any).initial.labels.size).toBe(1);
    expect((read(form.state) as any).initial.owner.name).toBe("Ada");

    form.setField("meta", new Map([["team", { name: "Core" }]]));
    expect((read(form.state) as any).dirty.meta).toBe(false);
    form.setField("meta", new Map([["team", { name: "Runtime" }]]));
    expect((read(form.state) as any).dirty.meta).toBe(true);
  });

  it("snapshots values passed to in-flight validation and returned validation values", () => {
    const NestedInput = Schema.Struct({
      id: Schema.String,
      details: Schema.Struct({
        name: Schema.String
      })
    });
    const started = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    let validatedName: string | undefined;
    const initial = { id: "atlas", details: { name: "Atlas Billing" } };
    const form = Form.make({
      schema: NestedInput,
      initial,
      validate: (values) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          validatedName = values.details.name;
        })
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const validation = Effect.runFork(form.validateEffect());
        yield* Deferred.await(started);

        initial.details.name = "Mutated Initial";
        const exposed = read(form.state) as any;
        exposed.values.details.name = "Mutated Exposed";
        yield* Deferred.succeed(release, undefined);

        const value = yield* Fiber.join(validation);
        (value as any).details.name = "Mutated Return";

        expect(validatedName).toBe("Atlas Billing");
        expect(read(form.state).values.details.name).toBe("Atlas Billing");
      })
    );
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
