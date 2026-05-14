import { Deferred, Effect, Fiber, Schedule } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Action, makeRuntime, read, Resource, runWithRuntime, Signal } from "../src/index.js";

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
      await runtime.runPromise(Resource.prefetchEffect(ref));

      const Increment = Action.define({
        name: "increment.runtime-action",
        run: () => Effect.sync(() => {
          value++;
          return value;
        }),
        invalidates: () => [ref]
      });

      await runtime.runPromise(Action.use(Increment, { runtime }).submitEffect(undefined));

      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
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

    const Increment = Action.define({
      name: "increment.plan",
      run: () => Effect.succeed(1),
      invalidates: () => [CountTag]
    });
    const action = Action.use(Increment);

    await Effect.runPromise(action.submitEffect(undefined));

    const plan = read(action.invalidationPlan);
    expect(plan?.targets).toEqual([CountTag]);
    expect(plan?.entries.map((entry) => entry.ref.key)).toEqual([ref.key]);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      invalidationPlan: plan
    });
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
