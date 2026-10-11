import { Cause, Clock, Deferred, Effect, Exit, Fiber, Layer, Option, PubSub } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vitest";
import {
  Action,
  makeRuntime,
  read,
  Resource,
  ResourceFailure,
  ResourcePending,
  runWithRuntime,
} from "../src/index.js";
import { settleResult, settledResult } from "../src/async-result-settle.js";

const runIn = <A, E>(
  runtime: ReturnType<typeof makeRuntime>,
  effect: Effect.Effect<A, E, any>,
): Promise<A> => Effect.runPromise(Effect.scoped(runtime.provide(effect)) as Effect.Effect<A, E>);

const fixedClock = (now: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => now,
  currentTimeMillis: Effect.sync(() => now),
  currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
  currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
  sleep: () => Effect.never,
});

describe("AsyncResult settlement", () => {
  it("settles exits with Clock time and treats interrupt-only causes as cancellation", () => {
    const previous = AsyncResult.waiting(AsyncResult.success<number, string>(1, { timestamp: 5 }));

    const success = settleResult(Exit.succeed(2), previous, 42);
    expect(success).toMatchObject({ _tag: "Success", value: 2, timestamp: 42, waiting: false });

    const failure = settleResult(Exit.fail("boom"), previous, 42);
    expect(AsyncResult.isFailure(failure) && failure.waiting).toBe(false);
    expect(AsyncResult.error(failure)).toEqual(Option.some("boom"));
    expect(AsyncResult.value(failure)).toEqual(Option.some(1));

    const defect = settleResult(Exit.die(new Error("crash")), previous, 42);
    expect(AsyncResult.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);

    const interrupted = settleResult(Exit.interrupt(1), previous, 42);
    expect(interrupted).toEqual(settledResult(previous));
    expect(interrupted).toMatchObject({ _tag: "Success", value: 1, timestamp: 5, waiting: false });
  });

  it("settles a defecting Resource load to Failure instead of leaving it waiting", async () => {
    const Crash = Resource.family<string, number>({
      name: "Settlement.resource-defect",
      load: () => Effect.die(new Error("loader crashed")),
    });
    const ref = Crash("1");

    const exit = await Effect.runPromiseExit(Resource.prefetchEffect(ref));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);

    const result = Resource.result(ref).get();
    expect(result._tag).toBe("Failure");
    expect(result.waiting).toBe(false);
    expect(AsyncResult.isFailure(result) && Cause.hasDies(result.cause)).toBe(true);
    // Defects are not typed errors.
    expect(AsyncResult.error(result)).toEqual(Option.none());

    try {
      read(ref);
      expect.fail("expected ResourceFailure");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceFailure);
      expect((error as ResourceFailure).result).toBe(result);
    }
  });

  it("keeps the previous success when a refresh defects", async () => {
    let crash = false;
    const Flaky = Resource.family<string, number>({
      name: "Settlement.resource-refresh-defect",
      load: () => (crash ? Effect.die("refresh crashed") : Effect.succeed(7)),
    });
    const ref = Flaky("1");

    await Effect.runPromise(Resource.prefetchEffect(ref));
    crash = true;
    await Effect.runPromiseExit(Resource.refreshEffect(ref));

    const result = Resource.result(ref).get();
    expect(result).toMatchObject({ _tag: "Failure", waiting: false });
    expect(AsyncResult.value(result)).toEqual(Option.some(7));
  });

  it("returns an interrupted Resource load to its prior settled result", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    let loads = 0;
    const Slow = Resource.family<string, number>({
      name: "Settlement.resource-interrupt",
      load: () =>
        Effect.gen(function* () {
          loads++;
          if (loads === 1) {
            return 1;
          }
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }),
    });
    const ref = Slow("1");
    const runtime = makeRuntime(Layer.empty);

    await runIn(runtime, Resource.prefetchEffect(ref));
    const settled = runWithRuntime(runtime, () => Resource.result(ref).get());
    expect(settled).toMatchObject({ _tag: "Success", value: 1, waiting: false });

    void runtime.runFork(Resource.refreshEffect(ref));
    await Effect.runPromise(Deferred.await(started));
    expect(runWithRuntime(runtime, () => Resource.result(ref).get())).toMatchObject({
      _tag: "Success",
      value: 1,
      waiting: true,
    });

    // Deleting the ref interrupts the in-flight load; the load settles back to
    // its prior result before the delete resets the entry.
    const events: Array<string> = [];
    await runIn(
      runtime,
      Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* Resource.subscribeEventsEffect();
          yield* Resource.deleteEffect(ref);
          const taken = yield* PubSub.takeAll(subscription);
          events.push(...Array.from(taken, (event) => event._tag));
        }),
      ),
    );
    expect(events).toContain("ResourceInterrupted");
    expect(events).not.toContain("ResourceFailure");

    await Effect.runPromise(runtime.disposeEffect);
  });

  it("settles an interrupt-only refresh back to the prior settled success", async () => {
    let cancel = false;
    const Cancellable = Resource.family<string, number>({
      name: "Settlement.resource-cancelled-refresh",
      load: () => (cancel ? Effect.interrupt : Effect.succeed(3)),
    });
    const ref = Cancellable("1");

    await Effect.runPromise(Resource.prefetchEffect(ref));
    const settled = Resource.result(ref).get();
    cancel = true;
    const exit = await Effect.runPromiseExit(Resource.refreshEffect(ref));

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(Resource.result(ref).get()).toEqual(settled);
    expect(read(ref)).toBe(3);
  });

  it("does not surface interruption of a waiting first load as a Failure", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const Never = Resource.family<string, number>({
      name: "Settlement.resource-first-load-interrupt",
      load: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
    });
    const ref = Never("1");
    const runtime = makeRuntime(Layer.empty);

    void runtime.runFork(Resource.prefetchEffect(ref));
    await Effect.runPromise(Deferred.await(started));
    expect(runWithRuntime(runtime, () => Resource.result(ref).get())).toMatchObject({
      _tag: "Initial",
      waiting: true,
    });

    // A forced refresh supersedes (interrupts) the waiting load and starts its own.
    const refresh = runtime.runFork(Resource.refreshEffect(ref));
    expect(runWithRuntime(runtime, () => Resource.result(ref).get())).toMatchObject({
      _tag: "Initial",
      waiting: true,
    });
    expect(() => runWithRuntime(runtime, () => read(ref))).toThrow(ResourcePending);

    await Effect.runPromise(Fiber.interrupt(refresh));
    await Effect.runPromise(runtime.disposeEffect);
  });

  it("stamps Resource successes with the Effect Clock", async () => {
    const Clocked = Resource.family<string, number>({
      name: "Settlement.resource-clock",
      load: () => Effect.succeed(1),
    });
    const ref = Clocked("1");

    const runtime = makeRuntime(Layer.succeed(Clock.Clock)(fixedClock(12_345)));

    await runIn(runtime, Resource.prefetchEffect(ref));
    expect(runWithRuntime(runtime, () => Resource.result(ref).get())).toMatchObject({
      _tag: "Success",
      timestamp: 12_345,
    });
    await Effect.runPromise(runtime.disposeEffect);
  });

  it("settles a defecting Action submission to Failure instead of leaving it waiting", async () => {
    const Crash = Action.define<string, number>({
      name: "Settlement.action-defect",
      run: () => Effect.die(new Error("action crashed")),
    });
    const action = Action.use(Crash);

    const exit = await Effect.runPromiseExit(action.submitEffect("go"));
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);

    const state = action.state.get();
    expect(state.input).toEqual(Option.some("go"));
    expect(state.result).toMatchObject({ _tag: "Failure", waiting: false });
    expect(AsyncResult.isFailure(state.result) && Cause.hasDies(state.result.cause)).toBe(true);
  });

  it("returns an interrupted Action submission to its prior settled state", async () => {
    const started = Effect.runSync(Deferred.make<void>());
    const Rename = Action.define<string, string>({
      name: "Settlement.action-interrupt",
      run: (name) =>
        name === "slow"
          ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.succeed(name),
    });
    const action = Action.use(Rename);

    await Effect.runPromise(action.submitEffect("Ada"));
    const settled = action.state.get();
    expect(settled.result).toMatchObject({ _tag: "Success", value: "Ada", waiting: false });

    const submission = Effect.runFork(action.submitEffect("slow"));
    await Effect.runPromise(Deferred.await(started));
    expect(action.state.get().result.waiting).toBe(true);
    expect(action.state.get().input).toEqual(Option.some("slow"));

    await Effect.runPromise(Fiber.interrupt(submission));
    expect(action.state.get()).toBe(settled);
  });
});
