import { Cause, Effect, Exit, Layer, Logger, Schema, Tracer } from "effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { describe, expect, it } from "vitest";
import {
  Action,
  ActionTransportError,
  makeRuntime,
  RequestContext,
  Resource,
  Route,
  Server,
} from "@sunfall/arc-core";
import { createStartRequestHandler } from "../src/start-request-handler.js";
import { rpcClientLayer } from "../src/start-rpc-client.js";
import { makeStartServerApp } from "../src/start-server-app.js";
import {
  createServerActionResponse,
  createServerRpcResponse,
} from "../src/start-request-endpoints.js";
import {
  serverActionPath,
  serverRpcPath,
  startJsonMediaType,
  startRequestIdHeader,
  startTransportKindHeader,
} from "../src/rpc.js";
import { parseStartActionResponse } from "../src/start-action-response-codec.js";
import { handlerFetch, testHttpClientLayer, type TestFetch } from "./test-http-client.js";

class EchoRejected extends Schema.TaggedError<EchoRejected>()("EchoRejected", {
  value: Schema.String,
}) {}

const Echo = Server.contract("Start.rpc.echo", {
  input: Schema.Struct({
    value: Schema.String,
    at: Schema.DateTimeUtcFromString,
  }),
  output: Schema.Struct({
    value: Schema.String,
    at: Schema.DateTimeUtcFromString,
  }),
  error: EchoRejected,
});
const echo = Server.client(Echo);
const echoServer = Server.implement(Echo, ({ value, at }) =>
  value === "reject"
    ? Effect.fail(new EchoRejected({ value }))
    : value === "die"
      ? Effect.die(new Error("echo exploded"))
      : Effect.succeed({ value: value.toUpperCase(), at }),
);

const WhoAmI = Server.contract("Start.rpc.whoami", {
  input: Schema.Void,
  output: Schema.String,
});
const whoAmI = Server.client(WhoAmI);
const whoAmIServer = Server.implement(WhoAmI, () =>
  Effect.gen(function* () {
    const request = yield* RequestContext;
    return request.headers.get("x-user") ?? "anonymous";
  }),
);

const app = makeStartServerApp({
  routes: [Route.define("/", {})] as const,
  registry: { serverFunctions: [echoServer, whoAmIServer] },
});

const rpcFetch: TestFetch = handlerFetch((request) => createServerRpcResponse(app, request));

const overHttp = <A, E>(
  effect: Effect.Effect<A, E, Server.Client>,
  fetch: TestFetch = rpcFetch,
): Effect.Effect<A, E> =>
  Effect.provide(effect, rpcClientLayer.pipe(Layer.provide(testHttpClientLayer(fetch))));

const firstFailure = <E>(cause: Cause.Cause<E>): E | undefined =>
  cause.reasons.find(Cause.isFailReason)?.error;

const at = new Date("2026-10-12T09:30:00.000Z");

describe("Start server functions over effect/rpc", () => {
  it("round-trips input and output through the contract schemas", () =>
    Effect.runPromise(
      overHttp(
        echo({
          value: "atlas",
          at: Schema.decodeSync(Schema.DateTimeUtcFromDate)(at),
        }),
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            expect(result.value).toBe("ATLAS");
            expect(result.at.epochMilliseconds).toBe(at.getTime());
          }),
        ),
      ),
    ));

  it("carries typed errors across the wire as schema-decoded values", () =>
    Effect.runPromise(
      Effect.exit(
        overHttp(
          echo({
            value: "reject",
            at: Schema.decodeSync(Schema.DateTimeUtcFromDate)(at),
          }),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(failure).toBeInstanceOf(EchoRejected);
            expect(failure).toMatchObject({ value: "reject" });
          }),
        ),
      ),
    ));

  it("reports handler defects as defects", () =>
    Effect.runPromise(
      Effect.exit(
        overHttp(
          echo({
            value: "die",
            at: Schema.decodeSync(Schema.DateTimeUtcFromDate)(at),
          }),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
          }),
        ),
      ),
    ));

  it("runs handlers in the request runtime", () =>
    Effect.runPromise(
      overHttp(whoAmI(), (input, init) =>
        rpcFetch(input, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            "x-user": "ada",
          },
        }),
      ).pipe(Effect.tap((user) => Effect.sync(() => expect(user).toBe("ada")))),
    ));

  it("answers functions the server does not serve with a defect", () => {
    const Missing = Server.contract("Start.rpc.missing", {
      input: Schema.Void,
      output: Schema.String,
    });
    const missing = Server.client(Missing);

    return Effect.runPromise(
      Effect.exit(overHttp(missing())).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
            expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "").toContain(
              "Unknown request tag: Start.rpc.missing",
            );
          }),
        ),
      ),
    );
  });

  it("propagates the caller's span to the server as traceparent", () => {
    let traceparent: string | null = null;
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });

    return Effect.runPromise(
      overHttp(
        echo({
          value: "trace",
          at: Schema.decodeSync(Schema.DateTimeUtcFromDate)(at),
        }).pipe(Effect.withSpan("caller")),
        (input, init) => {
          traceparent = new Headers(init.headers).get("traceparent");
          return rpcFetch(input, init);
        },
      ).pipe(
        Effect.withTracer(tracer),
        Effect.tap(() =>
          Effect.sync(() => {
            const caller = spans.find((span) => span.name === "caller");
            expect(caller).toBeDefined();
            expect(traceparent).toContain(caller!.traceId);
          }),
        ),
      ),
    );
  });

  it("answers non-POST requests with 405 and transport diagnostics", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerRpcResponse(
            app,
            new Request(`https://example.com${serverRpcPath}`, {
              method: "GET",
              headers: { [startRequestIdHeader]: "req-rpc-method" },
            }),
          );

          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("POST");
          expect(response.headers.get(startRequestIdHeader)).toBe("req-rpc-method");
          expect(response.headers.get(startTransportKindHeader)).toBe("rpc");
        }),
      ),
    ));
});

