import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  makeRuntime,
  Program,
  Timeline,
} from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

interface CounterApi {
  readonly load: Effect.Effect<number>;
}

const CounterApi = Context.Service<CounterApi>("@sunfall/arc-core/test/CounterApi");

type Increment = { readonly _tag: "Increment" };
const increment: Increment = { _tag: "Increment" };

describe("Program", () => {
  it("steps tagged message handlers purely and runs returned commands explicitly", () => {
    type Model = { readonly count: number; readonly loading: boolean };
    type Message =
      | { readonly _tag: "Increment" }
      | { readonly _tag: "QueueIncrement" }
      | { readonly _tag: "Load" }
      | { readonly _tag: "Loaded"; readonly amount: number };

    const Counter = Program.define<Model, Message>({
      initial: { count: 0, loading: false },
      on: {
        Increment: (model) => ({ ...model, count: model.count + 1 }),
        QueueIncrement: (model) =>
          Program.next(model, Program.emit({ _tag: "Increment" } as const)),
        Load: (model) =>
          Program.next(
            { ...model, loading: true },
            Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
          ),
        Loaded: (model, message) => ({
          count: model.count + message.amount,
          loading: false,
        }),
      },
    });

    const incremented = Program.step(Counter, Counter.initial, { _tag: "Increment" });
    expect(incremented.model).toEqual({ count: 1, loading: false });
    expect(incremented.commands).toEqual([]);

    const queued = Program.step(Counter, incremented.model, { _tag: "QueueIncrement" });
    expect(queued.model).toBe(incremented.model);
    expect(queued.commands).toHaveLength(1);
    expect(Effect.runSync(queued.commands[0]!.effect)).toEqual({ _tag: "Increment" });

    const load = Program.step(Counter, queued.model, { _tag: "Load" });
    expect(load.model).toEqual({ count: 1, loading: true });
    expect(load.commands).toHaveLength(1);

    const loaded = Effect.runSync(load.commands[0]!.effect);
    expect(loaded).toEqual({ _tag: "Loaded", amount: 2 });
    expect(Program.step(Counter, load.model, { _tag: "Loaded", amount: 2 }).model).toEqual({
      count: 3,
      loading: false,
    });
  });

  it("throws from Program.step when a handler throws or returns a Promise-shaped model", () => {
    type Message = { readonly _tag: "Throw" } | { readonly _tag: "Promise" };
    const Broken = Program.define<number, Message>({
      initial: 0,
      on: {
        Throw: () => {
          throw new Error("boom");
        },
        Promise: () => Promise.resolve(1) as never,
      },
    });

    expect(() => Program.step(Broken, 0, { _tag: "Throw" })).toThrow("boom");
    expect(() => Program.step(Broken, 0, { _tag: "Promise" })).toThrow(EffectInputCallbackError);
  });

  it("updates centralized model state and runs Effect commands with services", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loaded = yield* Deferred.make<void>();
        const runtime = makeRuntime(
          Layer.succeed(CounterApi)({
            load: Effect.succeed(3),
          }),
        );
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Increment" }
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const program = Program.start(
          Program.define<Model, Message, never, CounterApi>({
            initial: { count: 0, loading: false },
            on: {
              Increment: (model) => ({ ...model, count: model.count + 1 }),
              Load: (model) =>
                Program.next(
                  { ...model, loading: true },
                  Program.emit(
                    CounterApi.use((api) =>
                      api.load.pipe(Effect.map((amount) => ({ _tag: "Loaded", amount }) as const)),
                    ),
                  ),
                ),
              Loaded: (model, message) =>
                Program.next(
                  {
                    count: model.count + message.amount,
                    loading: false,
                  },
                  Program.emit(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid)),
                ),
            },
          }),
          { runtime },
        );

        yield* program.dispatch({ _tag: "Increment" });
        expect(program.model.get()).toEqual({ count: 1, loading: false });

        yield* program.dispatch({ _tag: "Load" });
        yield* Deferred.await(loaded);

        expect(program.model.get()).toEqual({ count: 4, loading: false });
        yield* program.dispose;
        yield* runtime.dispose;
      }),
    ));

  it("reports throwing handlers as Update failures without replacing the current model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Message = { readonly _tag: "Increment" } | { readonly _tag: "Fail" };
        const program = Program.start(
          Program.define<number, Message>({
            initial: 0,
            on: {
              Increment: (model) => model + 1,
              Fail: () => {
                throw new Error("boom");
              },
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch({ _tag: "Increment" });
        const failure = yield* Effect.flip(program.dispatch({ _tag: "Fail" }));

        expect(program.model.get()).toBe(1);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: { _tag: "Fail" },
          error: expect.any(EffectInputCallbackError),
        });
        expect(((failure.error as EffectInputCallbackError).cause as Error).message).toBe("boom");
        expect(program.failures.get()).toEqual([failure]);
        program.clearFailures();
        expect(program.failures.get()).toEqual([]);

        yield* program.dispose;
      }),
    ));

  it("reports messages without a handler as Update failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch({ _tag: "Unknown" } as never));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  it("reports erased Promise-shaped handler returns as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: () => Promise.resolve(1) as never },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(increment));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: increment,
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
      }),
    ));

  it("reports erased Effect-shaped handler returns as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => Effect.succeed(model + 1) as never },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(increment));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: increment,
          error: expect.any(EffectInputCallbackError),
        });

        yield* program.dispose;
      }),
    ));

  it("reports erased Promise-shaped Program.next models as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: () => Program.next(Promise.resolve(1) as never) },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(increment));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: increment,
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
      }),
    ));

  it("reports erased Effect-shaped Program.next models as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: () => Program.next(Effect.succeed(1) as never) },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(increment));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: increment,
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  it("rejects erased Promise-shaped initial models before starting a Program", () => {
    expect(() =>
      Program.start(
        Program.define<number, Increment>({
          initial: Promise.resolve(0) as never,
          on: { Increment: (model) => model },
        }),
        { runtime: defaultRuntime },
      ),
    ).toThrow(EffectInputCallbackError);
  });

  it("rejects erased Effect-shaped initial models before starting a Program", () => {
    expect(() =>
      Program.start(
        Program.define<number, Increment>({
          initial: Effect.succeed(0) as never,
          on: { Increment: (model) => model },
        }),
        { runtime: defaultRuntime },
      ),
    ).toThrow(EffectInputCallbackError);
  });

  it("reports erased Promise-shaped dispatch messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(Promise.resolve(increment) as never));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
      }),
    ));

  it("reports erased undefined dispatch messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(undefined as never));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
      }),
    ));

  it("reports erased Effect-shaped dispatch messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(Effect.succeed(increment) as never));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  type LoadMessage = { readonly _tag: "Load" } | { readonly _tag: "Loaded" };
  const load: LoadMessage = { _tag: "Load" };

  it("reports erased Promise-shaped command messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, LoadMessage>({
            initial: 0,
            on: {
              Load: (model) =>
                Program.next(
                  model,
                  Program.emit<LoadMessage>(
                    Effect.succeed(Promise.resolve({ _tag: "Loaded" }) as never),
                  ),
                ),
              Loaded: (model) => model + 1,
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch(load);
        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: load,
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure!.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );

        yield* program.dispose;
      }),
    ));

  it("reports erased Effect-shaped command messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, LoadMessage>({
            initial: 0,
            on: {
              Load: (model) =>
                Program.next(
                  model,
                  Program.emit<LoadMessage>(
                    Effect.succeed(Effect.succeed({ _tag: "Loaded" }) as never),
                  ),
                ),
              Loaded: (model) => model + 1,
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch(load);
        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: load,
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure!.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  it("records command failure source messages in failures and on the Timeline", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        type Message = { readonly _tag: "Load" };
        const program = Program.start(
          Program.define<number, Message, string>({
            initial: 0,
            on: {
              Load: (model) =>
                Program.next(model, Program.emit<Message, string>(Effect.fail("offline"))),
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch({ _tag: "Load" });
        yield* Effect.sleep("0 millis");

        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: { _tag: "Load" },
          error: "offline",
        });
        const failureCommit = recording.entries
          .get()
          .find((entry) => entry.changes.some((change) => change.signal === program.failures));
        expect(failureCommit?.cause).toEqual({
          _tag: "Program",
          program: undefined,
          event: "failure",
          message: { _tag: "Load" },
        });

        yield* program.dispose;
      }).pipe(Effect.scoped),
    ));

  it("reports erased Promise-shaped subscription messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
            subscriptions: () =>
              Program.subscription<Increment>(Stream.succeed(Promise.resolve(increment) as never)),
          }),
          { runtime: defaultRuntime },
        );

        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Subscription",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure!.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );

        yield* program.dispose;
      }),
    ));

  it("reports erased Effect-shaped subscription messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
            subscriptions: () =>
              Program.subscription<Increment>(Stream.succeed(Effect.succeed(increment) as never)),
          }),
          { runtime: defaultRuntime },
        );

        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Subscription",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure!.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  it("reports runtime provision failures as typed dispatch failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        interface RuntimeUnavailable {
          readonly _tag: "RuntimeUnavailable";
        }

        const runtime = makeRuntime<never, RuntimeUnavailable>(
          Layer.effectDiscard(Effect.fail({ _tag: "RuntimeUnavailable" } as const)),
        );
        const program = Program.start<number, Increment, never, never, RuntimeUnavailable>(
          Program.define<number, Increment>({
            initial: 0,
            on: { Increment: (model) => model + 1 },
          }),
          { runtime },
        );

        const failure = yield* Effect.flip(program.dispatch(increment));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: increment,
          error: { _tag: "RuntimeUnavailable" },
        });
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
        yield* Effect.ignore(runtime.dispose);
      }),
    ));

  it("records Program messages on the app Timeline as model commits", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const recording = yield* Timeline.record();
        const loaded = yield* Deferred.make<void>();
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const program = Program.start(
          Program.define<Model, Message>({
            name: "Counter",
            initial: { count: 0, loading: false },
            on: {
              Load: (model) =>
                Program.next(
                  { ...model, loading: true },
                  Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
                ),
              Loaded: (model, message) =>
                Program.next(
                  { count: model.count + message.amount, loading: false },
                  Program.emit(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid)),
                ),
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch({ _tag: "Load" });
        yield* Deferred.await(loaded);
        yield* Effect.sleep("10 millis");

        // A Program's history is the app Timeline filtered to its model signal.
        const history = recording.entries
          .get()
          .filter((entry) => entry.changes.some((change) => change.signal === program.model));
        expect(history.map((entry) => Timeline.describe(entry.cause))).toEqual([
          'Program "Counter" message Load',
          'Program "Counter" message Loaded',
        ]);
        expect(history[1]?.changes).toEqual([
          {
            signal: program.model,
            name: "Counter.model",
            previous: { count: 0, loading: true },
            next: { count: 2, loading: false },
          },
        ]);
        yield* program.dispose;
      }).pipe(Effect.scoped),
    ));

  it("feeds subscriptions into the message loop and interrupts stale subscriptions on model changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ticked = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        type Model = { readonly ticks: number };
        type Message = { readonly _tag: "Tick" };

        const program = Program.start(
          Program.define<Model, Message>({
            initial: { ticks: 0 },
            on: {
              Tick: (model) =>
                Program.next(
                  { ticks: model.ticks + 1 },
                  Program.emit(Deferred.succeed(ticked, undefined).pipe(Effect.asVoid)),
                ),
            },
            subscriptions: (model) =>
              model.ticks === 0
                ? [
                    Stream.succeed<Message>({ _tag: "Tick" }),
                    Program.subscription<Message>(
                      Stream.fromEffect(
                        Effect.never.pipe(
                          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                        ),
                      ),
                    ),
                  ]
                : undefined,
          }),
          { runtime: defaultRuntime },
        );

        yield* Deferred.await(ticked);
        yield* Deferred.await(interrupted);

        expect(program.model.get()).toEqual({ ticks: 1 });
        yield* program.dispose;
      }),
    ));

  it("swallows subscription finalizer defects during disposal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        type Message = { readonly _tag: "Never" };
        const program = Program.start(
          Program.define<number, Message>({
            initial: 0,
            on: { Never: (model) => model },
            subscriptions: () =>
              Program.subscription<Message>(
                Stream.fromEffect(
                  Deferred.succeed(started, undefined).pipe(
                    Effect.flatMap(() => Effect.never),
                    Effect.onInterrupt(() => Effect.die("subscription finalizer defect")),
                  ),
                ),
              ),
          }),
          { runtime: defaultRuntime },
        );

        yield* Deferred.await(started);
        yield* program.dispose;
      }),
    ));

  it("interrupts in-flight commands on disposal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        type Message = { readonly _tag: "Start" };
        const program = Program.start(
          Program.define<number, Message>({
            initial: 0,
            on: {
              Start: (model) =>
                Program.next(
                  model + 1,
                  Program.emit(
                    Deferred.succeed(started, undefined).pipe(
                      Effect.flatMap(() => Effect.never),
                      Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
                      Effect.asVoid,
                    ),
                  ),
                ),
            },
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch({ _tag: "Start" });
        yield* Deferred.await(started);
        yield* program.dispose;
        yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"));

        expect(program.model.get()).toBe(1);
      }),
    ));

  it("fails queued dispatches with ProgramDisposed when disposal happens before they apply", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Message = { readonly _tag: "First" } | { readonly _tag: "Second" };
        const program = Program.start(
          Program.define<number, Message>({
            initial: 0,
            on: {
              First: (model) => model + 1,
              Second: (model) => model + 100,
            },
          }),
          { runtime: defaultRuntime },
        );

        // Both dispatches register and enqueue synchronously; disposal runs
        // before the message loop takes them.
        const first = yield* Effect.forkChild(program.dispatch({ _tag: "First" }), {
          startImmediately: true,
        });
        const second = yield* Effect.forkChild(program.dispatch({ _tag: "Second" }), {
          startImmediately: true,
        });
        yield* program.dispose;

        for (const fiber of [first, second]) {
          const exit = yield* Fiber.await(fiber).pipe(Effect.timeout("1 second"));
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
            expect(failure).toMatchObject({ _tag: "ProgramFailure", phase: "Update" });
            expect(failure?.error).toBeInstanceOf(Program.Disposed);
          }
        }
        expect(program.model.get()).toBe(0);

        const afterDispose = yield* Effect.flip(program.dispatch({ _tag: "First" }));
        expect(afterDispose.error).toBeInstanceOf(Program.Disposed);
      }),
    ));

  it("acknowledges dispatch when disposal happens from a model subscriber after commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Message = { readonly _tag: "Commit" };
        const program = Program.start(
          Program.define<number, Message>({
            initial: 0,
            on: { Commit: (model) => model + 1 },
          }),
          { runtime: defaultRuntime },
        );

        const unsubscribe = program.model.subscribe(() => {
          if (program.model.get() === 1) {
            Effect.runSync(program.dispose.pipe(Effect.catchCause(() => Effect.void)));
          }
        });

        const exit = yield* program.dispatch({ _tag: "Commit" }).pipe(Effect.exit);
        unsubscribe();

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(program.model.get()).toBe(1);
      }),
    ));

  it("restarts subscriptions only from committed model changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const initialStarted = yield* Deferred.make<void>();
        const changedStarted = yield* Deferred.make<void>();
        const startedModels: Array<number> = [];
        type Model = { readonly count: number };
        type Message = { readonly _tag: "Same" } | { readonly _tag: "Change" };

        const program = Program.start(
          Program.define<Model, Message>({
            initial: { count: 0 },
            on: {
              Same: (model) => model,
              Change: (model) => ({ count: model.count + 1 }),
            },
            subscriptions: (model) =>
              Effect.gen(function* () {
                startedModels.push(model.count);
                if (startedModels.length === 1) {
                  yield* Deferred.succeed(initialStarted, undefined);
                }
                if (startedModels.length === 2) {
                  yield* Deferred.succeed(changedStarted, undefined);
                }
                return Stream.never;
              }),
          }),
          { runtime: defaultRuntime },
        );

        yield* Deferred.await(initialStarted);
        yield* program.dispatch({ _tag: "Same" });
        yield* Effect.sleep("10 millis");

        expect(startedModels).toEqual([0]);

        yield* program.dispatch({ _tag: "Change" });
        yield* Deferred.await(changedStarted);

        expect(startedModels).toEqual([0, 1]);
        yield* program.dispose;
      }),
    ));

  it("drops stale subscription emissions after restart", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const oldSubscriptionReady = yield* Deferred.make<void>();
        const releaseOldSubscription = yield* Deferred.make<void>();
        const newSubscriptionReady = yield* Deferred.make<void>();
        let emitOldMessage: (() => boolean) | undefined;
        type Model = { readonly version: number };
        type Message = { readonly _tag: "Advance" } | { readonly _tag: "Stale" };

        const program = Program.start(
          Program.define<Model, Message>({
            initial: { version: 0 },
            on: {
              Advance: (model) => ({ version: model.version + 1 }),
              Stale: (model) => ({ version: model.version + 100 }),
            },
            subscriptions: (model) =>
              model.version === 0
                ? Stream.callback<Message>((queue) =>
                    Effect.uninterruptible(
                      Effect.gen(function* () {
                        yield* Effect.sync(() => {
                          emitOldMessage = () => Queue.offerUnsafe(queue, { _tag: "Stale" });
                        });
                        yield* Deferred.succeed(oldSubscriptionReady, undefined);
                        yield* Deferred.await(releaseOldSubscription);
                      }),
                    ),
                  )
                : Effect.gen(function* () {
                    yield* Deferred.succeed(newSubscriptionReady, undefined);
                    return Stream.never;
                  }),
          }),
          { runtime: defaultRuntime },
        );

        yield* Deferred.await(oldSubscriptionReady);
        yield* program.dispatch({ _tag: "Advance" });
        yield* Deferred.await(newSubscriptionReady);

        expect(emitOldMessage?.()).toBe(true);
        yield* Effect.sleep("10 millis");

        expect(program.model.get()).toEqual({ version: 1 });

        yield* Deferred.succeed(releaseOldSubscription, undefined).pipe(Effect.ignore);
        yield* program.dispose;
      }),
    ));
});
