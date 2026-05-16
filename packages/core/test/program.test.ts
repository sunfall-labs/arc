import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { makeRuntime, Program, read, runWithRuntime } from "../src/index.js";

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

        const program = runWithRuntime(runtime, () =>
          Program.start(Program.define<Model, Message, never, CounterApi>({
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
          }))
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

  it("reports runtime provision failures as typed dispatch failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        interface RuntimeUnavailable {
          readonly _tag: "RuntimeUnavailable";
        }

        const runtime = makeRuntime<never, RuntimeUnavailable>(
          Layer.effectDiscard(Effect.fail({ _tag: "RuntimeUnavailable" } as const))
        );
        const program = runWithRuntime(runtime, () =>
          Program.start<number, "increment", never, never, RuntimeUnavailable>(Program.define({
            initial: 0,
            update: (model) => model + 1
          }))
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
});
