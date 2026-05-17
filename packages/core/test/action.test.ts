import { Context, Deferred, Effect, Exit, Fiber, Layer, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Action, EffectInputCallbackError, EffectInputPromiseRejected, makeRuntime, read, Resource, runWithRuntime, Signal } from "../src/index.js";
import { makeActionOptimisticTransactionRuntime } from "../src/action-optimistic.js";

describe("Action", () => {
  it("tracks status transitions", async () => {
    const Rename = Action.define({
      name: "rename",
      run: (name: string) => Effect.sleep("1 millis").pipe(Effect.as({ name }))
    });
    const action = Action.use(Rename);

    expect(read(action.state)._tag).toBe("Idle");
    const submission = Effect.runFork(action.submitEffect("Ada"));
    expect(read(action.state)._tag).toBe("Pending");
    await Effect.runPromise(Fiber.join(submission));

    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: { name: "Ada" }
    });
  });

  it("exposes native Effect submission", async () => {
    const Rename = Action.define({
      name: "rename.effect",
      run: (name: string) => Effect.succeed({ name })
    });
    const action = Action.use(Rename);

    await expect(Effect.runPromise(action.submitEffect("Grace"))).resolves.toEqual({
      name: "Grace"
    });
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: { name: "Grace" }
    });
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
                : Effect.void
        });
        const action = Action.use(Complete);

        yield* action.submitEffect("success");

        const pendingFiber = yield* action.submitEffect("wait").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Effect.sync(() => {
          expect(action.state.get()).toEqual({
            _tag: "Pending",
            input: "wait",
            previous: undefined,
            hasPrevious: true
          });
        });
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(pendingFiber);

        const exit = yield* Effect.exit(action.submitEffect("fail"));
        yield* Effect.sync(() => {
          expect(exit._tag).toBe("Failure");
          expect(action.state.get()).toEqual({
            _tag: "Failure",
            input: "fail",
            error: "failed",
            previous: undefined,
            hasPrevious: true
          });
        });
      })
    ));

  it("captures synchronous run throws in the Effect error channel", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.sync-throw",
      run: () => {
        throw new Error("rename failed");
      }
    });
    const action = Action.use(Rename);

    const exit = await Effect.runPromise(Effect.exit(action.submitEffect("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
      expect(action.state.get()).toMatchObject({
        _tag: "Failure",
        input: "Ada"
      });
    }
  });

  it("captures erased Promise-shaped run returns as failures instead of leaving pending state", async () => {
    const Rename = Action.define<string, string>({
      name: "rename.promise-erased",
      run: () => Promise.resolve("Ada") as never
    });
    const action = Action.use(Rename);

    const exit = await Effect.runPromise(Effect.exit(action.submitEffect("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.run(rename.promise-erased)",
        cause: expect.any(EffectInputPromiseRejected)
      });
      expect(action.state.get()).toMatchObject({
        _tag: "Failure",
        input: "Ada"
      });
    }
  });

  it("captures synchronous optimistic callback throws in the Effect error channel", async () => {
    const cause = new Error("optimistic failed");
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-sync-throw",
      optimistic: () => {
        throw cause;
      },
      run: (name) => Effect.succeed(name)
    });
    const action = Action.use(Rename);

    const exit = await Effect.runPromise(Effect.exit(action.submitEffect("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
      expect((failure?.error as EffectInputCallbackError).cause).toBe(cause);
      expect(action.state.get()).toMatchObject({
        _tag: "Failure",
        input: "Ada"
      });
    }
  });

  it("captures optimistic signal updater throws in the Effect error channel", async () => {
    const cause = new Error("optimistic signal failed");
    const title = Signal.make("Draft");
    const Rename = Action.define<string, string>({
      name: "rename.optimistic-signal-sync-throw",
      optimistic: (_next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(title, () => {
            throw cause;
          });
          return Effect.void;
        }),
      run: (name) => Effect.succeed(name)
    });
    const action = Action.use(Rename);

    const exit = await Effect.runPromise(Effect.exit(action.submitEffect("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
      expect(failure?.error).toMatchObject({
        operation: "Action.optimistic(rename.optimistic-signal-sync-throw).signal",
        cause
      });
      expect(read(title)).toBe("Draft");
      expect(action.state.get()).toMatchObject({
        _tag: "Failure",
        input: "Ada"
      });
    }
  });

  it("captures optimistic signal updater throws during transaction rebase", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cause = new Error("optimistic rebase failed");
        const title = Signal.make("Draft");
        const first = makeActionOptimisticTransactionRuntime<never>("rename.optimistic-rebase");
        const second = makeActionOptimisticTransactionRuntime<never>("rename.optimistic-rebase");

        yield* first.api.signal(title, "First");
        let throwOnRebase = false;
        yield* second.api.signal(title, (current) => {
          if (throwOnRebase) {
            throw cause;
          }
          return `${current}:Second`;
        });

        yield* Effect.sync(() => {
          expect(read(title)).toBe("First:Second");
        });

        throwOnRebase = true;
        const failure = yield* Effect.flip(first.commit);

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: "Action.optimistic(rename.optimistic-rebase).signal",
            cause
          });
          expect(read(title)).toBe("First:Second");
        });
      })
    ));

  it("keeps optimistic transaction finish atomic across multiple signals", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cause = new Error("optimistic multi-signal rebase failed");
        const left = Signal.make("left:base");
        const right = Signal.make("right:base");
        const first = makeActionOptimisticTransactionRuntime<never>("rename.optimistic-atomic");
        const second = makeActionOptimisticTransactionRuntime<never>("rename.optimistic-atomic");

        yield* first.api.signal(left, "left:first");
        yield* first.api.signal(right, "right:first");

        yield* second.api.signal(left, (current) => `${current}:second`);
        let throwOnRightRebase = false;
        yield* second.api.signal(right, (current) => {
          if (throwOnRightRebase) {
            throw cause;
          }
          return `${current}:second`;
        });

        yield* Effect.sync(() => {
          expect(read(left)).toBe("left:first:second");
          expect(read(right)).toBe("right:first:second");
        });

        throwOnRightRebase = true;
        const failure = yield* Effect.flip(first.commit);

        throwOnRightRebase = false;
        yield* first.rollback;

        yield* Effect.sync(() => {
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect(failure).toMatchObject({
            operation: "Action.optimistic(rename.optimistic-atomic).signal",
            cause
          });
          expect(read(left)).toBe("left:base:second");
          expect(read(right)).toBe("right:base:second");
        });
      })
    ));

  it("captures synchronous invalidation callback throws in the Effect error channel", async () => {
    const cause = new Error("invalidates failed");
    const Rename = Action.define<string, string>({
      name: "rename.invalidates-sync-throw",
      run: (name) => Effect.succeed(name),
      invalidates: () => {
        throw cause;
      }
    });
    const action = Action.use(Rename);

    const exit = await Effect.runPromise(Effect.exit(action.submitEffect("Ada")));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      expect(failure?.error).toBeInstanceOf(EffectInputCallbackError);
      expect((failure?.error as EffectInputCallbackError).cause).toBe(cause);
      expect(action.state.get()).toMatchObject({
        _tag: "Failure",
        input: "Ada"
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
      }
    });

    expect(() => Action.planInvalidation(Rename, "Ada", "Ada")).toThrow(EffectInputCallbackError);
    try {
      Action.planInvalidation(Rename, "Ada", "Ada");
      expect.fail("Expected Action.planInvalidation to throw a typed callback error");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "EffectInputCallbackError",
        operation: "Action.invalidates(rename.invalidates-sync-plan-throw)",
        cause
      });
    }
  });

  it("invalidates typed resource refs on success", async () => {
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "Count.invalidate",
      load
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.prefetchEffect(ref));

    const Increment = Action.define({
      name: "increment",
      run: () => Effect.sync(() => {
        value++;
        return value;
      }),
      invalidates: () => [ref]
    });

    await Effect.runPromise(Action.use(Increment).submitEffect(undefined));

    expect(read(ref)).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates semantic resource tags on success", async () => {
    const CountTag = Resource.tag("Count.action-tag");
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "Count.invalidate-tag",
      load,
      provides: () => [CountTag]
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.prefetchEffect(ref));

    const Increment = Action.define({
      name: "increment.tag",
      run: () => Effect.sync(() => {
        value++;
        return value;
      }),
      invalidates: () => [CountTag]
    });

    await Effect.runPromise(Action.use(Increment).submitEffect(undefined));

    expect(read(ref)).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates resources inside an explicit runtime store", async () => {
    const runtime = makeRuntime();
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "Count.runtime-action",
      load
    });
    const ref = Count(undefined);

    try {
      await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

      const Increment = Action.define({
        name: "increment.runtime-action",
        run: () => Effect.sync(() => {
          value++;
          return value;
        }),
        invalidates: () => [ref]
      });

      await Effect.runPromise(runtime.provide(Action.use(Increment, { runtime }).submitEffect(undefined)));

      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps remaining services on runtime-bound submissions", async () => {
    interface RuntimeApi {
      readonly prefix: string;
    }
    interface CallerApi {
      readonly suffix: string;
    }
    const RuntimeApi = Context.Service<RuntimeApi>("@effect-ui/core/test/ActionRuntimeApi");
    const CallerApi = Context.Service<CallerApi>("@effect-ui/core/test/ActionCallerApi");
    const runtime = makeRuntime(
      Layer.succeed(RuntimeApi)({
        prefix: "runtime"
      })
    );
    const Join = Action.define<void, string, never, RuntimeApi | CallerApi>({
      name: "join.runtime-bound.remaining-service",
      run: () =>
        Effect.gen(function* () {
          const runtimeApi = yield* RuntimeApi;
          const callerApi = yield* CallerApi;
          return `${runtimeApi.prefix}:${callerApi.suffix}`;
        })
    });

    try {
      const action = Action.use(Join, { runtime });
      const value = await Effect.runPromise(
        action.submitEffect(undefined).pipe(
          Effect.provideService(CallerApi, { suffix: "caller" })
        )
      );

      expect(value).toBe("runtime:caller");
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("keeps reset local for runtime-bound actions", async () => {
    const runtime = makeRuntime(Layer.effectDiscard(Effect.fail("runtime unavailable")));
    const Save = Action.define<void, string>({
      name: "save.runtime-reset-local",
      run: () => Effect.succeed("saved")
    });
    const action = Action.use(Save, { runtime });

    try {
      await expect(Effect.runPromise(action.resetEffect())).resolves.toBeUndefined();
      expect(() => action.reset()).not.toThrow();
      await expect(Effect.runPromise(Effect.flip(action.submitEffect(undefined)))).resolves.toBe("runtime unavailable");
    } finally {
      await Effect.runPromise(Effect.ignore(runtime.disposeEffect));
    }
  });

  it("resets state after the captured action runtime has been disposed", async () => {
    const runtime = makeRuntime();
    const Save = Action.define<void, string>({
      name: "save.runtime-reset-disposed",
      run: () => Effect.succeed("saved")
    });
    const action = Action.use(Save, { runtime });

    await Effect.runPromise(action.submitEffect(undefined));
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "saved"
    });

    await Effect.runPromise(runtime.disposeEffect);
    action.reset();
    await Effect.runPromise(Effect.sleep("10 millis"));

    expect(read(action.state)).toEqual({ _tag: "Idle" });
  });

  it("exposes the latest invalidation plan for submitted actions", async () => {
    const CountTag = Resource.tag("Count.action-plan");
    const Count = Resource.family({
      name: "Count.action-plan",
      load: () => Effect.succeed(0),
      provides: () => [CountTag]
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.prefetchEffect(ref));

    const invalidationTargets = [CountTag];
    const Increment = Action.define({
      name: "increment.plan",
      run: () => Effect.succeed(1),
      invalidates: () => invalidationTargets
    });
    const action = Action.use(Increment);

    await Effect.runPromise(action.submitEffect(undefined));
    invalidationTargets.push(Resource.tag("Count.action-plan-ignored"));

    const plan = read(action.invalidationPlan);
    expect(plan?.targets).toEqual([CountTag]);
    expect(Object.isFrozen(plan?.targets)).toBe(true);
    expect(plan?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      invalidationPlan: plan
    });
    expect(() => (plan?.targets as Resource.Invalidation[]).push(CountTag)).toThrow(TypeError);
  });

  it("keeps only the latest submission in state", async () => {
    const Finish = Action.define({
      name: "finish",
      run: (value: string) => Effect.succeed(value)
    });
    const action = Action.use(Finish);

    await Effect.runPromise(
      Effect.all([
        action.submitEffect("first").pipe(Effect.exit),
        action.submitEffect("second").pipe(Effect.exit)
      ], { concurrency: "unbounded" })
    );

    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "second"
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
              })
            )
          : Effect.succeed(value)
    });
    const action = Action.use(Finish);

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action.submitEffect("first").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Effect.sleep("10 millis");
        yield* action.submitEffect("second");
        yield* Fiber.await(first);
      })
    );

    expect(interrupted).toBe(true);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "second"
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
              })
            )
          : Effect.succeed(value)
    });
    const action = Action.use(Finish);

    const first = Effect.runFork(action.submitEffect("first"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    await expect(Effect.runPromise(action.submitEffect("second"))).resolves.toBe("second");
    await Effect.runPromise(Effect.exit(Fiber.join(first)));

    expect(interrupted).toBe(true);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "second"
    });
  });

  it("uses Effect schedules for retry policy", async () => {
    let attempts = 0;
    const Finish = Action.define({
      name: "finish.retry",
      policy: {
        retry: Schedule.recurs(2)
      },
      run: () =>
        Effect.gen(function* () {
          attempts++;
          if (attempts < 3) {
            return yield* Effect.fail("temporary");
          }
          return "done";
        })
    });
    const action = Action.use(Finish);

    await expect(Effect.runPromise(action.submitEffect(undefined))).resolves.toBe("done");

    expect(attempts).toBe(3);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "done"
    });
  });

  it("commits optimistic signal patches on success", async () => {
    const title = Signal.make("Draft");
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.success",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(title, next);
          return Effect.void;
        }),
      run: (next) => Effect.succeed(next)
    });
    const action = Action.use(Rename);

    const submission = Effect.runFork(action.submitEffect("Published"));

    await expect(Effect.runPromise(Fiber.join(submission))).resolves.toBe("Published");
    expect(read(title)).toBe("Published");
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      value: "Published"
    });
  });

  it("commits optimistic patches whose value is undefined", async () => {
    const selected = Signal.make<string | undefined>("Draft");
    const Clear = Action.define<void, void>({
      name: "clear.optimistic.undefined",
      optimistic: (_, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(selected, undefined);
          return Effect.void;
        }),
      run: () => Effect.void
    });

    await Effect.runPromise(Action.use(Clear).submitEffect(undefined));

    expect(read(selected)).toBeUndefined();
  });

  it("does not invalidate resources when optimistic commit fails", async () => {
    const title = Signal.make("Draft");
    let shouldFailCommit = false;
    let value = 0;
    const load = vi.fn(() => Effect.succeed(value));
    const Count = Resource.family({
      name: "Count.optimistic-commit-before-invalidation",
      load
    });
    const ref = Count(undefined);
    await Effect.runPromise(Resource.prefetchEffect(ref));

    const Publish = Action.define<void, number>({
      name: "publish.optimistic-commit-before-invalidation",
      optimistic: (_input, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(title, () => {
            if (shouldFailCommit) {
              throw new Error("commit failed");
            }
            return "Published";
          });
          return Effect.void;
        }),
      run: () =>
        Effect.sync(() => {
          value = 1;
          shouldFailCommit = true;
          return value;
        }),
      invalidates: () => [ref]
    });

    await expect(Effect.runPromise(Action.use(Publish).submitEffect(undefined))).rejects.toMatchObject({
      _tag: "EffectInputCallbackError",
      operation: "Action.optimistic(publish.optimistic-commit-before-invalidation).signal"
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(read(ref)).toBe(0);
    expect(read(title)).toBe("Draft");
  });

  it("rolls back optimistic finalizers on failure", async () => {
    const title = Signal.make("Draft");
    const Rename = Action.define<string, string, string>({
      name: "rename.optimistic.failure",
      optimistic: (next) =>
        Effect.sync(() => {
          const previous = Signal.peek(title);
          Signal.set(title, next);
          return Effect.sync(() => Signal.set(title, previous));
        }),
      run: () => Effect.fail("boom")
    });
    const action = Action.use(Rename);

    await expect(Effect.runPromise(action.submitEffect("Published"))).rejects.toBe("boom");

    expect(read(title)).toBe("Draft");
    expect(read(action.state)).toMatchObject({
      _tag: "Failure",
      error: "boom",
      input: "Published"
    });
  });

  it("rolls back interrupted latest optimism before applying the next patch", async () => {
    const title = Signal.make("Draft");
    const secondOptimisticApplied = Effect.runSync(Deferred.make<void>());
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.latest",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(title, next);
          if (next === "Published") {
            yield* Deferred.succeed(secondOptimisticApplied, undefined);
          }
          return Effect.void;
        }),
      run: (next) => next === "Stale" ? Effect.never : Effect.succeed(next)
    });
    const action = Action.use(Rename);

    const first = Effect.runFork(action.submitEffect("Stale"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(read(title)).toBe("Stale");

    const second = Effect.runFork(action.submitEffect("Published"));
    await Effect.runPromise(Deferred.await(secondOptimisticApplied));

    expect(read(title)).toBe("Published");
    await expect(Effect.runPromise(Fiber.join(second))).resolves.toBe("Published");
    await Effect.runPromise(Fiber.await(first));
    expect(read(title)).toBe("Published");
  });

  it("rolls back optimistic patches when interrupted inside optimistic work", () => {
    const title = Signal.make("Draft");
    const firstOptimisticApplied = Effect.runSync(Deferred.make<void>());
    const holdFirstOptimistic = Effect.runSync(Deferred.make<void>());
    const Rename = Action.define<string, string>({
      name: "rename.optimistic.interrupted-optimistic",
      optimistic: (next, transaction) =>
        Effect.gen(function* () {
          yield* transaction.signal(title, next);
          if (next === "Stale") {
            yield* Deferred.succeed(firstOptimisticApplied, undefined);
            yield* Deferred.await(holdFirstOptimistic);
          }
          return Effect.void;
        }),
      run: (next) => Effect.succeed(next)
    });
    const action = Action.use(Rename);

    return Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action.submitEffect("Stale").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Deferred.await(firstOptimisticApplied);
        yield* Effect.sync(() => {
          expect(read(title)).toBe("Stale");
        });

        const second = yield* action.submitEffect("Published").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        const secondValue = yield* Fiber.join(second);
        yield* Fiber.await(first);

        yield* Effect.sync(() => {
          expect(secondValue).toBe("Published");
          expect(read(title)).toBe("Published");
          expect(read(action.state)).toMatchObject({
            _tag: "Success",
            value: "Published"
          });
        });
      })
    );
  });

  it("supports exhaust concurrency for event submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.exhaust",
      policy: {
        concurrency: "exhaust"
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        })
    });
    const action = Action.use(Finish);

    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action.submitEffect("first").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        const second = yield* action.submitEffect("second").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Deferred.succeed(release, undefined);
        return yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second)
        ], { concurrency: "unbounded" });
      })
    );

    expect(first).toBe("first");
    expect(second).toBe("first");

    expect(runs).toBe(1);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      input: "first",
      value: "first"
    });
  });

  it("supports exhaust concurrency for native Effect submissions", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-exhaust",
      policy: {
        concurrency: "exhaust"
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        })
    });
    const action = Action.use(Finish);

    const first = Effect.runFork(action.submitEffect("first"));
    await Effect.runPromise(Effect.sleep("10 millis"));
    const second = Effect.runFork(action.submitEffect("second"));
    Effect.runSync(Deferred.succeed(release, undefined));

    await expect(Effect.runPromise(Fiber.join(first))).resolves.toBe("first");
    await expect(Effect.runPromise(Fiber.join(second))).resolves.toBe("first");
    expect(runs).toBe(1);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      input: "first",
      value: "first"
    });
  });

  it("resetEffect interrupts active exhaust submissions before accepting new work", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const interrupted = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-exhaust-reset",
      policy: {
        concurrency: "exhaust"
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          if (value === "first") {
            yield* Deferred.succeed(started, undefined);
            return yield* Effect.never.pipe(
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
            );
          }
          return value;
        })
    });
    const action = Action.use(Finish);

    const first = Effect.runFork(action.submitEffect("first"));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(action.resetEffect());
    await Effect.runPromise(Deferred.await(interrupted));

    await expect(Effect.runPromise(action.submitEffect("second"))).resolves.toBe("second");
    await Effect.runPromise(Fiber.await(first));

    expect(runs).toBe(2);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      input: "second",
      value: "second"
    });
  });

  it("lets event exhaust submissions join a native Effect submission", async () => {
    const release = Effect.runSync(Deferred.make<void>());
    let runs = 0;
    const Finish = Action.define({
      name: "finish.effect-event-exhaust",
      policy: {
        concurrency: "exhaust"
      },
      run: (value: string) =>
        Effect.gen(function* () {
          runs++;
          yield* Deferred.await(release);
          return value;
        })
    });
    const action = Action.use(Finish);

    const [firstResult, secondResult] = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* action.submitEffect("first").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Effect.sleep("10 millis");
        const second = yield* action.submitEffect("second").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Deferred.succeed(release, undefined);
        return yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second)
        ], { concurrency: "unbounded" });
      })
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
        concurrency: "parallel"
      },
      run: (value: string) =>
        value === "first"
          ? Effect.onInterrupt(
              Effect.sleep("20 millis").pipe(Effect.as(value)),
              Effect.sync(() => {
                firstInterrupted = true;
              })
            )
          : Effect.succeed(value)
    });
    const action = Action.use(Finish);

    await expect(Effect.runPromise(
      Effect.all([
        action.submitEffect("first"),
        action.submitEffect("second")
      ], { concurrency: "unbounded" })
    )).resolves.toEqual([
      "first",
      "second"
    ]);

    expect(firstInterrupted).toBe(false);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      input: "second",
      value: "second"
    });
  });

  it("resetEffect interrupts all active parallel submissions before invalidation", async () => {
    const firstStarted = Effect.runSync(Deferred.make<void>());
    const secondStarted = Effect.runSync(Deferred.make<void>());
    const firstInterrupted = Effect.runSync(Deferred.make<void>());
    const secondInterrupted = Effect.runSync(Deferred.make<void>());
    const release = Effect.runSync(Deferred.make<void>());
    const invalidates = vi.fn(() => []);
    const Finish = Action.define<string, string>({
      name: "finish.parallel-reset",
      policy: {
        concurrency: "parallel"
      },
      run: (value) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(value === "first" ? firstStarted : secondStarted, undefined);
          return yield* Deferred.await(release).pipe(
            Effect.as(value),
            Effect.onInterrupt(() =>
              Deferred.succeed(value === "first" ? firstInterrupted : secondInterrupted, undefined)
            )
          );
        }),
      invalidates
    });
    const action = Action.use(Finish);

    const first = Effect.runFork(action.submitEffect("first"));
    const second = Effect.runFork(action.submitEffect("second"));
    await Effect.runPromise(Deferred.await(firstStarted));
    await Effect.runPromise(Deferred.await(secondStarted));

    await Effect.runPromise(action.resetEffect());
    await Effect.runPromise(Deferred.await(firstInterrupted));
    await Effect.runPromise(Deferred.await(secondInterrupted));
    await Effect.runPromise(Deferred.succeed(release, undefined));

    const exits = await Effect.runPromise(Effect.all([
      Fiber.await(first),
      Fiber.await(second)
    ], { concurrency: "unbounded" }));

    expect(exits.every(Exit.isFailure)).toBe(true);
    expect(invalidates).not.toHaveBeenCalled();
    expect(read(action.state)).toEqual({ _tag: "Idle" });
  });

  it("keeps stale parallel successes from replacing the latest invalidation plan", () => {
    const FirstTag = Resource.tag("Action.parallel-plan.first");
    const SecondTag = Resource.tag("Action.parallel-plan.second");
    const firstLoad = vi.fn(() => Effect.succeed("first"));
    const secondLoad = vi.fn(() => Effect.succeed("second"));
    const First = Resource.family({
      name: "Action.parallel-plan.first",
      load: firstLoad,
      provides: () => [FirstTag]
    });
    const Second = Resource.family({
      name: "Action.parallel-plan.second",
      load: secondLoad,
      provides: () => [SecondTag]
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
        concurrency: "parallel"
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
      invalidates: (_value, input) => [input === "first" ? FirstTag : SecondTag]
    });
    const action = Action.use(Update);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Resource.prefetchEffect(firstRef);
        yield* Resource.prefetchEffect(secondRef);

        const first = yield* action.submitEffect("first").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Deferred.await(firstStarted);
        const second = yield* action.submitEffect("second").pipe(
          Effect.forkChild({ startImmediately: true })
        );
        yield* Deferred.await(secondStarted);

        yield* Deferred.succeed(secondRelease, undefined);
        const secondValue = yield* Fiber.join(second);
        yield* Effect.sync(() => {
          expect(secondValue).toBe("second");
          expect(read(action.invalidationPlan)?.targets).toEqual([SecondTag]);
          expect(secondLoad).toHaveBeenCalledTimes(2);
        });

        yield* Deferred.succeed(firstRelease, undefined);
        const firstValue = yield* Fiber.join(first);

        yield* Effect.sync(() => {
          expect(firstValue).toBe("first");
          expect(firstLoad).toHaveBeenCalledTimes(2);
          expect(read(action.invalidationPlan)?.targets).toEqual([SecondTag]);
          expect(read(action.state)).toMatchObject({
            _tag: "Success",
            input: "second",
            value: "second"
          });
        });
      })
    );
  });
});
