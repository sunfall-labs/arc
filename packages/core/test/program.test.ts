import { Cause, Context, Deferred, Effect, Exit, Layer, Option, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  makeRuntime,
  Program,
  ProgramDisposed,
  read,
  RuntimeTypeId,
  runWithRuntime,
  type AnyEffectUiRuntime
} from "../src/index.js";

interface CounterApi {
  readonly load: Effect.Effect<number>;
}

const CounterApi = Context.Service<CounterApi>("@effect-ui/core/test/CounterApi");

describe("Program", () => {
  it("updates centralized model state and runs Effect commands with services", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loaded = yield* Deferred.make<void>();
        const runtime = makeRuntime(
          Layer.succeed(CounterApi)({
            load: Effect.succeed(3)
          })
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
                    Program.command(
                      CounterApi.use((api) =>
                        api.load.pipe(
                          Effect.map((amount) => ({ _tag: "Loaded", amount }) as const)
                        )
                      )
                    )
                  );
                case "Loaded":
                  return Program.next(
                    {
                      count: model.count + message.amount,
                      loading: false
                    },
                    Program.effect(Deferred.succeed(loaded, undefined).pipe(Effect.asVoid))
                  );
              }
            }
          }),
          { runtime }
        );

        yield* program.dispatchEffect({ _tag: "Increment" });
        expect(read(program.model)).toEqual({ count: 1, loading: false });

        yield* program.dispatchEffect({ _tag: "Load" });
        yield* Deferred.await(loaded);

        expect(read(program.model)).toEqual({ count: 4, loading: false });
        yield* program.disposeEffect;
        yield* runtime.disposeEffect;
      })
    ));

  it("routes fire-and-forget dispatch through the owning Runtime Spine", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const base = makeRuntime();
        const baseRuntime = base as AnyEffectUiRuntime<never>;
        let runForks = 0;
        const runtime: AnyEffectUiRuntime<never> = {
          [RuntimeTypeId]: RuntimeTypeId,
          managed: baseRuntime.managed,
          resourceStore: baseRuntime.resourceStore,
          provide: baseRuntime.provide,
          runFork: (effect, options) => {
            runForks++;
            return baseRuntime.runFork(effect, options);
          },
          runSync: baseRuntime.runSync,
          disposeEffect: baseRuntime.disposeEffect
        };
        const program = runWithRuntime(runtime, () =>
          Program.start(Program.define<number, "increment">({
            initial: 0,
            update: (model) => model + 1
          }))
        );

        program.dispatch("increment");
        yield* Effect.sleep("20 millis");

        expect(read(program.model)).toBe(1);
        expect(runForks).toBe(1);

        yield* program.disposeEffect;
        yield* runtime.disposeEffect;
      })
    ));

  it("reports update failures without replacing the current model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Message = "increment" | "fail";
        const program = Program.start(Program.define<number, Message, string>({
          initial: 0,
          update: (model, message) =>
            message === "fail" ? Effect.fail("boom") : model + 1
        }));

        yield* program.dispatchEffect("increment");
        const failure = yield* Effect.flip(program.dispatchEffect("fail"));

        expect(read(program.model)).toBe(1);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "fail",
          error: "boom"
        });
        expect(read(program.failures)).toEqual([failure]);
        program.clearFailures();
        expect(read(program.failures)).toEqual([]);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped update returns as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "promise">({
          initial: 0,
          update: () => Promise.resolve(1) as never
        }));

        const failure = yield* Effect.flip(program.dispatchEffect("promise"));

        expect(read(program.model)).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "promise",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);
        expect(read(program.failures)).toEqual([failure]);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped Program.next models as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "promise-step">({
          initial: 0,
          update: () => Program.next(Promise.resolve(1) as never)
        }));

        const failure = yield* Effect.flip(program.dispatchEffect("promise-step"));

        expect(read(program.model)).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "promise-step",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);
        expect(read(program.failures)).toEqual([failure]);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped dispatch messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "increment">({
          initial: 0,
          update: (model) => model + 1
        }));

        const failure = yield* Effect.flip(
          program.dispatchEffect(Promise.resolve("increment") as never)
        );

        expect(read(program.model)).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);
        expect(read(program.failures)).toEqual([failure]);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped command messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "load" | "loaded">({
          initial: 0,
          update: (model, message) =>
            message === "load"
              ? Program.next(
                  model,
                  Program.command(Effect.succeed(Promise.resolve("loaded") as never))
                )
              : model + 1
        }));

        yield* program.dispatchEffect("load");
        yield* Effect.sleep("0 millis");

        expect(read(program.model)).toBe(0);
        const [failure] = read(program.failures);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          message: "load",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure?.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped subscription messages without enqueueing them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "increment">({
          initial: 0,
          update: (model) => model + 1,
          subscriptions: () =>
            Program.subscription(Stream.succeed(Promise.resolve("increment") as never))
        }));

        yield* Effect.sleep("0 millis");

        expect(read(program.model)).toBe(0);
        const [failure] = read(program.failures);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Subscription",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure?.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);

        yield* program.disposeEffect;
      })
    ));

  it("reports erased Promise-shaped story command messages as typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const story = Program.story(Program.define<number, "increment">({
          initial: 0,
          update: (model) => model + 1
        }));
        const command = Program.command<"increment">(
          Effect.succeed(Promise.resolve("increment") as never)
        );

        const failure = yield* Effect.flip(story.run(command));

        expect(read(story.model)).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Command",
          error: expect.any(EffectInputCallbackError)
        });
        expect((failure.error as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);
      })
    ));

  it("reports runtime provision failures as typed dispatch failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        interface RuntimeUnavailable {
          readonly _tag: "RuntimeUnavailable";
        }

        const runtime = makeRuntime<never, RuntimeUnavailable>(
          Layer.effectDiscard(Effect.fail({ _tag: "RuntimeUnavailable" } as const))
        );
        const program = Program.start<number, "increment", never, never, RuntimeUnavailable>(
          Program.define({
            initial: 0,
            update: (model) => model + 1
          }),
          { runtime }
        );

        const failure = yield* Effect.flip(program.dispatchEffect("increment"));

        expect(read(program.model)).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "increment",
          error: { _tag: "RuntimeUnavailable" }
        });
        expect(read(program.failures)).toEqual([failure]);

        yield* program.disposeEffect;
        yield* Effect.ignore(runtime.disposeEffect);
      })
    ));

  it("records a bounded runtime timeline for messages and commands", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const loaded = yield* Deferred.make<void>();
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const program = Program.start(Program.define<Model, Message>({
          name: "Counter.timeline",
          timeline: { limit: 4 },
          initial: { count: 0, loading: false },
          update: (model, message) => {
            switch (message._tag) {
              case "Load":
                return Program.next(
                  { ...model, loading: true },
                  Program.command(
                    Effect.succeed({ _tag: "Loaded", amount: 2 } as const)
                  )
                );
              case "Loaded":
                return Deferred.succeed(loaded, undefined).pipe(
                  Effect.as({ count: model.count + message.amount, loading: false })
                );
            }
          }
        }));

        yield* program.dispatchEffect({ _tag: "Load" });
        yield* Deferred.await(loaded);
        yield* Effect.sleep("10 millis");

        const timeline = read(program.timeline);
        expect(timeline.map((event) => event._tag)).toEqual([
          "Message",
          "CommandStarted",
          "CommandCompleted",
          "Message"
        ]);
        expect(timeline[0]).toMatchObject({
          _tag: "Message",
          program: "Counter.timeline",
          commandCount: 1
        });
        expect(timeline[2]).toMatchObject({
          _tag: "CommandCompleted",
          emitted: { _tag: "Loaded", amount: 2 }
        });

        program.clearTimeline();
        expect(read(program.timeline)).toEqual([]);
        yield* program.disposeEffect;
      })
    ));

  it("omits runtime timeline events when retention is disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "increment">({
          timeline: false,
          initial: 0,
          update: (model) => model + 1
        }));

        yield* program.dispatchEffect("increment");

        expect(read(program.model)).toBe(1);
        expect(read(program.timeline)).toEqual([]);
        yield* program.disposeEffect;
        expect(read(program.timeline)).toEqual([]);
      })
    ));

  it("steps story messages and resolves commands explicitly", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        type Model = { readonly count: number; readonly loading: boolean };
        type Message =
          | { readonly _tag: "Load" }
          | { readonly _tag: "Loaded"; readonly amount: number };

        const story = Program.story(Program.define<Model, Message>({
          initial: { count: 0, loading: false },
          update: (model, message) => {
            switch (message._tag) {
              case "Load":
                return Program.next(
                  { ...model, loading: true },
                  Program.command(
                    Effect.succeed({ _tag: "Loaded", amount: 2 } as const)
                  )
                );
              case "Loaded":
                return {
                  count: model.count + message.amount,
                  loading: false
                };
            }
          }
        }));

        const load = yield* story.send({ _tag: "Load" });
        expect(read(story.model)).toEqual({ count: 0, loading: true });
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
        expect(read(story.model)).toEqual({ count: 2, loading: false });
        expect(read(story.history)).toHaveLength(2);

        story.reset();
        expect(read(story.model)).toEqual({ count: 0, loading: false });
        expect(read(story.history)).toEqual([]);
      })
    ));

  it("keeps story history unchanged when updates fail", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const story = Program.story(Program.define<number, "ok" | "fail", string>({
          initial: 0,
          update: (model, message) =>
            message === "fail" ? Effect.fail("boom") : model + 1
        }));

        const failure = yield* Effect.flip(story.send("fail"));

        expect(failure).toMatchObject({
          _tag: "ProgramFailure",
          phase: "Update",
          message: "fail",
          error: "boom"
        });
        expect(read(story.model)).toBe(0);
        expect(read(story.history)).toEqual([]);
      })
    ));

  it("feeds subscriptions into the message loop and interrupts stale subscriptions on model changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const ticked = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        type Model = { readonly ticks: number };
        type Message = { readonly _tag: "Tick" };

        const program = Program.start(Program.define<Model, Message>({
          initial: { ticks: 0 },
          update: (model) =>
            Deferred.succeed(ticked, undefined).pipe(
              Effect.as({ ticks: model.ticks + 1 })
            ),
          subscriptions: (model) =>
            model.ticks === 0
              ? [
                  Stream.succeed<Message>({ _tag: "Tick" }),
                  Program.subscription(
                    Stream.fromEffect(
                      Effect.never.pipe(
                        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
                      )
                    )
                  )
                ]
              : undefined
        }));

        yield* Deferred.await(ticked);
        yield* Deferred.await(interrupted);

        expect(read(program.model)).toEqual({ ticks: 1 });
        yield* program.disposeEffect;
      })
    ));

  it("fails dispatchEffect when disposal races an in-flight update before commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const program = Program.start(Program.define<number, "block">({
          initial: 0,
          update: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.flatMap(() => Effect.never)
            )
        }));

        const result = yield* Effect.all(
          [
            program.dispatchEffect("block").pipe(Effect.exit),
            Effect.gen(function* () {
              const startedOption = yield* Deferred.await(started).pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(startedOption)).toBe(true);
              const disposedOption = yield* program.disposeEffect.pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(disposedOption)).toBe(true);
            })
          ] as const,
          { concurrency: "unbounded" }
        ).pipe(Effect.timeoutOption("2 seconds"));

        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(Exit.isFailure(result.value[0])).toBe(true);
          if (Exit.isFailure(result.value[0])) {
            const failure = result.value[0].cause.reasons.find(Cause.isFailReason)?.error;
            expect(failure).toMatchObject({
              _tag: "ProgramFailure",
              phase: "Update",
              message: "block"
            });
            expect(failure?.error).toBeInstanceOf(ProgramDisposed);
          }
        }
        expect(read(program.model)).toBe(0);
      })
    ));

  it("acknowledges dispatchEffect when disposal happens from a model subscriber after commit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const program = Program.start(Program.define<number, "commit">({
          initial: 0,
          update: (model) => model + 1
        }));

        const unsubscribe = program.model.subscribe(() => {
          if (read(program.model) === 1) {
            Effect.runSync(program.disposeEffect.pipe(Effect.catch(() => Effect.void)));
          }
        });

        const exit = yield* program.dispatchEffect("commit").pipe(Effect.exit);
        unsubscribe();

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(read(program.model)).toBe(1);
      })
    ));

  it("completes queued dispatch acknowledgements during disposal", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const program = Program.start(Program.define<number, "first" | "second">({
          initial: 0,
          update: (model, message) =>
            message === "first"
              ? Deferred.succeed(firstStarted, undefined).pipe(
                  Effect.flatMap(() => Deferred.await(releaseFirst)),
                  Effect.as(model + 1)
                )
              : model + 100
        }));

        const result = yield* Effect.all(
          [
            program.dispatchEffect("first").pipe(Effect.exit),
            Effect.gen(function* () {
              yield* Deferred.await(firstStarted);
              return yield* program.dispatchEffect("second").pipe(Effect.exit);
            }),
            Effect.gen(function* () {
              const firstStartedOption = yield* Deferred.await(firstStarted).pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(firstStartedOption)).toBe(true);
              yield* Effect.sleep("10 millis");
              const disposedOption = yield* program.disposeEffect.pipe(Effect.timeoutOption("1 second"));
              expect(Option.isSome(disposedOption)).toBe(true);
            })
          ] as const,
          { concurrency: "unbounded" }
        ).pipe(Effect.timeoutOption("2 seconds"));

        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(Exit.isFailure(result.value[0])).toBe(true);
          expect(Exit.isFailure(result.value[1])).toBe(true);
          for (const exit of result.value.slice(0, 2)) {
            if (Exit.isFailure(exit)) {
              const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
              expect(failure).toMatchObject({
                _tag: "ProgramFailure",
                phase: "Update"
              });
              expect(failure?.error).toBeInstanceOf(ProgramDisposed);
            }
          }
        }

        yield* Deferred.succeed(releaseFirst, undefined).pipe(Effect.ignore);
        yield* Effect.sleep("10 millis");
        expect(read(program.model)).toBe(0);
      })
    ));

  it("restarts subscriptions only from committed model changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const initialStarted = yield* Deferred.make<void>();
        const changedStarted = yield* Deferred.make<void>();
        const startedModels: Array<number> = [];
        type Model = { readonly count: number };
        type Message = "same" | "change";

        const program = Program.start(Program.define<Model, Message>({
          initial: { count: 0 },
          update: (model, message) =>
            message === "same" ? model : { count: model.count + 1 },
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
            })
        }));

        yield* Deferred.await(initialStarted);
        yield* program.dispatchEffect("same");
        yield* Effect.sleep("10 millis");

        expect(startedModels).toEqual([0]);

        yield* program.dispatchEffect("change");
        yield* Deferred.await(changedStarted);

        expect(startedModels).toEqual([0, 1]);
        expect(read(program.timeline).filter((event) => event._tag === "SubscriptionStarted")).toHaveLength(2);
        yield* program.disposeEffect;
      })
    ));

  it("drops stale subscription emissions after restart", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const oldSubscriptionReady = yield* Deferred.make<void>();
        const releaseOldSubscription = yield* Deferred.make<void>();
        const newSubscriptionReady = yield* Deferred.make<void>();
        let emitOldMessage: (() => boolean) | undefined;
        type Model = { readonly version: number };
        type Message =
          | { readonly _tag: "Advance" }
          | { readonly _tag: "Stale" };

        const program = Program.start(Program.define<Model, Message>({
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
                    })
                  )
                )
              : Effect.gen(function* () {
                  yield* Deferred.succeed(newSubscriptionReady, undefined);
                  return Stream.never;
                })
        }));

        yield* Deferred.await(oldSubscriptionReady);
        yield* program.dispatchEffect({ _tag: "Advance" });
        yield* Deferred.await(newSubscriptionReady);

        expect(emitOldMessage?.()).toBe(true);
        yield* Effect.sleep("10 millis");

        expect(read(program.model)).toEqual({ version: 1 });
        expect(
          read(program.timeline).filter(
            (event) =>
              event._tag === "SubscriptionEmitted" &&
              event.message._tag === "Stale"
          )
        ).toEqual([]);

        yield* Deferred.succeed(releaseOldSubscription, undefined).pipe(Effect.ignore);
        yield* program.disposeEffect;
      })
    ));
});