interface ActionFailureBody {
  readonly error: {
    readonly _tag?: string;
    readonly message?: string;
    readonly payload?: Record<string, unknown>;
  };
}

const readActionFailureBody = (response: Response): Effect.Effect<ActionFailureBody> =>
  Effect.promise(() => response.json() as Promise<ActionFailureBody>);

const erroringBodyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("body read failed"));
    },
  });

const clientResponse = (response: Response): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(HttpClientRequest.post(serverActionPath), response);

describe("Start action transport", () => {
  it("rejects action posts with unsupported content-type as typed protocol failures", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const response = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": "text/plain",
                [startRequestIdHeader]: "req-action-content-type",
              },
              body: "not a supported action body",
            }),
            [],
          );
          const body = yield* readActionFailureBody(response);

          expect(response.status).toBe(415);
          expect(response.headers.get(startRequestIdHeader)).toBe("req-action-content-type");
          expect(response.headers.get(startTransportKindHeader)).toBe("action");
          expect(body.error).toMatchObject({
            _tag: "ActionProtocolError",
            payload: { contentType: "text/plain" },
          });
          expect(body.error.message).toContain("application/json");
        }),
      ),
    ));

  it("labels invalid action response content-types as action transport failures", () =>
    Effect.runPromise(
      Effect.exit(
        parseStartActionResponse(
          clientResponse(
            new Response("not json", {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
          ),
        ),
      ).pipe(
        Effect.tap((exit) =>
          Effect.sync(() => {
            const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;
            expect(failure).toBeInstanceOf(ActionTransportError);
            expect(failure).toMatchObject({
              reason: "InvalidResponse",
              status: 200,
              message: "Start action response content-type was not application/json.",
            });
          }),
        ),
      ),
    ));

  it("maps request and response body reader failures as typed failures", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const requestResponse = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": startJsonMediaType,
              },
              body: erroringBodyStream(),
              duplex: "half",
            } as RequestInit),
            [],
          );
          const requestFailure = yield* readActionFailureBody(requestResponse);
          const responseExit = yield* Effect.exit(
            parseStartActionResponse(
              clientResponse(
                new Response(erroringBodyStream(), {
                  status: 200,
                  headers: { "content-type": startJsonMediaType },
                }),
              ),
            ),
          );

          expect(requestFailure.error).toMatchObject({
            _tag: "ActionProtocolError",
            message: "Expected a JSON action request body.",
          });
          const responseFailure = Exit.isFailure(responseExit)
            ? firstFailure(responseExit.cause)
            : undefined;
          expect(responseFailure).toBeInstanceOf(ActionTransportError);
          expect(responseFailure).toMatchObject({
            reason: "InvalidResponse",
            status: 200,
            message: "Could not read the action response body.",
          });
        }),
      ),
    ));

  it("maps defect and bad-status action responses to transport failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const json = (body: unknown, status: number) =>
          clientResponse(
            new Response(JSON.stringify(body), {
              status,
              headers: { "content-type": startJsonMediaType },
            }),
          );
        const defect = yield* Effect.flip(
          parseStartActionResponse(json({ _tag: "Defect", defect: { message: "boom" } }, 500)),
        );
        const badStatus = yield* Effect.flip(
          parseStartActionResponse(json({ _tag: "Success", value: "ok" }, 500)),
        );

        expect(defect).toMatchObject({
          _tag: "ActionTransportError",
          reason: "Defect",
          status: 500,
          payload: { message: "boom" },
        });
        expect(badStatus).toMatchObject({
          _tag: "ActionTransportError",
          reason: "BadStatus",
          status: 500,
          message: "Start action Success response used unexpected HTTP status 500.",
        });
      }),
    ));

  it("rejects malformed JSON action payloads as typed protocol failures", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const missingName = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": startJsonMediaType,
              },
              body: JSON.stringify({ input: { value: "missing action name" } }),
            }),
            [],
          );
          const malformed = yield* createServerActionResponse(
            app,
            new Request(`https://example.com${serverActionPath}`, {
              method: "POST",
              headers: {
                accept: startJsonMediaType,
                "content-type": startJsonMediaType,
              },
              body: "{",
            }),
            [],
          );
          const missingNameBody = yield* readActionFailureBody(missingName);
          const malformedBody = yield* readActionFailureBody(malformed);

          expect(missingName.status).toBe(400);
          expect(missingNameBody.error._tag).toBe("ActionProtocolError");
          expect(missingNameBody.error.message).toContain(
            "Expected an action request with string name",
          );
          expect(malformed.status).toBe(400);
          expect(malformedBody.error).toMatchObject({
            _tag: "ActionProtocolError",
            message: "Expected a JSON action request body.",
          });
        }),
      ),
    ));
});

