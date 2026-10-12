import { Cause, Effect, Exit, Layer, Option, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionQueued,
  ActionResult,
  ActionSubmissionExpired,
  ActionTransport,
  makeRuntime,
  ServerTransportError,
  Signal,
  State,
  Timeline,
} from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

/** A running State holding one value: the optimistic target these tests patch. */
const stateCell = <A>(initial: A, options: { readonly name: string }) =>
  State.start(
    {
      name: options.name,
      initial,
      on: { Set: (_current, message) => message.value },
    } as State.Definition<A, { readonly _tag: "Set"; readonly value: A }>,
    { runtime: defaultRuntime },
  );

/** A `KeyValueStore` over a Map the test can inspect, shared across "reloads". */
const memoryStorage = () => {
  const values = new Map<string, string>();
  const storage = Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.sync(() => values.get(key)),
      set: (key, value) => Effect.sync(() => void values.set(key, value)),
      remove: (key) => Effect.sync(() => void values.delete(key)),
      clear: Effect.sync(() => values.clear()),
      size: Effect.sync(() => values.size),
    }),
  );
  return { values, storage };
};

const storedIds = (values: ReadonlyMap<string, string>): ReadonlyArray<string> => {
  const raw = values.get("arc/actions/v1/queue");
  return raw === undefined
    ? []
    : (JSON.parse(raw) as { submissions: ReadonlyArray<{ id: string }> }).submissions.map(
        (record) => record.id,
      );
};

interface Sent {
  readonly action: string;
  readonly input: unknown;
  readonly id: string | undefined;
  readonly stored: ReadonlyArray<string>;
}

/**
 * A fake network: offline fails as a transport `Network` error; online answers
 * with `respond(input)` (a typed failure when it returns `Exit.fail`).
 */
const fakeServer = (values: ReadonlyMap<string, string>) => {
  const state = {
    online: false,
    sent: [] as Array<Sent>,
    respond: (input: unknown): Exit.Exit<unknown, unknown> => Exit.succeed(input),
  };
  const layer = Layer.succeed(ActionTransport)({
    submit: (definition, input, submission) =>
      Option.some(
        Effect.suspend(() => {
          state.sent.push({
            action: definition.name,
            input,
            id: submission?.id,
            stored: storedIds(values),
          });
          if (!state.online) {
            return Effect.fail(new ServerTransportError({ reason: "Network", message: "offline" }));
          }
          return Effect.succeed({
            exit: state.respond(input),
            apply: () => Effect.void,
          } as Action.TransportResponse<any, any>);
        }),
      ),
  });
  return { state, layer };
};

const fastRetry = Schedule.spaced("5 millis").pipe(Schedule.upTo({ times: 200 }));

const waitFor = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 400 && !condition(); attempt++) {
      yield* Effect.sleep("2 millis");
    }
    expect(condition()).toBe(true);
  });

const Advance = Schema.Struct({ id: Schema.String, by: Schema.Number });

/** One "app load": a fresh counter signal and a durable Action patching it. */
const defineApp = (name: string, maxAge: string = "1 hour", initial = 0) => {
  const total = stateCell(initial, { name: `${name}.total` });
  const AdvanceAction = Action.define({
    name,
    input: Advance,
    durable: { maxAge: maxAge as "1 hour" },
    optimistic: (input, transaction) => transaction.set(total, (value) => value + input.by),
    run: (input) => Effect.succeed(input.by),
  });
  return { total, AdvanceAction };
};

