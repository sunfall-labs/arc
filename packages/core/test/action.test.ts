import { Deferred, Effect, Schedule } from "effect";
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
    const promise = action.submit("Ada");
    expect(read(action.state)._tag).toBe("Pending");
    await promise;

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
    await Resource.prefetch(ref);

    const Increment = Action.define({
      name: "increment",
      run: () => Effect.sync(() => {
        value++;
        return value;
      }),
      invalidates: () => [ref]
    });

    await Action.use(Increment).submit(undefined);

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
    await Resource.prefetch(ref);

    const Increment = Action.define({
      name: "increment.tag",
      run: () => Effect.sync(() => {
        value++;
        return value;
      }),
      invalidates: () => [CountTag]
    });

    await Action.use(Increment).submit(undefined);

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

      await Action.use(Increment, { runtime }).submit(undefined);

      expect(runWithRuntime(runtime, () => read(ref))).toBe(1);
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
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
    await Resource.prefetch(ref);

    const Increment = Action.define({
      name: "increment.plan",
      run: () => Effect.succeed(1),
      invalidates: () => [CountTag]
    });
    const action = Action.use(Increment);

    await action.submit(undefined);

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

    await Promise.allSettled([action.submit("first"), action.submit("second")]);

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

    const first = action.submit("first").catch(() => undefined);
    await Effect.runPromise(Effect.sleep("10 millis"));
    await action.submit("second");
    await first;

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

    await expect(action.submit(undefined)).resolves.toBe("done");

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

    const promise = action.submit("Published");

    await expect(promise).resolves.toBe("Published");
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

    await Action.use(Clear).submit(undefined);

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

    await expect(action.submit("Published")).rejects.toBe("boom");

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

    const first = action.submit("Stale").catch(() => undefined);
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(read(title)).toBe("Stale");

    const second = action.submit("Published");
    await Effect.runPromise(Deferred.await(secondOptimisticApplied));

    expect(read(title)).toBe("Published");
    await expect(second).resolves.toBe("Published");
    await first;
    expect(read(title)).toBe("Published");
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

    const first = action.submit("first");
    const second = action.submit("second");
    Effect.runSync(Deferred.succeed(release, undefined));

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("first");

    expect(runs).toBe(1);
    expect(read(action.state)).toMatchObject({
      _tag: "Success",
      input: "first",
      value: "first"
    });
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

    await expect(Promise.all([action.submit("first"), action.submit("second")])).resolves.toEqual([
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
});