class ProjectMissing extends Schema.TaggedError<ProjectMissing>()("ProjectMissing", {
  id: Schema.String,
}) {}

/** A served Resource: browser-safe schemas, no load. */
const ProjectName = Resource.define({
  name: "Start.rpc.served.ProjectName",
  input: Schema.String,
  output: Schema.String,
  error: ProjectMissing,
});

const servedLoads: Array<string> = [];
/** Its server load (what a `*.server.ts` module exports). */
const projectName = Resource.implement(ProjectName, (id) =>
  Effect.sync(() => servedLoads.push(id)).pipe(
    Effect.andThen(
      id === "atlas" ? Effect.succeed("Atlas") : Effect.fail(new ProjectMissing({ id })),
    ),
  ),
);

describe("served Resources", () => {
  const servedApp = makeStartServerApp({
    routes: [
      Route.define("/", {
        preload: () => Resource.preload(ProjectName("atlas")).pipe(Effect.orDie),
      }),
    ] as const,
    registry: { serverFunctions: [projectName] },
  });
  const servedFetch: TestFetch = handlerFetch((request) =>
    createServerRpcResponse(servedApp, request),
  );
  /** Runs `effect` on a browser-like runtime whose `Server.Client` is Start's RPC client. */
  const inBrowser = <A, E>(effect: Effect.Effect<A, E>, fetch: TestFetch = servedFetch) => {
    const runtime = makeRuntime(rpcClientLayer.pipe(Layer.provide(testHttpClientLayer(fetch))));
    return runtime.provide(effect).pipe(Effect.ensuring(runtime.dispose.pipe(Effect.orDie)));
  };

  it("loads in-process on the server during SSR", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          servedLoads.length = 0;
          const handler = createStartRequestHandler(servedApp, {
            render: ({ hydrationPlan }) => `<main>${hydrationPlan.legacy.script}</main>`,
          });
          const response = yield* handler(new Request("https://example.com/"));
          const payload = yield* Effect.promise(() => response.text());

          expect(response.status).toBe(200);
          expect(servedLoads).toEqual(["atlas"]);
          expect(payload).toContain('"Atlas"');
        }),
      ),
    ));

  it("loads through the server over RPC with the family's schemas", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        servedLoads.length = 0;
        const name = yield* inBrowser(Resource.preload(ProjectName("atlas")));

        expect(name).toBe("Atlas");
        expect(servedLoads).toEqual(["atlas"]);
      }),
    ));

  it("delivers a failure the family's error schema declares as a typed failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(inBrowser(Resource.preload(ProjectName("nowhere"))));
        const failure = Exit.isFailure(exit) ? firstFailure(exit.cause) : undefined;

        expect(failure).toBeInstanceOf(ProjectMissing);
        expect(failure).toMatchObject({ id: "nowhere" });
      }),
    ));

  it("turns an RPC transport failure into a defect, never a typed failure", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const offline: TestFetch = () => Effect.fail(new TypeError("Failed to fetch"));
        const exit = yield* Effect.exit(
          inBrowser(Resource.preload(ProjectName("offline")), offline),
        );

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
        expect(Exit.isFailure(exit) ? firstFailure(exit.cause) : "succeeded").toBeUndefined();
      }),
    ));
});

