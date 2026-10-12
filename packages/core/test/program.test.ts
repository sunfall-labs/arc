import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  makeRuntime,
  Program,
  ProgramDisposed,
  Timeline,
} from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

interface CounterApi {
  readonly load: Effect.Effect<number>;
}

const CounterApi = Context.Service<CounterApi>("@sunfall/arc-core/test/CounterApi");

describe("Program", () => {
  it("defines tagged message handlers as a compact Program front door", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Increment" }
          | { readonly _tag: "QueueIncrement" }
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const story = Program.story(
          Program.define<Model, Message>({
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
          }),
        );

        yield* story.send({ _tag: "Increment" });
        const queued = yield* story.send({ _tag: "QueueIncrement" });
        yield* story.resolve(queued.commands[0]!);
        const load = yield* story.send({ _tag: "Load" });

        expect(story.model.get()).toEqual({ count: 2, loading: true });
        expect(load.commands).toHaveLength(1);

        yield* story.resolve(load.commands[0]!);

        expect(story.model.get()).toEqual({ count: 4, loading: false });
      }),
    ));

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
            update: (model, message) => {
              switch (message._tag) {
                case "Increment":
                  return { ...model, count: model.count + 1 };
                case "Load":
                  return Program.next(
                    { ...model, loading: true },
                    Program.emit(
                      CounterApi.use((api) =>
                        api.load.pipe(
                          Effect.map((amount) => ({ _tag: "Loaded", amount }) as const),
                        ),
                      ),
                    ),
                  );
                case "Loaded":
                  return Program.next(
                    {
                      count: model.count + message.amount,
                      loading: false,
                    },
                    Program.emit(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid)),
                  );
              }
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

  it("reports update failures without replacing the current model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Message = "increment" | "fail";
        const program = Program.start(
          Program.define<number, Message, string>({
            initial: 0,
            update: (model, message) => (message === "fail" ? Effect.fail("boom") : model + 1),
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch("increment");
        const failure = yield* Effect.flip(program.dispatch("fail"));

        expect(program.model.get()).toBe(1);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "fail",
          error: "boom",
        });
        expect(program.failures.get()).toEqual([failure]);
        program.clearFailures();
        expect(program.failures.get()).toEqual([]);

        yield* program.dispose;
      }),
    ));

  it("reports erased Promise-shaped update returns as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "promise">({
            initial: 0,
            update: () => Promise.resolve(1) as never,
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch("promise"));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "promise",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
        expect(program.failures.get()).toEqual([failure]);

        yield* program.dispose;
      }),
    ));

  it("reports erased Promise-shaped Program.next models as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "promise-step">({
            initial: 0,
            update: () => Program.next(Promise.resolve(1) as never),
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch("promise-step"));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "promise-step",
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
          Program.define<number, "effect-step">({
            initial: 0,
            update: () => Program.next(Effect.succeed(1) as never),
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch("effect-step"));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "effect-step",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(TypeError);

        yield* program.dispose;
      }),
    ));

  it("rejects erased Promise-shaped initial models before starting a Program", () => {
    expect(() =>
      Program.start(
        Program.define<number, "noop">({
          initial: Promise.resolve(0) as never,
          update: (model) => model,
        }),
        { runtime: defaultRuntime },
      ),
    ).toThrow(EffectInputCallbackError);
  });

  it("rejects erased Effect-shaped initial models before starting a Program", () => {
    expect(() =>
      Program.start(
        Program.define<number, "noop">({
          initial: Effect.succeed(0) as never,
          update: (model) => model,
        }),
        { runtime: defaultRuntime },
      ),
    ).toThrow(EffectInputCallbackError);
  });

  it("rejects erased Promise-shaped story initial and reset models", () => {
    expect(() =>
      Program.story(
        Program.define<number, "noop">({
          initial: 0,
          update: (model) => model,
        }),
        {
          initial: Promise.resolve(0) as never,
        },
      ),
    ).toThrow(EffectInputCallbackError);

    const story = Program.story(
      Program.define<number, "noop">({
        initial: 0,
        update: (model) => model,
      }),
    );

    expect(() => story.reset(Promise.resolve(1) as never)).toThrow(EffectInputCallbackError);
    expect(() => story.reset(Effect.succeed(1) as never)).toThrow(EffectInputCallbackError);
  });

  it("reports erased Promise-shaped dispatch messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(Promise.resolve("increment") as never));

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
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
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
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
          }),
          { runtime: defaultRuntime },
        );

        const failure = yield* Effect.flip(program.dispatch(Effect.succeed("increment") as never));

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

  it("reports erased Promise-shaped command messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "load" | "loaded">({
            initial: 0,
            update: (model, message) =>
              message === "load"
                ? Program.next(
                    model,
                    Program.emit<"load" | "loaded">(
                      Effect.succeed(Promise.resolve("loaded") as never),
                    ),
                  )
                : model + 1,
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch("load");
        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: "load",
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
          Program.define<number, "load" | "loaded">({
            initial: 0,
            update: (model, message) =>
              message === "load"
                ? Program.next(
                    model,
                    Program.emit<"load" | "loaded">(
                      Effect.succeed(Effect.succeed("loaded") as never),
                    ),
                  )
                : model + 1,
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch("load");
        yield* Effect.sleep("0 millis");

        expect(program.model.get()).toBe(0);
        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: "load",
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
        const program = Program.start(
          Program.define<number, "load", string>({
            initial: 0,
            update: (model, message) =>
              message === "load"
                ? Program.next(model, Program.emit<"load", string>(Effect.fail("offline")))
                : model,
          }),
          { runtime: defaultRuntime },
        );

        yield* program.dispatch("load");
        yield* Effect.sleep("0 millis");

        const [failure] = program.failures.get();
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: "load",
          error: "offline",
        });
        const failureCommit = recording.entries
          .get()
          .find((entry) => entry.changes.some((change) => change.signal === program.failures));
        expect(failureCommit?.cause).toEqual({
          _tag: "Program",
          program: undefined,
          event: "failure",
          message: "load",
        });

        yield* program.dispose;
      }).pipe(Effect.scoped),
    ));

  it("reports erased Promise-shaped subscription messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
            subscriptions: () =>
              Program.subscription<"increment">(
                Stream.succeed(Promise.resolve("increment") as never),
              ),
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
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
            subscriptions: () =>
              Program.subscription<"increment">(
                Stream.succeed(Effect.succeed("increment") as never),
              ),
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

  it("reports erased Promise-shaped story command messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const story = Program.story(
          Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1,
          }),
        );
        const command = Program.emit<"increment">(
          Effect.succeed(Promise.resolve("increment") as never),
        );

        const failure = yield* Effect.flip(story.run(command));

        expect(story.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          error: expect.any(EffectInputCallbackError),
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(
          EffectInputPromiseRejected,
        );
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
        const program = Program.start<number, "increment", never, never, RuntimeUnavailable>(
          Program.define({
            initial: 0,
            update: (model) => model + 1,
          }),
          { runtime },
        );

        const failure = yield* Effect.flip(program.dispatch("increment"));

        expect(program.model.get()).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "increment",
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
            update: (model, message) => {
              switch (message._tag) {
                case "Load":
                  return Program.next(
                    { ...model, loading: true },
                    Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
                  );
                case "Loaded":
                  return Deferred.succeed(loaded, undefined).pipe(
                    Effect.as({ count: model.count + message.amount, loading: false }),
                  );
              }
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

  it("steps story messages and resolves commands explicitly", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const story = Program.story(
          Program.define<Model, Message>({
            initial: { count: 0, loading: false },
            update: (model, message) => {
              switch (message._tag) {
                case "Load":
                  return Program.next(
                    { ...model, loading: true },
                    Program.emit(Effect.succeed({ _tag: "Loaded", amount: 2 } as const)),
                  );
                case "Loaded":
                  return {
                    count: model.count + message.amount,
                    loading: false,
                  };
              }
            },
          }),
        );

        const load = yield* story.send({ _tag: "Load" });
        expect(story.model.get()).toEqual({ count: 0, loading: true });
        expect(load.before).toEqual({ count: 0, loading: false });
        expect(load.after).toEqual({ count: 0, loading: true });
        expect(load.commands).toHaveLength(1);

        const command = load.commands[0];
        expect(command).toBeDefined();
        if (command === undefined) {
          return;
        }

        const loaded = yield* story.resolve(command);
        expect(loaded?.message).toEqual({ _tag: "Loaded", amount: 2 });
        expect(story.model.get()).toEqual({ count: 2, loading: false });
        expect(story.history.get()).toHaveLength(2);

        story.reset();
        expect(story.model.get()).toEqual({ count: 0, loading: false });
        expect(story.history.get()).toEqual([]);
      }),
    ));

  it("keeps story history unchanged when updates fail", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const story = Program.story(
          Program.define<number, "ok" | "fail", string>({
            initial: 0,
            update: (model, message) => (message === "fail" ? Effect.fail("boom") : model + 1),
          }),
        );

        const failure = yield* Effect.flip(story.send("fail"));

        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "fail",
          error: "boom",
        });
        expect(story.model.get()).toBe(0);
        expect(story.history.get()).toEqual([]);
      }),
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
            update: (model) =>
              Deferred.succeed(ticked, undefined).pipe(Effect.as({ ticks: model.ticks + 1 })),
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
            update: (model) => model,
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

  it("fails dispatch when disposal races an in-flight update before commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const program = Program.start(
          Program.define<number, "block">({
            initial: 0,
            update: () =>
              Deferred.succeed(started, undefined).pipe(Effect.flatMap(() => Effect.never)),
          }),
          { runtime: defaultRuntime },
        );

        const result = yield* Effect.all(
          [
            program.dispatch("block").pipe(Effect.exit),
            Effect.gen(function* () {
              const startedOption = yield* Deferred.await(started).pipe(
                Effect.timeoutOption("1 second"),
              );
              expect(Option.isSome(startedOption)).toBe(true);
              const disposedOption = yield* program.dispose.pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(disposedOption)).toBe(true);
            }),
          ] as const,
          { concurrency: "unbounded" },
        ).pipe(Effect.timeoutOption("2 seconds"));

        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(Exit.isFailure(result.value[0])).toBe(true);
          if (Exit.isFailure(result.value[0])) {
            const failure = result.value[0].cause.reasons.find(Cause.isFailReason)?.error;
            expect(failure).toMatchObject({
              _tag: "ProgramFailure",
              phase: "Update",
              message: "block",
            });
            expect(failure?.error).toBeInstanceOf(ProgramDisposed);
          }
        }
        expect(program.model.get()).toBe(0);
      }),
    ));

  it("acknowledges dispatch when disposal happens from a model subscriber after commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(
          Program.define<number, "commit">({
            initial: 0,
            update: (model) => model + 1,
          }),
          { runtime: defaultRuntime },
        );

        const unsubscribe = program.model.subscribe(() => {
          if (program.model.get() === 1) {
            Effect.runSync(program.dispose.pipe(Effect.catchCause(() => Effect.void)));
          }
        });

        const exit = yield* program.dispatch("commit").pipe(Effect.exit);
        unsubscribe();

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(program.model.get()).toBe(1);
      }),
    ));

  it("completes queued dispatch acknowledgements during disposal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const program = Program.start(
          Program.define<number, "first" | "second">({
            initial: 0,
            update: (model, message) =>
              message === "first"
                ? Deferred.succeed(firstStarted, undefined).pipe(
                    Effect.flatMap(() => Deferred.await(releaseFirst)),
                    Effect.as(model + 1),
                  )
                : model + 100,
          }),
          { runtime: defaultRuntime },
        );

        const result = yield* Effect.all(
          [
            program.dispatch("first").pipe(Effect.exit),
            Effect.gen(function* () {
              yield* Deferred.await(firstStarted);
              return yield* program.dispatch("second").pipe(Effect.exit);
            }),
            Effect.gen(function* () {
              const firstStartedOption = yield* Deferred.await(firstStarted).pipe(
                Effect.timeoutOption("1 second"),
              );
              expect(Option.isSome(firstStartedOption)).toBe(true);
              yield* Effect.sleep("10 millis");
              const disposedOption = yield* program.dispose.pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(disposedOption)).toBe(true);
            }),
          ] as const,
          { concurrency: "unbounded" },
        ).pipe(Effect.timeoutOption("2 seconds"));

        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(Exit.isFailure(result.value[0])).toBe(true);
          expect(Exit.isFailure(result.value[1])).toBe(true);
          for (const exit of [result.value[0], result.value[1]]) {
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
              expect(failure).toMatchObject({
                _tag: "ProgramFailure",
                phase: "Update",
              });
              expect(failure?.error).toBeInstanceOf(ProgramDisposed);
            }
          }
        }

        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.ignore);
        yield* Effect.sleep("10 millis");
        expect(program.model.get()).toBe(0);
      }),
    ));

  it("restarts subscriptions only from committed model changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const initialStarted = yield* Deferred.make<void>();
        const changedStarted = yield* Deferred.make<void>();
        const startedModels: Array<number> = [];
        type Model = { readonly count: number };
        type Message = "same" | "change";

        const program = Program.start(
          Program.define<Model, Message>({
            initial: { count: 0 },
            update: (model, message) => (message === "same" ? model : { count: model.count + 1 }),
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
        yield* program.dispatch("same");
        yield* Effect.sleep("10 millis");

        expect(startedModels).toEqual([0]);

        yield* program.dispatch("change");
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
            update: (model, message) =>
              message._tag === "Advance"
                ? { version: model.version + 1 }
                : { version: model.version + 100 },
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
