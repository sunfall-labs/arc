import { Context, Deferred, Effect, Fiber, Layer, Schedule, Schema, type Scope } from "effect";
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
  State,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import { testHttpClientLayer, type TestFetch } from "./test-http-client.js";
import { makeActionTransportLayer } from "../src/start-action-transport.js";
import { createStartRequestHandler } from "../src/start-request-handler.js";
import { makeStartServerApp } from "../src/start-server-app.js";
import { serverActionPath } from "../src/rpc.js";
import { startActionOutboxCookie } from "../src/start-action-outbox-cookie.js";
import { startActionSubmitterCookieName } from "../src/start-action-submitter.js";
import {
  makeStartActionWorkflows,
  runActionSubmissionWorkflow,
} from "../src/start-action-workflow.js";
import { defaultRuntime } from "@sunfall/arc-core/internal";

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

const AdvanceInput = Schema.Struct({ id: Schema.String });
const AdvanceOutput = Schema.Struct({ id: Schema.String, progress: Schema.Number });

/** A served durable Action whose `run` counts executions. */
const defineAdvance = (name: string) => {
  const runs = { count: 0 };
  const progress = stateCell(0, { name: `${name}.progress` });
  const Advance = Action.define({
    name,
    input: AdvanceInput,
    output: AdvanceOutput,
    durable: { maxAge: "1 hour" },
    optimistic: (_input, transaction) => transaction.set(progress, (value) => value + 8),
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

type Handler = (request: Request) => Effect.Effect<Response, unknown, Scope.Scope>;

/** A browser's cookie jar in front of a handler: stores `Set-Cookie`, sends `Cookie`. */
const makeBrowser = () => {
  const jar = new Map<string, string>();
  const send = (handler: Handler, request: Request) =>
    Effect.gen(function* () {
      const headers = new Headers(request.headers);
      const cookies = [...jar].map(([name, value]) => `${name}=${value}`);
      const sent = headers.get("cookie");
      if (sent !== null) {
        cookies.push(sent);
      }
      if (cookies.length > 0) {
        headers.set("cookie", cookies.join("; "));
      }
      const response = yield* Effect.orDie(
        Effect.scoped(handler(new Request(request, { headers }))),
      );
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";", 1);
        const separator = pair!.indexOf("=");
        jar.set(pair!.slice(0, separator), pair!.slice(separator + 1));
      }
      return response;
    });
  return {
    jar,
    send,
    /** Loads a document, as a page load does before any submission. */
    visit: (handler: Handler, path = "/") =>
      send(handler, new Request(`https://example.com${path}`)),
  };
};

describe("durable Action submissions over Start", () => {
  it("sends the submission id and answers a duplicate POST without running the Action again", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Advance, runs } = defineAdvance("Start.durable.dedupe");
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, { actions: [Advance] });
        const browser = makeBrowser();
        const bodies: Array<{ readonly name: string; readonly id?: string }> = [];
        const fetcher: TestFetch = (input, init) =>
          Effect.gen(function* () {
            bodies.push(JSON.parse(String(init?.body)));
            const url =
              input instanceof Request
                ? input.url
                : new URL(String(input), "https://example.com").href;
            return yield* browser.send(handler, new Request(url, init));
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ actions: [Advance] }).pipe(
              Layer.provide(testHttpClientLayer(fetcher)),
            ),
            Action.outboxLayer().pipe(Layer.provide(KeyValueStore.layerMemory)),
          ),
        );

        const value = yield* Action.use(Advance, { runtime }).submit({ id: "atlas" });
        expect(value).toEqual({ id: "atlas", progress: 8 });
        expect(runs.count).toBe(1);
        const [sent] = bodies;
        expect(sent!.name).toBe("Start.durable.dedupe");
        expect(typeof sent!.id).toBe("string");

        // The first durable submission minted the browser's submitter: an
        // HttpOnly, SameSite=Lax, Secure (https) cookie scripts never read.
        expect(browser.jar.get(startActionSubmitterCookieName)).toMatch(/^[\w-]{43}$/);

        // The same browser replaying the submission gets the original response.
        const original = { _tag: "Success", value: { id: "atlas", progress: 8 } };
        const duplicate = yield* browser.send(handler, actionRequest(sent));
        expect(duplicate.status).toBe(200);
        expect(duplicate.headers.getSetCookie()).toEqual([]);
        expect(yield* readJson(duplicate)).toEqual(original);
        expect(runs.count).toBe(1);

        // A different id is a different submission.
        const fresh = yield* browser.send(handler, actionRequest({ ...sent, id: "other" }));
        expect(yield* readJson(fresh)).toEqual({
          _tag: "Success",
          value: { id: "atlas", progress: 16 },
        });
        expect(runs.count).toBe(2);

        // Another browser that learned the id never reads the recorded
        // response: it runs its own execution, under its own new submitter.
        const stranger = makeBrowser();
        const replayed = yield* stranger.send(handler, actionRequest(sent));
        expect(yield* readJson(replayed)).toEqual({
          _tag: "Success",
          value: { id: "atlas", progress: 24 },
        });
        expect(runs.count).toBe(3);
        const [minted] = replayed.headers.getSetCookie();
        expect(minted).toMatch(
          new RegExp(
            `^${startActionSubmitterCookieName}=[\\w-]{43}; Max-Age=\\d+; Path=/; HttpOnly; Secure; SameSite=Lax$`,
          ),
        );
        expect(stranger.jar.get(startActionSubmitterCookieName)).not.toBe(
          browser.jar.get(startActionSubmitterCookieName),
        );

        // A malformed submitter is no submitter: it gets a fresh execution.
        const forged = yield* Effect.scoped(
          handler(
            new Request(actionRequest(sent), {
              headers: {
                "content-type": "application/json",
                accept: "application/json",
                cookie: `${startActionSubmitterCookieName}=forged`,
              },
            }),
          ),
        );
        expect(yield* readJson(forged)).toEqual({
          _tag: "Success",
          value: { id: "atlas", progress: 32 },
        });
        expect(runs.count).toBe(4);
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
        const browser = makeBrowser();
        yield* browser.visit(handler);

        const first = yield* Effect.forkChild(browser.send(handler, actionRequest(body)));
        yield* Effect.sleep("5 millis");
        const second = yield* Effect.forkChild(browser.send(handler, actionRequest(body)));
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
          // The submitter is a browser cookie, not server state: any instance
          // recognizes it.
          const browser = makeBrowser();

          for (let instance = 0; instance < 2; instance++) {
            const app = makeStartServerApp({ routes: [Route.define("/", {})] as const, server });
            const handler = createStartRequestHandler(app, { actions: [Advance] });
            const response = yield* browser.send(handler, actionRequest(body));
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
          yield* browser.send(handler, actionRequest(plain));
          yield* browser.send(handler, actionRequest(plain));
          expect(runs.count).toBe(3);

          // Another browser replaying the id on the shared engine runs anew.
          yield* makeBrowser().send(handler, actionRequest(body));
          expect(runs.count).toBe(4);
        }),
      ),
    ));

  it("syncs a submission whose response was lost exactly once", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { Advance, runs, progress } = defineAdvance("Start.durable.lost-response");
        const app = makeStartServerApp({ routes: [Route.define("/", {})] as const });
        const handler = createStartRequestHandler(app, { actions: [Advance] });
        const browser = makeBrowser();
        // The page load gives the browser its submitter before it submits.
        const page = yield* browser.visit(handler);
        expect(page.headers.get("cache-control")).toBe("private");
        expect(browser.jar.has(startActionSubmitterCookieName)).toBe(true);
        const network = { loseResponses: true };
        const fetcher: TestFetch = (input, init) =>
          Effect.gen(function* () {
            const url =
              input instanceof Request
                ? input.url
                : new URL(String(input), "https://example.com").href;
            const response = yield* browser.send(handler, new Request(url, init));
            if (network.loseResponses) {
              // The server committed, but the connection dropped.
              return yield* Effect.fail(new TypeError("Failed to fetch"));
            }
            return response;
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ actions: [Advance] }).pipe(
              Layer.provide(testHttpClientLayer(fetcher)),
            ),
            Action.outboxLayer({ retry: Schedule.spaced("5 millis") }).pipe(
              Layer.provide(KeyValueStore.layerMemory),
            ),
          ),
        );
        const advance = Action.use(Advance, { runtime });

        const queued = yield* Effect.flip(advance.submit({ id: "atlas" }));
        expect(queued).toBeInstanceOf(ActionQueued);
        expect(runs.count).toBe(1);
        expect(Signal.peek(progress.model)).toBe(8);

        network.loseResponses = false;
        const outbox = yield* runtime.provide(Action.outbox);
        for (let attempt = 0; attempt < 400 && Signal.peek(outbox.pending).length > 0; attempt++) {
          yield* Effect.sleep("5 millis");
        }
        expect(Signal.peek(outbox.pending)).toEqual([]);
        expect(Signal.peek(outbox.failures)).toEqual([]);
        expect(runs.count).toBe(1);
        expect(Signal.peek(progress.model)).toBe(8);
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
        const browser = makeBrowser();
        yield* browser.visit(handler);
        const fetcher: TestFetch = (input, init) =>
          Effect.gen(function* () {
            const url = new URL(String(input), "https://example.com").href;
            yield* browser.send(handler, new Request(url, init));
            // The server committed, but the connection dropped.
            return yield* Effect.fail(new TypeError("Failed to fetch"));
          });
        const runtime = makeRuntime(
          Layer.mergeAll(
            makeActionTransportLayer({ actions: [Advance] }).pipe(
              Layer.provide(testHttpClientLayer(fetcher)),
            ),
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
        const reload = (from: ReturnType<typeof makeBrowser>, outbox?: string) =>
          Effect.flatMap(
            from.send(
              handler,
              new Request("https://example.com/", {
                headers: outbox === undefined ? {} : { cookie: outbox },
              }),
            ),
            (document) =>
              Effect.promise(
                () =>
                  document.json() as Promise<{
                    readonly settledSubmissions?: ReadonlyArray<string>;
                  }>,
              ),
          );
        expect((yield* reload(browser, cookie)).settledSubmissions).toEqual([pending[0]!.id]);
        // Every later reload of the same browser still sees it settled.
        expect((yield* reload(browser, cookie)).settledSubmissions).toEqual([pending[0]!.id]);

        // Without the outbox cookie there is nothing to report.
        expect(yield* reload(browser)).not.toHaveProperty("settledSubmissions");

        // Another browser naming the same ids learns nothing: settlement is
        // reported only for the asking browser's own submissions.
        expect(yield* reload(makeBrowser(), cookie)).not.toHaveProperty("settledSubmissions");
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
            { owner: "browser", id, input: null },
            Effect.sync(() => new Response(String(++runs))),
          ).pipe(Effect.flatMap((response) => Effect.promise(() => response.text())));
        const records = () => {
          const lane = state.lanes.get(action.name)!;
          return { generations: lane.generations.length, ids: lane.byKey.size };
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
