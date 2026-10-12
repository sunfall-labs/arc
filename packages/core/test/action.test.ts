import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schedule } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  Action,
  ActionTransport,
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  makeRuntime,
  Resource,
  Signal,
} from "../src/index.js";
import {
  makeActionSubmissionController,
  defaultRuntime,
  withSignalTransition,
} from "../src/internal.js";
import { makeActionOptimisticTransactionRuntime } from "../src/action-optimistic.js";

/** Runs optimistic patches as an Action submission does: labelled with the Action. */
const asSubmission =
  (action: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    withSignalTransition(effect, { _tag: "Action", action, event: "submit" });

describe("Action", () => {
  it("tracks status transitions", async () => {
    const Rename = Action.define({
      name: "rename",
      run: (name: string) => Effect.sleep("1 millis").pipe(Effect.as({ name })),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    expect(action.state.get().result._tag).toBe("Initial");
    const submission = Effect.runFork(action.submit("Ada"));
    expect(action.state.get().result.waiting).toBe(true);
    await Effect.runPromise(Fiber.join(submission));

    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: { name: "Ada" } },
    });
  });

  it("exposes native Effect submission", async () => {
    const Rename = Action.define({
      name: "rename.effect",
      run: (name: string) => Effect.succeed({ name }),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    await expect(Effect.runPromise(action.submit("Grace"))).resolves.toEqual({
      name: "Grace",
    });
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: { name: "Grace" } },
    });
  });

  it("preserves explicitly wrapped Effect values as action outputs", async () => {
    const domainEffect = Effect.succeed(42);
    const BuildComputation = Action.define<void, Effect.Effect<number>>({
      name: "computation.effect-valued",
      run: () => Effect.succeed(domainEffect),
    });
    const action = Action.use(BuildComputation, { runtime: defaultRuntime });

    const value = await Effect.runPromise(action.submit(undefined));

    expect(value).toBe(domainEffect);
    await expect(Effect.runPromise(value)).resolves.toBe(42);
  });

  it("preserves successful undefined as previous action state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        const Complete = Action.define<string, void, "failed">({
          name: "action.undefined-previous",
          run: (mode) =>
            mode === "wait"
              ? Deferred.await(release)
              : mode === "fail"
                ? Effect.fail("failed" as const)
                : Effect.void,
        });
        const action = Action.use(Complete, { runtime: defaultRuntime });

        yield* action.submit("success");

        const pendingFiber = yield* action
          .submit("wait")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.sync(() => {
          const pending = action.state.get();
          expect(pending.input).toEqual(Option.some("wait"));
          expect(pending.result).toMatchObject({ _tag: "Success", waiting: true });
          expect(AsyncResult.value(pending.result)).toEqual(Option.some(undefined));
        });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(pendingFiber);

        const exit = yield* Effect.exit(action.submit("fail"));
        yield* Effect.sync(() => {
          expect(exit._tag).toBe("Failure");
          const failed = action.state.get();
          expect(failed.input).toEqual(Option.some("fail"));
          expect(failed.result).toMatchObject({ _tag: "Failure", waiting: false });
          expect(AsyncResult.error(failed.result)).toEqual(Option.some("failed"));
          expect(AsyncResult.value(failed.result)).toEqual(Option.some(undefined));
        });
      }),
    ));

  it("captures synchronous run throws as defects", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.sync-throw",
      run: () => {
        throw new Error("rename failed");
      },
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Promise-shaped run returns as defects instead of leaving pending state", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.promise-erased",
      run: () => Promise.resolve("Ada") as never,
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.run(rename.promise-erased)",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures synchronous optimistic callback throws as defects", async () => {
    const cause = new Error("optimistic failed");
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-sync-throw",
      optimistic: () => {
        throw cause;
      },
      run: (name) => Effect.succeed(name),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect((failure!.defect as EffectInputCallbackError).cause).toBe(cause);
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Promise-shaped optimistic callback returns as defects", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-promise-erased",
      optimistic: () => Promise.resolve(Effect.void) as never,
      run: (name) => Effect.succeed(name),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.optimistic(rename.optimistic-promise-erased)",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures optimistic signal updater throws as defects", async () => {
    const cause = new Error("optimistic signal failed");
    const title = Signal.make("Draft", { name: "title" });
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-signal-sync-throw",
      optimistic: (_next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, () => {
            throw cause;
          });
        }),
      run: (name) => Effect.succeed(name),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect(failure?.defect).toMatchObject({
        operation: "Action.optimistic(rename.optimistic-signal-sync-throw).set",
        cause,
      });
      expect(title.get()).toBe("Draft");
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Promise-shaped optimistic signal values as defects", async () => {
    const title = Signal.make<unknown>("Draft", { name: "title" });
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-signal-promise-value",
      optimistic: (_next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, Promise.resolve("Ada") as never);
        }),
      run: (name) => Effect.succeed(name),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect(failure?.defect).toMatchObject({
        operation: "Action.optimistic(rename.optimistic-signal-promise-value).set",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(title.get()).toBe("Draft");
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Promise-shaped optimistic signal updater returns as defects", async () => {
    const title = Signal.make<unknown>("Draft", { name: "title" });
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-signal-promise-updater",
      optimistic: (_next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, () => Promise.resolve("Ada") as never);
        }),
      run: (name) => Effect.succeed(name),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect(failure?.defect).toMatchObject({
        operation: "Action.optimistic(rename.optimistic-signal-promise-updater).set",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(title.get()).toBe("Draft");
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures optimistic signal updater throws during transaction rebase", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cause = new Error("optimistic rebase failed");
        const title = Signal.make("Draft", { name: "title" });
        const first = makeActionOptimisticTransactionRuntime("rename.optimistic-rebase");
        const second = makeActionOptimisticTransactionRuntime("rename.optimistic-rebase");

        yield* first.api.set(title, "First");
        let throwOnRebase = false;
        yield* second.api.set(title, (current) => {
          if (throwOnRebase) {
            throw cause;
          }
          return `${current}:Second`;
        });

        yield* Effect.sync(() => {
          expect(title.get()).toBe("First:Second");
        });

        throwOnRebase = true;
        const commitExit = yield* Effect.exit(first.commit);
        const failure = Exit.isFailure(commitExit) ? Cause.squash(commitExit.cause) : undefined;

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: "Action.optimistic(rename.optimistic-rebase).set",
            cause,
          });
          expect(title.get()).toBe("First:Second");
        });
      }).pipe(asSubmission("rename.optimistic-rebase")),
    ));

  it("keeps optimistic transaction finish atomic across multiple signals", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cause = new Error("optimistic multi-signal rebase failed");
        const left = Signal.make("left:base", { name: "left" });
        const right = Signal.make("right:base", { name: "right" });
        const first = makeActionOptimisticTransactionRuntime("rename.optimistic-atomic");
        const second = makeActionOptimisticTransactionRuntime("rename.optimistic-atomic");

        yield* first.api.set(left, "left:first");
        yield* first.api.set(right, "right:first");

        yield* second.api.set(left, (current) => `${current}:second`);
        let throwOnRightRebase = false;
        yield* second.api.set(right, (current) => {
          if (throwOnRightRebase) {
            throw cause;
          }
          return `${current}:second`;
        });

        yield* Effect.sync(() => {
          expect(left.get()).toBe("left:first:second");
          expect(right.get()).toBe("right:first:second");
        });

        throwOnRightRebase = true;
        const commitExit = yield* Effect.exit(first.commit);
        const failure = Exit.isFailure(commitExit) ? Cause.squash(commitExit.cause) : undefined;

        throwOnRightRebase = false;
        yield* first.rollback;

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: "Action.optimistic(rename.optimistic-atomic).set",
            cause,
          });
          expect(left.get()).toBe("left:base:second");
          expect(right.get()).toBe("right:base:second");
        });
      }).pipe(asSubmission("rename.optimistic-atomic")),
    ));

  it("captures synchronous invalidation callback throws as defects", async () => {
    const cause = new Error("invalidates failed");
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-sync-throw",
      run: (name) => Effect.succeed(name),
      invalidates: () => {
        throw cause;
      },
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toBeInstanceOf(EffectInputCallbackError);
      expect((failure!.defect as EffectInputCallbackError).cause).toBe(cause);
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Promise-shaped invalidation callback returns as defects", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-promise-erased",
      run: (name) => Effect.succeed(name),
      invalidates: () => Promise.resolve([]) as never,
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-promise-erased)",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures synchronous invalidation callback throws from sync planning", () => {
    const cause = new Error("invalidates failed");
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-sync-plan-throw",
      run: (name) => Effect.succeed(name),
      invalidates: () => {
        throw cause;
      },
    });

    expect(() => Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"))).toThrow(
      EffectInputCallbackError,
    );
    try {
      Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"));
      expect.fail("Expected Action.planInvalidation to throw a typed callback error");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-sync-plan-throw)",
        cause,
      });
    }
  });

  it("captures erased Promise-shaped invalidation callback returns from sync planning", () => {
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-promise-plan-erased",
      run: (name) => Effect.succeed(name),
      invalidates: () => Promise.resolve([]) as never,
    });

    expect(() => Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"))).toThrow(
      EffectInputCallbackError,
    );
    try {
      Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"));
      expect.fail("Expected Action.planInvalidation to throw a typed callback error");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-promise-plan-erased)",
        cause: expect.any(EffectInputPromiseRejected),
      });
    }
  });

  it("captures erased Promise-shaped invalidation entries as defects", async () => {
    const Project = Resource.define({
      name: "Project.invalidates-entry-promise",
      load: (id: string) => Effect.succeed({ id }),
    });
    const ref = Project("atlas");
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-entry-promise",
      run: (name) => Effect.succeed(name),
      invalidates: () => [Promise.resolve(ref) as never],
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const exit = await Effect.runPromise(Effect.exit(action.submit("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Die");
      expect(failure?.defect).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-entry-promise)[0]",
        cause: expect.any(EffectInputPromiseRejected),
      });
      expect(action.state.get()).toMatchObject({
        result: { _tag: "Failure", waiting: false },
        input: Option.some("Ada"),
      });
    }
  });

  it("captures erased Effect-shaped invalidation entries from sync planning", () => {
    const Project = Resource.define({
      name: "Project.invalidates-entry-effect",
      load: (id: string) => Effect.succeed({ id }),
    });
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-entry-effect",
      run: (name) => Effect.succeed(name),
      invalidates: () => [Effect.succeed(Project("atlas")) as never],
    });

    expect(() => Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"))).toThrow(
      EffectInputCallbackError,
    );
    try {
      Effect.runSync(Action.planInvalidation(Rename, "Ada", "Ada"));
      expect.fail("Expected Action.planInvalidation to throw a typed callback error");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-entry-effect)[0]",
        cause: expect.any(TypeError),
      });
    }
  });

  it("invalidates typed resource refs on success", async () => {
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.define({
      name: "Count.invalidate",
      load,
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.preload(ref));

    const Increment = Action.define({
      name: "increment",
      run: () =>
        Effect.sync(() => {
          value++;
          return value;
        }),
      invalidates: () => [ref],
    });

    await Effect.runPromise(Action.use(Increment, { runtime: defaultRuntime }).submit(undefined));

    expect(Effect.runSync(Resource.read(ref))).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates semantic resource tags on success", async () => {
    const CountTag = Resource.tag("Count.action-tag");
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.define({
      name: "Count.invalidate-tag",
      load,
      provides: () => [CountTag],
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.preload(ref));

    const Increment = Action.define({
      name: "increment.tag",
      run: () =>
        Effect.sync(() => {
          value++;
          return value;
        }),
      invalidates: () => [CountTag],
    });

    await Effect.runPromise(Action.use(Increment, { runtime: defaultRuntime }).submit(undefined));

    expect(Effect.runSync(Resource.read(ref))).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates resources inside an explicit runtime store", async () => {
    const runtime = makeRuntime();
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.define({
      name: "Count.runtime-action",
      load,
    });
    const ref = Count(undefined);

    try {
      await Effect.runPromise(runtime.provide(Resource.preload(ref)));

      const Increment = Action.define({
        name: "increment.runtime-action",
        run: () =>
          Effect.sync(() => {
            value++;
            return value;
          }),
        invalidates: () => [ref],
      });

      await Effect.runPromise(
        runtime.provide(Action.use(Increment, { runtime }).submit(undefined)),
      );

      expect(runtime.runSync(Resource.read(ref))).toBe(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps remaining services on runtime-bound submissions", async () => {
    interface RuntimeApi {
      readonly prefix: string;
    }
    interface CallerApi {
      readonly suffix: string;
    }
    const RuntimeApi = Context.Service<RuntimeApi>("@sunfall/arc-core/test/ActionRuntimeApi");
    const CallerApi = Context.Service<CallerApi>("@sunfall/arc-core/test/ActionCallerApi");
    const runtime = makeRuntime(
      Layer.succeed(RuntimeApi)({
        prefix: "runtime",
      }),
    );
    const Join = Action.define<void, string, never, RuntimeApi | CallerApi>({
      name: "join.runtime-bound.remaining-service",
      run: () =>
        Effect.gen(function* () {
          const runtimeApi = yield* RuntimeApi;
          const callerApi = yield* CallerApi;
          return `${runtimeApi.prefix}:${callerApi.suffix}`;
        }),
    });

    try {
      const action = Action.use(Join, { runtime });
      const value = await Effect.runPromise(
        action.submit(undefined).pipe(Effect.provideService(CallerApi, { suffix: "caller" })),
      );

      expect(value).toBe("runtime:caller");
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("keeps reset local for runtime-bound actions", async () => {
    const runtime = makeRuntime(Layer.effectDiscard(Effect.fail("runtime unavailable")));
    const Save = Action.define<void, string>({
      name: "save.runtime-reset-local",
      run: () => Effect.succeed("saved"),
    });
    const action = Action.use(Save, { runtime });

    try {
      await expect(Effect.runPromise(action.reset())).resolves.toBeUndefined();
      await expect(Effect.runPromise(Effect.flip(action.submit(undefined)))).resolves.toBe(
        "runtime unavailable",
      );
    } finally {
      await Effect.runPromise(Effect.ignore(runtime.dispose));
    }
  });

  it("clears reset state even when the action runtime is disposed", async () => {
    const runtime = makeRuntime();
    const Save = Action.define<void, string>({
      name: "save.runtime-reset-disposed",
      run: () => Effect.succeed("saved"),
    });
    const action = Action.use(Save, { runtime });

    await Effect.runPromise(action.submit(undefined));
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "saved" },
    });

    await Effect.runPromise(runtime.dispose);
    await Effect.runPromise(action.reset());
    expect(action.state.get()).toEqual({ result: AsyncResult.initial(), input: Option.none() });
  });

  it("captureResetEffect resets eagerly and interrupts only captured submissions", async () => {
    const controller = makeActionSubmissionController<string, string, never>({
      actionName: "capture-reset-low-level",
    });
    const firstInterrupted = Effect.runSync(Deferred.make<void>());
    const secondInterrupted = Effect.runSync(Deferred.make<void>());
    const firstFiber = Effect.runFork(
      Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(firstInterrupted, undefined))),
    );
    const firstSubmission = await Effect.runPromise(controller.beginEffect(firstFiber));

    if (firstSubmission._tag === "Join") {
      expect.fail("Expected first submission to run.");
    }

    await Effect.runPromise(controller.pendingEffect(firstSubmission, "first"));
    expect(controller.state.get()).toMatchObject({
      result: { waiting: true },
      input: Option.some("first"),
    });

    const cleanup = controller.captureReset();
    expect(controller.state.get()).toEqual({ result: AsyncResult.initial(), input: Option.none() });

    const secondFiber = Effect.runFork(
      Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(secondInterrupted, undefined))),
    );
    const secondSubmission = await Effect.runPromise(controller.beginEffect(secondFiber));

    if (secondSubmission._tag === "Join") {
      expect.fail("Expected second submission to run after reset capture.");
    }

    await Effect.runPromise(controller.pendingEffect(secondSubmission, "second"));
    await Effect.runPromise(cleanup);
    await Effect.runPromise(Deferred.await(firstInterrupted));

    const secondStatus = await Effect.runPromise(
      Effect.race(
        Deferred.await(secondInterrupted).pipe(Effect.as("interrupted" as const)),
        Effect.sleep("10 millis").pipe(Effect.as("alive" as const)),
      ),
    );
    expect(secondStatus).toBe("alive");

    await Effect.runPromise(Fiber.interrupt(secondFiber));
    await Effect.runPromise(Deferred.await(secondInterrupted));
  });

  it("exposes the latest invalidation plan for submitted actions", async () => {
    const CountTag = Resource.tag("Count.action-plan");
    const Count = Resource.define({
      name: "Count.action-plan",
      load: () => Effect.succeed(0),
      provides: () => [CountTag],
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.preload(ref));

    const invalidationTargets = [CountTag];
    const Increment = Action.define({
      name: "increment.plan",
      run: () => Effect.succeed(1),
      invalidates: () => invalidationTargets,
    });
    const action = Action.use(Increment, { runtime: defaultRuntime });

    await Effect.runPromise(action.submit(undefined));
    invalidationTargets.push(Resource.tag("Count.action-plan-ignored"));

    const plan = action.invalidationPlan.get();
    expect(plan?.targets).toEqual([CountTag]);
    expect(Object.isFrozen(plan?.targets)).toBe(true);
    expect(plan?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false },
    });
    expect(action.invalidationPlan.get()).toBe(plan);
    expect(() => (plan!.targets as Resource.Invalidation[]).push(CountTag)).toThrow(TypeError);
  });

  it("keeps only the latest submission in state", async () => {
    const Finish = Action.define({
      name: "finish",
      run: (value: string) => Effect.succeed(value),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    await Effect.runPromise(
      Effect.all(
        [action.submit("first").pipe(Effect.exit), action.submit("second").pipe(Effect.exit)],
        { concurrency: "unbounded" },
      ),
    );

    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "second" },
    });
  });

  it("interrupts the previous event submission", async () => {
    let interrupted = false;
    const Finish = Action.define({
      name: "finish.interrupt",
      run: (value: string) =>
        value === "first"
          ? Effect.ensuring(
              Effect.never,
              Effect.sync(() => {
                interrupted = true;
              }),
            )
          : Effect.succeed(value),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action
          .submit("first")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.sleep("10 millis");
        yield* action.submit("second");
        yield* Fiber.await(first);
      }),
    );

    expect(interrupted).toBe(true);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "second" },
    });
  });

  it("interrupts the previous native Effect submission", async () => {
    let interrupted = false;
    const Finish = Action.define({
      name: "finish.effect-interrupt",
      run: (value: string) =>
        value === "first"
          ? Effect.ensuring(
              Effect.never,
              Effect.sync(() => {
                interrupted = true;
              }),
            )
          : Effect.succeed(value),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const first = Effect.runFork(action.submit("first"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    await expect(Effect.runPromise(action.submit("second"))).resolves.toBe("second");
    await Effect.runPromise(Effect.exit(Fiber.join(first)));

    expect(interrupted).toBe(true);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "second" },
    });
  });

  it("uses Effect schedules for retry policy", async () => {
    let attempts = 0;
    const Finish = Action.define({
      name: "finish.retry",
      policy: {
        retry: Schedule.recurs(2),
      },
      run: () =>
        Effect.gen(function* () {
          attempts++;
          if (attempts < 3) {
            return yield* Effect.fail("temporary");
          }
          return "done";
        }),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    await expect(Effect.runPromise(action.submit(undefined))).resolves.toBe("done");

    expect(attempts).toBe(3);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "done" },
    });
  });

  it("commits optimistic signal patches on success", async () => {
    const title = Signal.make("Draft", { name: "title" });
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.success",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, next);
        }),
      run: (next) => Effect.succeed(next),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const submission = Effect.runFork(action.submit("Published"));

    await expect(Effect.runPromise(Fiber.join(submission))).resolves.toBe("Published");
    expect(title.get()).toBe("Published");
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "Published" },
    });
  });

  it("commits optimistic patches whose value is undefined", async () => {
    const selected = Signal.make<string | undefined>("Draft", { name: "selected" });
    const Clear = Action.define<void, void>({
      name: "clear.optimistic.undefined",
      optimistic: (_, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(selected, undefined);
        }),
      run: () => Effect.void,
    });

    await Effect.runPromise(Action.use(Clear, { runtime: defaultRuntime }).submit(undefined));

    expect(selected.get()).toBeUndefined();
  });

  it("does not invalidate resources when optimistic commit fails", async () => {
    const title = Signal.make("Draft", { name: "title" });
    let shouldFailCommit = false;
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.define({
      name: "Count.optimistic-commit-before-invalidation",
      load,
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.preload(ref));

    const Publish = Action.define<void, number>({
      name: "publish.optimistic-commit-before-invalidation",
      optimistic: (_input, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, () => {
            if (shouldFailCommit) {
              throw new Error("commit failed");
            }
            return "Published";
          });
        }),
      run: () =>
        Effect.sync(() => {
          value = 1;
          shouldFailCommit = true;
          return value;
        }),
      invalidates: () => [ref],
    });

    await expect(
      Effect.runPromise(Action.use(Publish, { runtime: defaultRuntime }).submit(undefined)),
    ).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Action.optimistic(publish.optimistic-commit-before-invalidation).set",
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(Effect.runSync(Resource.read(ref))).toBe(0);
    expect(title.get()).toBe("Draft");
  });

  it("rolls back optimistic patches on failure", async () => {
    const title = Signal.make("Draft", { name: "title" });
    const Rename = Action.define<string, string, string>({
      name: "rename.optimistic.failure",
      optimistic: (next, transaction) => transaction.set(title, next),
      run: () => Effect.fail("boom"),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    await expect(Effect.runPromise(action.submit("Published"))).rejects.toBe("boom");

    expect(title.get()).toBe("Draft");
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Failure", waiting: false },
      input: Option.some("Published"),
    });
    expect(AsyncResult.error(action.state.get().result)).toEqual(Option.some("boom"));
  });

  it("rolls back interrupted latest optimism before applying the next patch", async () => {
    const title = Signal.make("Draft", { name: "title" });
    const secondOptimisticApplied = Effect.runSync(Deferred.make<void>());
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.latest",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, next);
          if (next === "Published") {
            yield* Deferred.succeed(secondOptimisticApplied, undefined);
          }
        }),
      run: (next) => (next === "Stale" ? Effect.never : Effect.succeed(next)),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    const first = Effect.runFork(action.submit("Stale"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(title.get()).toBe("Stale");

    const second = Effect.runFork(action.submit("Published"));
    await Effect.runPromise(Deferred.await(secondOptimisticApplied));

    expect(title.get()).toBe("Published");
    await expect(Effect.runPromise(Fiber.join(second))).resolves.toBe("Published");
    await Effect.runPromise(Fiber.await(first));
    expect(title.get()).toBe("Published");
  });

  it("rolls back optimistic patches when interrupted inside optimistic work", () => {
    const title = Signal.make("Draft", { name: "title" });
    const firstOptimisticApplied = Effect.runSync(Deferred.make<void>());
    const holdFirstOptimistic = Effect.runSync(Deferred.make<void>());
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.interrupted-optimistic",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, next);
          if (next === "Stale") {
            yield* Deferred.succeed(firstOptimisticApplied, undefined);
            yield* Deferred.await(holdFirstOptimistic);
          }
        }),
      run: (next) => Effect.succeed(next),
    });
    const action = Action.use(Rename, { runtime: defaultRuntime });

    return Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action
          .submit("Stale")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(firstOptimisticApplied);
        yield* Effect.sync(() => {
          expect(title.get()).toBe("Stale");
        });

        const second = yield* action
          .submit("Published")
          .pipe(Effect.forkChild({ startImmediately: true }));
        const secondValue = yield* Fiber.join(second);
        yield* Fiber.await(first);

        yield* Effect.sync(() => {
          expect(secondValue).toBe("Published");
          expect(title.get()).toBe("Published");
          expect(action.state.get()).toMatchObject({
            result: { _tag: "Success", waiting: false, value: "Published" },
          });
        });
      }),
    );
  });

  it("supports exhaust concurrency for event submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.exhaust",
      policy: {
        concurrency: "exhaust",
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        }),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action
          .submit("first")
          .pipe(Effect.forkChild({ startImmediately: true }));
        const second = yield* action
          .submit("second")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.succeed(release, undefined);
        return yield* Effect.all([Fiber.join(first), Fiber.join(second)], {
          concurrency: "unbounded",
        });
      }),
    );

    expect(first).toBe("first");
    expect(second).toBe("first");

    expect(runs).toBe(1);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "first" },
      input: Option.some("first"),
    });
  });

  it("supports exhaust concurrency for native Effect submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-exhaust",
      policy: {
        concurrency: "exhaust",
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        }),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const first = Effect.runFork(action.submit("first"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    const second = Effect.runFork(action.submit("second"));
    Effect.runSync(Deferred.succeed(release, undefined));

    await expect(Effect.runPromise(Fiber.join(first))).resolves.toBe("first");
    await expect(Effect.runPromise(Fiber.join(second))).resolves.toBe("first");
    expect(runs).toBe(1);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "first" },
      input: Option.some("first"),
    });
  });

  it("reset interrupts active exhaust submissions before accepting new work", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-exhaust-reset",
      policy: {
        concurrency: "exhaust",
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          if (value === "first") {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never.pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            );
          }
          return value;
        }),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const first = Effect.runFork(action.submit("first"));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(action.reset());
    await Effect.runPromise(Deferred.await(interrupted));

    await expect(Effect.runPromise(action.submit("second"))).resolves.toBe("second");
    await Effect.runPromise(Fiber.await(first));

    expect(runs).toBe(2);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "second" },
      input: Option.some("second"),
    });
  });

  it("lets event exhaust submissions join a native Effect submission", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-event-exhaust",
      policy: {
        concurrency: "exhaust",
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        }),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const [firstResult, secondResult] = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action
          .submit("first")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.sleep("10 millis");
        const second = yield* action
          .submit("second")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.succeed(release, undefined);
        return yield* Effect.all([Fiber.join(first), Fiber.join(second)], {
          concurrency: "unbounded",
        });
      }),
    );

    expect(firstResult).toBe("first");
    expect(secondResult).toBe("first");
    expect(runs).toBe(1);
  });

  it("supports parallel concurrency without interrupting older submissions", async () => {
    let firstInterrupted = false;
    const Finish = Action.define({
      name: "finish.parallel",
      policy: {
        concurrency: "parallel",
      },
      run: (value: string) =>
        value === "first"
          ? Effect.onInterrupt(Effect.sleep("20 millis").pipe(Effect.as(value)), () =>
              Effect.sync(() => {
                firstInterrupted = true;
              }),
            )
          : Effect.succeed(value),
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    await expect(
      Effect.runPromise(
        Effect.all([action.submit("first"), action.submit("second")], {
          concurrency: "unbounded",
        }),
      ),
    ).resolves.toEqual(["first", "second"]);

    expect(firstInterrupted).toBe(false);
    expect(action.state.get()).toMatchObject({
      result: { _tag: "Success", waiting: false, value: "second" },
      input: Option.some("second"),
    });
  });

  it("reset interrupts all active parallel submissions before invalidation", async () => {
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const firstInterrupted = Effect.runSync(Deferred.make<void>());
    const secondInterrupted = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const invalidates = vi.fn(() => []);
    const Finish = Action.define<string, string>({
      name: "finish.parallel-reset",
      policy: {
        concurrency: "parallel",
      },
      run: (value) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(value === "first" ? firstStarted : secondStarted, undefined);
          return yield* Deferred.await(release).pipe(
            Effect.as(value),
            Effect.onInterrupt(() =>
              Deferred.succeed(value === "first" ? firstInterrupted : secondInterrupted, undefined),
            ),
          );
        }),
      invalidates,
    });
    const action = Action.use(Finish, { runtime: defaultRuntime });

    const first = Effect.runFork(action.submit("first"));
    const second = Effect.runFork(action.submit("second"));
    await Effect.runPromise(Deferred.await(firstStarted));
    await Effect.runPromise(Deferred.await(secondStarted));

    await Effect.runPromise(action.reset());
    await Effect.runPromise(Deferred.await(firstInterrupted));
    await Effect.runPromise(Deferred.await(secondInterrupted));
    await Effect.runPromise(Deferred.succeed(release, undefined));

    const exits = await Effect.runPromise(
      Effect.all([Fiber.await(first), Fiber.await(second)], { concurrency: "unbounded" }),
    );

    expect(exits.every(Exit.isFailure)).toBe(true);
    expect(invalidates).not.toHaveBeenCalled();
    expect(action.state.get()).toEqual({ result: AsyncResult.initial(), input: Option.none() });
  });

  it("keeps stale parallel successes from replacing the latest invalidation plan", () => {
    const FirstTag = Resource.tag("Action.parallel-plan.first");
    const SecondTag = Resource.tag("Action.parallel-plan.second");
    const firstLoad = vi.fn(() => Effect.succeed("first"));
    const secondLoad = vi.fn(() => Effect.succeed("second"));
    const First = Resource.define({
      name: "Action.parallel-plan.first",
      load: firstLoad,
      provides: () => [FirstTag],
    });
    const Second = Resource.define({
      name: "Action.parallel-plan.second",
      load: secondLoad,
      provides: () => [SecondTag],
    });
    const firstRef = First(undefined);
    const secondRef = Second(undefined);
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const firstRelease = Effect.runSync(Deferred.make<void>());
    const secondRelease = Effect.runSync(Deferred.make<void>());
    const Update = Action.define<string, string>({
      name: "update.parallel-plan",
      policy: {
        concurrency: "parallel",
      },
      run: (value) =>
        Effect.gen(function* () {
          if (value === "first") {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(firstRelease);
          } else {
            yield* Deferred.succeed(secondStarted, undefined);
            yield* Deferred.await(secondRelease);
          }
          return value;
        }),
      invalidates: (_value, input) => [input === "first" ? FirstTag : SecondTag],
    });
    const action = Action.use(Update, { runtime: defaultRuntime });

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.preload(firstRef);
        yield* Resource.preload(secondRef);

        const first = yield* action
          .submit("first")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(firstStarted);
        const second = yield* action
          .submit("second")
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Deferred.await(secondStarted);

        yield* Deferred.succeed(secondRelease, undefined);
        const secondValue = yield* Fiber.join(second);
        yield* Effect.sync(() => {
          expect(secondValue).toBe("second");
          expect(action.invalidationPlan.get()?.targets).toEqual([SecondTag]);
          expect(secondLoad).toHaveBeenCalledTimes(2);
        });

        yield* Deferred.succeed(firstRelease, undefined);
        const firstValue = yield* Fiber.join(first);

        yield* Effect.sync(() => {
          expect(firstValue).toBe("first");
          expect(firstLoad).toHaveBeenCalledTimes(2);
          expect(action.invalidationPlan.get()?.targets).toEqual([SecondTag]);
          expect(action.state.get()).toMatchObject({
            result: { _tag: "Success", waiting: false, value: "second" },
            input: Option.some("second"),
          });
        });
      }),
    );
  });

  describe("ActionTransport", () => {
    it("submits served Actions through the runtime's transport and runs others locally", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const applied: Array<boolean> = [];
          let localRuns = 0;
          const Remote = Action.define({
            name: "ActionTransport.remote",
            run: (name: string) => Effect.sync(() => (localRuns++, `local:${name}`)),
          });
          const Local = Action.define({
            name: "ActionTransport.local",
            run: (name: string) => Effect.sync(() => (localRuns++, `local:${name}`)),
          });
          const transport = Layer.succeed(ActionTransport)({
            submit: (definition, input) =>
              definition.name === Remote.name
                ? Option.some(
                    Effect.succeed({
                      exit: Exit.succeed(`remote:${String(input)}` as never),
                      apply: (current: boolean) => Effect.sync(() => applied.push(current)),
                    }),
                  )
                : Option.none(),
          });
          const runtime = makeRuntime(transport);
          const remote = Action.use(Remote, { runtime });
          const local = Action.use(Local, { runtime });

          expect(yield* remote.submit("atlas")).toBe("remote:atlas");
          expect(yield* local.submit("atlas")).toBe("local:atlas");
          expect(localRuns).toBe(1);
          expect(applied).toEqual([true]);
          expect(remote.state.get().result).toMatchObject({
            _tag: "Success",
            value: "remote:atlas",
          });
          yield* runtime.dispose;
        }),
      ));

    it("reports remote typed failures and applies superseded parallel responses as stale", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const applied: Array<boolean> = [];
          const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
          let calls = 0;
          const Save = Action.define({
            name: "ActionTransport.parallel",
            policy: { concurrency: "parallel" },
            run: (_name: string): Effect.Effect<string, "rejected"> => Effect.fail("rejected"),
          });
          const transport = Layer.succeed(ActionTransport)({
            submit: (_definition, input) => {
              const gate = gates[calls++]!;
              return Option.some(
                Effect.as(Deferred.await(gate), {
                  exit:
                    input === "bad" ? Exit.fail("rejected" as never) : Exit.succeed(input as never),
                  apply: (current: boolean) => Effect.sync(() => applied.push(current)),
                }),
              );
            },
          });
          const runtime = makeRuntime(transport);
          const save = Action.use(Save, { runtime });

          const first = runtime.runFork(save.submit("first"));
          yield* Effect.sleep("1 millis");
          const second = runtime.runFork(save.submit("bad"));
          yield* Effect.sleep("1 millis");
          yield* Deferred.succeed(gates[1]!, undefined);
          const secondExit = yield* Fiber.await(second);
          expect(Exit.isFailure(secondExit)).toBe(true);
          yield* Deferred.succeed(gates[0]!, undefined);
          expect(yield* Fiber.join(first)).toBe("first");
          // The newest submission applied in full; the superseded one only as stale.
          expect(applied).toEqual([true, false]);
          expect(Option.getOrUndefined(AsyncResult.error(save.state.get().result))).toBe(
            "rejected",
          );
          yield* runtime.dispose;
        }),
      ));
  });
});