describe("server defects stay on the server", () => {
  const secret = "SELECT password FROM users /srv/app/db.ts";

  const capturedLogs = () => {
    const logs: Array<{ readonly cause: Cause.Cause<unknown> }> = [];
    const layer = Logger.layer([
      Logger.make(({ cause }) => {
        logs.push({ cause });
      }),
    ]);
    return { logs, layer };
  };

  const Leaky = Server.contract("Start.rpc.defect.leaky", {
    input: Schema.Struct({ mode: Schema.String }),
    output: Schema.String,
    error: EchoRejected,
  });
  const leakyServer = Server.implement(Leaky, ({ mode }) =>
    mode === "die"
      ? Effect.die(new Error(secret))
      : mode === "throw"
        ? Effect.sync((): string => {
            throw new Error(secret);
          })
        : mode === "undeclared"
          ? (Effect.fail({ detail: secret }) as unknown as Effect.Effect<string, EchoRejected>)
          : Effect.fail(new EchoRejected({ value: mode })),
  );
  const LeakyAction = Action.define<{ readonly mode: string }, string, EchoRejected>({
    name: "Start.action.defect.leaky",
    input: Schema.Struct({ mode: Schema.String }),
    output: Schema.String,
    error: EchoRejected,
    run: ({ mode }) =>
      mode === "die"
        ? Effect.die(new Error(secret))
        : mode === "throw"
          ? Effect.sync((): string => {
              throw new Error(secret);
            })
          : mode === "undeclared"
            ? (Effect.fail({ detail: secret }) as unknown as Effect.Effect<string, EchoRejected>)
            : mode === "output"
              ? (Effect.succeed({
                  detail: secret,
                }) as unknown as Effect.Effect<string>)
              : Effect.fail(new EchoRejected({ value: mode })),
  });
  const leakyApp = makeStartServerApp({
    routes: [Route.define("/", {})] as const,
    registry: { serverFunctions: [leakyServer] },
  });
  const handler = createStartRequestHandler(leakyApp, {
    actions: [LeakyAction],
  });

  const post = (path: string, body: string) =>
    new Request(`https://example.com${path}`, {
      method: "POST",
      headers: {
        "content-type": startJsonMediaType,
        accept: startJsonMediaType,
      },
      body,
    });

  const rpcBody = (mode: string) =>
    JSON.stringify({
      _tag: "Request",
      id: "1",
      tag: "Start.rpc.defect.leaky",
      payload: { mode },
      headers: [],
    });

  const send = (request: Request, layer: Layer.Layer<never>) =>
    Effect.runPromise(
      Effect.scoped(handler(request)).pipe(
        Effect.flatMap((response) =>
          Effect.promise(async () => ({
            status: response.status,
            text: await response.text(),
          })),
        ),
        Effect.provide(layer),
      ),
    );

  it.each(["die", "throw", "undeclared"])(
    "answers a server function %s with an opaque defect and logs the cause",
    async (mode) => {
      const { logs, layer } = capturedLogs();
      const { text } = await send(post(serverRpcPath, rpcBody(mode)), layer);
      expect(text).not.toContain("password");
      expect(text).not.toContain("/srv/");
      expect(text).toContain("StartServerDefect");
      expect(logs.some((log) => Cause.pretty(log.cause).includes("password"))).toBe(true);
    },
  );

  it("still carries declared server function failures, unlogged", async () => {
    const { logs, layer } = capturedLogs();
    const { text } = await send(post(serverRpcPath, rpcBody("rejected")), layer);
    expect(text).toContain("EchoRejected");
    expect(logs).toEqual([]);
  });

  it.each(["die", "throw", "undeclared", "output"])(
    "answers an action %s with an opaque defect and logs the cause",
    async (mode) => {
      const { logs, layer } = capturedLogs();
      const { status, text } = await send(
        post(serverActionPath, JSON.stringify({ name: LeakyAction.name, input: { mode } })),
        layer,
      );
      expect(status).toBe(500);
      expect(JSON.parse(text)).toEqual({
        _tag: "Defect",
        defect: {
          _tag: "StartServerDefect",
          message: "The server failed to handle the request.",
        },
      });
      // An output that does not encode logs the schema issue; the others log the secret.
      expect(
        logs.some(
          (log) =>
            log.cause.reasons.length > 0 &&
            (mode === "output" || Cause.pretty(log.cause).includes("password")),
        ),
      ).toBe(true);
    },
  );

  it("sends no stack with action protocol errors", async () => {
    const { layer } = capturedLogs();
    const { status, text } = await send(post(serverActionPath, "{not json"), layer);
    expect(status).toBe(400);
    expect(text).not.toContain("stack");
    expect(text).not.toContain("node:internal");
  });
});
