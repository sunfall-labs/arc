import { Context, Deferred, Effect, Fiber, Layer, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { TestClock } from "effect/testing";
import { WorkflowEngine } from "effect/workflow";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionQueued,
  makeRuntime,
  Route,
  Signal,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import type { StartFetch } from "../src/index.js";
import { makeActionTransportLayer } from "../src/start-action-transport.js";
import { createStartRequestHandler } from "../src/start-request-handler.js";
import { makeStartServerApp } from "../src/start-server-app.js";
import { serverActionPath } from "../src/rpc.js";
import { startActionOutboxCookie } from "../src/start-action-outbox-cookie.js";
import {
  makeStartActionWorkflows,
  runActionSubmissionWorkflow,
} from "../src/start-action-workflow.js";

const AdvanceInput = Schema.Struct({ id: Schema.String });
const AdvanceOutput = Schema.Struct({ id: Schema.String, progress: Schema.Number });

/** A served durable Action whose `run` counts executions. */
const defineAdvance = (name: string) => {
  const runs = { count: 0 };
  const progress = Signal.make(0, { name: `${name}.progress` });
  const Advance = Action.define({
    name,
    input: AdvanceInput,
    output: AdvanceOutput,
    durable: { maxAge: "1 hour" },
    optimistic: (_input, transaction) => transaction.signal(progress, (value) => value + 8),
    run: ({ id }) => Effect.sync(() => ({ id, progress: ++runs.count * 8 })),
  });
  return { Advance, runs, progress };
};

const actionRequest = (body: unknown): Request =>
  new Request(`https://example.com${serverActionPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });

const readJson = (response: Response) => Effect.promise(() => response.json() as Promise<unknown>);

describe("durable Action submissions over Start", () => {
  it("sends the submission id and answers a duplicate POST without running the Action again", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Advance, runs } = defineAdvance("Start.durable.dedupe");
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, { actions: [Advance] });
        const bodies: Array<{ readonly name: string; readonly id?: string }> = [];
        const fetcher: StartFetch = (input, init) =>
          Effect.gen(function* () {
            bodies.push(JSON.parse(String(init?.body)));
            const url =
              input instanceof Request
                ? input.url
                : new URL(String(input), "https://example.com").href;
            return yield* Effect.orDie(Effect.scoped(handler(new Request(url, init))));
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ fetch: fetcher, actions: [Advance] }),
            Action.outboxLayer().pipe(Layer.provide(KeyValueStore.layerMemory)),
          ),
        );

        const value = yield* Action.use(Advance, { runtime }).submit({ id: "atlas" });
        expect(value).toEqual({ id: "atlas", progress: 8 });
        expect(runs.count).toBe(1);
        const [sent] = bodies;
        expect(sent!.name).toBe("Start.durable.dedupe");
        expect(typeof sent!.id).toBe("string");

        // A replay of the same submission returns the original response.
        const original = { _tag: "Success", value: { id: "atlas", progress: 8 } };
        const duplicate = yield* Effect.scoped(handler(actionRequest(sent)));
        expect(duplicate.status).toBe(200);
        expect(yield* readJson(duplicate)).toEqual(original);
        expect(runs.count).toBe(1);

        // A different id is a different submission.
        const fresh = yield* Effect.scoped(handler(actionRequest({ ...sent, id: "other" })));
        expect(yield* readJson(fresh)).toEqual({
          _tag: "Success",
          value: { id: "atlas", progress: 16 },
        });
        expect(runs.count).toBe(2);
        yield* runtime.dispose;
      }),
    ));

  it("joins a duplicate that arrives while the original is still running", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        let runs = 0;
        const Slow = Action.define({
          name: "Start.durable.concurrent",
          input: AdvanceInput,
          output: AdvanceOutput,
          durable: { maxAge: "1 hour" },
          run: ({ id }) =>
            Effect.gen(function* () {
              runs++;
              yield* Deferred.await(gate);
              return { id, progress: runs };
            }),
        });
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, { actions: [Slow] });
        const body = { name: Slow.name, input: { id: "atlas" }, id: "submission-1" };

        const first = yield* Effect.forkChild(Effect.scoped(handler(actionRequest(body))));
        yield* Effect.sleep("5 millis");
        const second = yield* Effect.forkChild(Effect.scoped(handler(actionRequest(body))));
        yield* Effect.sleep("5 millis");
        yield* Deferred.succeed(gate, undefined);

        const responses = [yield* Fiber.join(first), yield* Fiber.join(second)];
        const payloads = yield* Effect.forEach(responses, readJson);
        expect(payloads[0]).toEqual({ _tag: "Success", value: { id: "atlas", progress: 1 } });
        expect(payloads[1]).toEqual(payloads[0]);
        expect(runs).toBe(1);
      }),
    ));

  it("runs on the server Layer's WorkflowEngine, shared across server instances", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { Advance, runs } = defineAdvance("Start.durable.engine");
          // One engine (a cluster or SQL-backed engine in production) serving
          // two server instances.
          const engine = Context.get(
            yield* Layer.build(WorkflowEngine.layerMemory),
            WorkflowEngine.WorkflowEngine,
          );
          const server = Layer.succeed(WorkflowEngine.WorkflowEngine)(engine);
          const body = { name: Advance.name, input: { id: "atlas" }, id: "shared-1" };

          for (let instance = 0; instance < 2; instance++) {
            const app = makeStartServerApp({ routes: [Route.define("/", {})] as const, server });
            const handler = createStartRequestHandler(app, { actions: [Advance] });
            const response = yield* Effect.scoped(handler(actionRequest(body)));
            expect(yield* readJson(response)).toEqual({
              _tag: "Success",
              value: { id: "atlas", progress: 8 },
            });
          }
          expect(runs.count).toBe(1);

          // A submission without an id is not durable: it runs every time.
          const app = makeStartServerApp({ routes: [Route.define("/", {})] as const, server });
          const handler = createStartRequestHandler(app, { actions: [Advance] });
          const plain = { name: Advance.name, input: { id: "atlas" } };
          yield* Effect.scoped(handler(actionRequest(plain)));
          yield* Effect.scoped(handler(actionRequest(plain)));
          expect(runs.count).toBe(3);
        }),
      ),
    ));

  it("syncs a submission whose response was lost exactly once", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Advance, runs, progress } = defineAdvance("Start.durable.lost-response");
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, { actions: [Advance] });
        const network = { loseResponses: true };
        const fetcher: StartFetch<TypeError> = (input, init) =>
          Effect.gen(function* () {
            const url =
              input instanceof Request
                ? input.url
                : new URL(String(input), "https://example.com").href;
            const response = yield* Effect.orDie(Effect.scoped(handler(new Request(url, init))));
            if (network.loseResponses) {
              // The server committed, but the connection dropped.
              return yield* Effect.fail(new TypeError("Failed to fetch"));
            }
            return response;
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ fetch: fetcher, actions: [Advance] }),
            Action.outboxLayer({ retry: Schedule.spaced("5 millis") }).pipe(
              Layer.provide(KeyValueStore.layerMemory),
            ),
          ),
        );
        const advance = Action.use(Advance, { runtime });

        const queued = yield* Effect.flip(advance.submit({ id: "atlas" }));
        expect(queued).toBeInstanceOf(ActionQueued);
        expect(runs.count).toBe(1);
        expect(Signal.peek(progress)).toBe(8);

        network.loseResponses = false;
        const outbox = yield* runtime.provide(Action.outbox);
        for (let attempt = 0; attempt < 400 && Signal.peek(outbox.pending).length > 0; attempt++) {
          yield* Effect.sleep("5 millis");
        }
        expect(Signal.peek(outbox.pending)).toEqual([]);
        expect(Signal.peek(outbox.failures)).toEqual([]);
        expect(runs.count).toBe(1);
        expect(Signal.peek(progress)).toBe(8);
        yield* runtime.dispose;
      }),
    ));

  it("reports a lost-response submission as settled to the reloading page", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Advance, runs } = defineAdvance("Start.durable.settled-on-reload");
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, {
          actions: [Advance],
          render: (context) => JSON.stringify(context.hydrationPlan.root.payload),
        });
        const fetcher: StartFetch<TypeError> = (input, init) =>
          Effect.gen(function* () {
            const url = new URL(String(input), "https://example.com").href;
            yield* Effect.orDie(Effect.scoped(handler(new Request(url, init))));
            // The server committed, but the connection dropped.
            return yield* Effect.fail(new TypeError("Failed to fetch"));
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ fetch: fetcher, actions: [Advance] }),
            Action.outboxLayer({ retry: Schedule.recurs(0) }).pipe(
              Layer.provide(KeyValueStore.layerMemory),
            ),
          ),
        );
        expect(
          yield* Effect.flip(Action.use(Advance, { runtime }).submit({ id: "atlas" })),
        ).toBeInstanceOf(ActionQueued);
        expect(runs.count).toBe(1);
        const outbox = yield* runtime.provide(Action.outbox);
        const pending = Signal.peek(outbox.pending);
        expect(pending).toHaveLength(1);

        // The reload's document request carries the outbox cookie, plus a
        // submission this server never received.
        const cookie = startActionOutboxCookie(
          [...pending, { action: Advance.name, id: "never-sent" }],
          false,
        ).split(";", 1)[0]!;
        const document = yield* Effect.scoped(
          handler(new Request("https://example.com/", { headers: { cookie } })),
        );
        const payload = (yield* Effect.promise(() => document.json())) as {
          readonly settledSubmissions?: ReadonlyArray<string>;
        };
        expect(payload.settledSubmissions).toEqual([pending[0]!.id]);

        // Without the cookie there is nothing to report.
        const plain = yield* Effect.scoped(handler(new Request("https://example.com/")));
        expect(yield* Effect.promise(() => plain.json())).not.toHaveProperty("settledSubmissions");
        yield* runtime.dispose;
      }),
    ));

  it("forgets in-memory submission records once no client can replay them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const state = makeStartActionWorkflows();
        const runtime = makeRuntime(Layer.empty);
        const action = { name: "Start.durable.eviction", durable: { maxAge: "1 minute" as const } };
        let runs = 0;
        const submit = (id: string) =>
          runActionSubmissionWorkflow(
            state,
            runtime as unknown as AnySunfallArcRuntime<unknown>,
            action,
            { id, input: null },
            Effect.sync(() => new Response(String(++runs))),
          ).pipe(Effect.flatMap((response) => Effect.promise(() => response.text())));
        const records = () => {
          const lane = state.lanes.get(action.name)!;
          return { generations: lane.generations.length, ids: lane.byId.size };
        };

        expect(yield* submit("a")).toBe("1");
        yield* TestClock.adjust("59 seconds");
        // Within maxAge of settling, a replay returns the recorded response.
        expect(yield* submit("a")).toBe("1");
        expect(runs).toBe(1);

        yield* TestClock.adjust("2 seconds");
        // The first generation stops taking submissions; its record stays.
        expect(yield* submit("b")).toBe("2");
        expect(records()).toEqual({ generations: 2, ids: 2 });
        expect(yield* submit("a")).toBe("1");

        // A steady stream of submissions keeps at most two windows of records.
        for (let minute = 0; minute < 10; minute++) {
          yield* TestClock.adjust("1 minute");
          yield* submit(`steady-${minute}`);
          expect(records().generations).toBeLessThanOrEqual(2);
          expect(records().ids).toBeLessThanOrEqual(2);
        }

        // Long after maxAge the record is gone, so the id runs as new; the
        // client expired that submission long before this point.
        expect(yield* submit("a")).toBe(String(runs));
        yield* runtime.dispose;
      }).pipe(Effect.provide(TestClock.layer())),
    ));
});