describe("Action.planOptimistic", () => {
  it("reports the value each signal patch would produce without writing it", () => {
    const title = Signal.make("Atlas", { name: "plan.title" });
    const count = Signal.make(1, { name: "plan.count" });
    const Rename = Action.define({
      name: "rename.plan-optimistic-signals",
      optimistic: (name: string, transaction) =>
        Effect.gen(function* () {
          yield* transaction.set(title, name);
          yield* transaction.set(count, (value) => value + 1);
          yield* transaction.set(count, (value) => value * 10);
        }),
      run: (name: string) => Effect.succeed(name),
    });

    const changes = Effect.runSync(Action.planOptimistic(Rename, "Apollo"));

    expect(changes).toEqual([
      { _tag: "Set", target: title, value: "Apollo" },
      { _tag: "Set", target: count, value: 2 },
      { _tag: "Set", target: count, value: 20 },
    ]);
    expect(Signal.peek(title)).toBe("Atlas");
    expect(Signal.peek(count)).toBe(1);
  });

  it("plans nothing for an Action without an optimistic patch", () => {
    const Rename = Action.define({
      name: "rename.plan-optimistic-none",
      run: (name: string) => Effect.succeed(name),
    });

    expect(Effect.runSync(Action.planOptimistic(Rename, "Apollo"))).toEqual([]);
  });

  it("treats a throwing signal updater as a defect", () => {
    const cause = new Error("updater failed");
    const title = Signal.make("Atlas", { name: "plan.title" });
    const Rename = Action.define({
      name: "rename.plan-optimistic-throw",
      optimistic: (_name: string, transaction) =>
        transaction.set(title, () => {
          throw cause;
        }),
      run: (name: string) => Effect.succeed(name),
    });

    const exit = Effect.runSyncExit(Action.planOptimistic(Rename, "Apollo"));

    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    expect(Signal.peek(title)).toBe("Atlas");
  });
});