describe("Action outbox (durable submissions)", () => {
  it("persists before sending and settles online submissions like any other", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        server.state.online = true;
        const { total, AdvanceAction } = defineApp("Outbox.online");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const advance = Action.use(AdvanceAction, { runtime });

        expect(yield* advance.submit({ id: "atlas", by: 8 })).toEqual({ id: "atlas", by: 8 });
        expect(server.state.sent).toHaveLength(1);
        const [sent] = server.state.sent;
        // The record was stored before the request left.
        expect(sent!.stored).toEqual([sent!.id]);
        expect(sent!.id).toMatch(/[0-9a-f-]{32,}/);
        expect(storedIds(values)).toEqual([]);
        expect(Signal.peek(total.model)).toBe(8);
        const outbox = yield* runtime.provide(Action.outbox);
        expect(Signal.peek(outbox.pending)).toEqual([]);
        yield* runtime.dispose;
      }),
    ));

  it("queues offline submissions with their optimistic patch and replays them in order", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        const { total, AdvanceAction } = defineApp("Outbox.offline");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const advance = Action.use(AdvanceAction, { runtime });

        const first = yield* Effect.flip(advance.submit({ id: "atlas", by: 1 }));
        expect(first).toBeInstanceOf(ActionQueued);
        expect(first._tag).toBe("ActionQueued");
        yield* Effect.flip(advance.submit({ id: "atlas", by: 2 }));
        yield* Effect.flip(advance.submit({ id: "atlas", by: 4 }));

        expect(Signal.peek(total.model)).toBe(7);
        const outbox = yield* runtime.provide(Action.outbox);
        expect(Signal.peek(outbox.pending).map((entry) => entry.input)).toEqual([
          { id: "atlas", by: 1 },
          { id: "atlas", by: 2 },
          { id: "atlas", by: 4 },
        ]);
        expect(storedIds(values)).toHaveLength(3);
        expect(Option.getOrUndefined(advance.state.get().input)).toEqual({ id: "atlas", by: 4 });

        const attempts = server.state.sent.length;
        const pendingIds = Signal.peek(outbox.pending).map((entry) => entry.id);
        // Offline, only the head was attempted: the rest wait their turn.
        expect(new Set(server.state.sent.map((sent) => sent.id))).toEqual(new Set([pendingIds[0]]));
        server.state.online = true;
        yield* waitFor(() => Signal.peek(outbox.pending).length === 0);

        const replayed = server.state.sent.slice(attempts);
        expect(replayed.map((sent) => (sent.input as { by: number }).by)).toEqual([1, 2, 4]);
        // Each attempt carries the submission's id, its idempotency key.
        expect(replayed.map((sent) => sent.id)).toEqual(pendingIds);
        expect(Signal.peek(total.model)).toBe(7);
        expect(storedIds(values)).toEqual([]);
        yield* runtime.dispose;
      }),
    ));

  it("rolls back a queued patch when the replay answers with a rejected ActionResult", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        // The server's recorded outcome for the submission is a validation failure.
        server.state.respond = () =>
          Exit.succeed(ActionResult.validation({ formErrors: ["Not allowed."] }));
        const { total, AdvanceAction } = defineApp("Outbox.rejected");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );

        yield* Effect.flip(Action.use(AdvanceAction, { runtime }).submit({ id: "atlas", by: 8 }));
        expect(Signal.peek(total.model)).toBe(8);

        server.state.online = true;
        const outbox = yield* runtime.provide(Action.outbox);
        yield* waitFor(() => Signal.peek(outbox.pending).length === 0);
        // The change did not happen: the patch rolled back instead of folding in.
        expect(Signal.peek(total.model)).toBe(0);
        expect(Signal.peek(outbox.failures)).toEqual([]);
        yield* runtime.dispose;
      }),
    ));

  it("restores pending submissions after a reload and re-applies their patches", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { values, storage } = memoryStorage();
          const server = fakeServer(values);

          const before = defineApp("Outbox.reload");
          const first = makeRuntime(
            Layer.mergeAll(
              server.layer,
              Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
            ),
          );
          const advance = Action.use(before.AdvanceAction, { runtime: first });
          yield* Effect.flip(advance.submit({ id: "atlas", by: 3 }));
          yield* Effect.flip(advance.submit({ id: "atlas", by: 5 }));
          const ids = storedIds(values);
          expect(ids).toHaveLength(2);
          yield* first.dispose;

          // Reload: new runtime and state, same storage. The hydrated value is 10.
          const after = defineApp("Outbox.reload", "1 hour", 10);
          const second = makeRuntime(
            Layer.mergeAll(
              server.layer,
              Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
            ),
          );
          const recording = yield* Timeline.record();
          yield* second.provide(Action.restoreOutbox());
          expect(Signal.peek(after.total.model)).toBe(18);
          const outbox = yield* second.provide(Action.outbox);
          expect(Signal.peek(outbox.pending).map((entry) => entry.id)).toEqual(ids);

          const sentBefore = server.state.sent.length;
          server.state.online = true;
          yield* waitFor(() => Signal.peek(outbox.pending).length === 0);
          expect(server.state.sent.slice(sentBefore).map((sent) => sent.id)).toEqual(ids);
          expect(Signal.peek(after.total.model)).toBe(18);
          expect(Signal.peek(outbox.failures)).toEqual([]);

          const causes = Signal.peek(recording.entries).map((entry) => entry.cause);
          expect(causes).toContainEqual({
            _tag: "Action",
            action: "Outbox.reload",
            event: "restore",
          });
          expect(causes).toContainEqual({
            _tag: "Action",
            action: "Outbox.reload",
            event: "replay",
          });
          expect(causes).toContainEqual({
            _tag: "Action",
            action: "Outbox.reload",
            event: "success",
          });
          yield* second.dispose;
        }),
      ),
    ));

  it("does not re-apply the patch of a submission the hydrated state already reflects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);

        const before = defineApp("Outbox.settled");
        const first = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const advance = Action.use(before.AdvanceAction, { runtime: first });
        yield* Effect.flip(advance.submit({ id: "atlas", by: 3 }));
        yield* Effect.flip(advance.submit({ id: "atlas", by: 5 }));
        const ids = storedIds(values);
        yield* first.dispose;

        // Reload: the server applied the first submission (its response was
        // lost) before rendering, so the hydrated value 13 already includes it.
        const after = defineApp("Outbox.settled", "1 hour", 13);
        const second = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        yield* second.provide(Action.restoreOutbox({ settled: [ids[0]!] }));
        expect(Signal.peek(after.total.model)).toBe(18);
        const outbox = yield* second.provide(Action.outbox);
        expect(Signal.peek(outbox.pending).map((entry) => entry.id)).toEqual(ids);

        // The replay still settles both, in order.
        const sentBefore = server.state.sent.length;
        server.state.online = true;
        yield* waitFor(() => Signal.peek(outbox.pending).length === 0);
        expect(server.state.sent.slice(sentBefore).map((sent) => sent.id)).toEqual(ids);
        expect(Signal.peek(after.total.model)).toBe(18);
        expect(Signal.peek(outbox.failures)).toEqual([]);
        yield* second.dispose;
      }),
    ));

  it("rolls back and reports a final failure of a queued submission", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        const { total, AdvanceAction } = defineApp("Outbox.final");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const advance = Action.use(AdvanceAction, { runtime });
        yield* Effect.flip(advance.submit({ id: "atlas", by: 2 }));
        expect(Signal.peek(total.model)).toBe(2);

        server.state.respond = () => Exit.fail("Rejected");
        server.state.online = true;
        const outbox = yield* runtime.provide(Action.outbox);
        yield* waitFor(() => Signal.peek(outbox.failures).length === 1);

        expect(Signal.peek(total.model)).toBe(0);
        expect(Signal.peek(outbox.pending)).toEqual([]);
        const [failure] = Signal.peek(outbox.failures);
        expect(failure!.action).toBe("Outbox.final");
        expect(failure!.input).toEqual({ id: "atlas", by: 2 });
        expect(Cause.findErrorOption(failure!.cause)).toEqual(Option.some("Rejected"));
        expect(storedIds(values)).toEqual([]);

        yield* runtime.provide(outbox.dismiss(failure!.id));
        expect(Signal.peek(outbox.failures)).toEqual([]);
        yield* runtime.dispose;
      }),
    ));

  it("gives a waiting caller its own final failure instead of the outbox", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        server.state.online = true;
        server.state.respond = () => Exit.fail("Rejected");
        const { total, AdvanceAction } = defineApp("Outbox.waiting");
        const runtime = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const advance = Action.use(AdvanceAction, { runtime });

        expect(yield* Effect.flip(advance.submit({ id: "atlas", by: 2 }))).toBe("Rejected");
        expect(Signal.peek(total.model)).toBe(0);
        const outbox = yield* runtime.provide(Action.outbox);
        expect(Signal.peek(outbox.failures)).toEqual([]);
        expect(storedIds(values)).toEqual([]);
        yield* runtime.dispose;
      }),
    ));

  it("expires submissions older than durable.maxAge instead of replaying them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        const before = defineApp("Outbox.ttl", "20 millis");
        const first = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        yield* Effect.flip(
          Action.use(before.AdvanceAction, { runtime: first }).submit({ id: "atlas", by: 1 }),
        );
        yield* first.dispose;
        yield* Effect.sleep("40 millis");

        const after = defineApp("Outbox.ttl", "20 millis");
        const second = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const sentBefore = server.state.sent.length;
        server.state.online = true;
        yield* second.provide(Action.restoreOutbox());
        const outbox = yield* second.provide(Action.outbox);

        expect(Signal.peek(after.total.model)).toBe(0);
        expect(Signal.peek(outbox.pending)).toEqual([]);
        const [failure] = Signal.peek(outbox.failures);
        expect(Cause.findErrorOption(failure!.cause).pipe(Option.getOrUndefined)).toBeInstanceOf(
          ActionSubmissionExpired,
        );
        expect(server.state.sent.length).toBe(sentBefore);
        expect(storedIds(values)).toEqual([]);
        yield* second.dispose;
      }),
    ));

  it("leaves non-durable Actions and runtimes without an outbox unchanged", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { values, storage } = memoryStorage();
        const server = fakeServer(values);
        const Plain = Action.define({
          name: "Outbox.plain",
          input: Advance,
          run: (input) => Effect.succeed(input.by),
        });
        const withOutbox = makeRuntime(
          Layer.mergeAll(
            server.layer,
            Action.outboxLayer({ retry: fastRetry }).pipe(Layer.provide(storage)),
          ),
        );
        const error = yield* Effect.flip(
          Action.use(Plain, { runtime: withOutbox }).submit({ id: "atlas", by: 1 }),
        );
        expect(error).toBeInstanceOf(ServerTransportError);
        expect(server.state.sent[0]!.id).toBeUndefined();
        expect(storedIds(values)).toEqual([]);

        // Without an outbox, a durable Action submits like any other.
        const { AdvanceAction } = defineApp("Outbox.none");
        const bare = makeRuntime(server.layer);
        const bareError = yield* Effect.flip(
          Action.use(AdvanceAction, { runtime: bare }).submit({ id: "atlas", by: 1 }),
        );
        expect(bareError).toBeInstanceOf(ServerTransportError);
        expect(Signal.peek((yield* bare.provide(Action.outbox)).pending)).toEqual([]);
        yield* withOutbox.dispose;
        yield* bare.dispose;
      }),
    ));
});
