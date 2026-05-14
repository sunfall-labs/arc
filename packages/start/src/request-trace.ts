import {
  runWithRuntime,
  toEffect,
  type EffectInput,
  type EffectUiRuntime,
  type Route
} from "@effect-ui/core";
import type { AnyCollection } from "@effect-ui/db";
import { Clock, Effect } from "effect";
import {
  makeStartRequestIdEffect,
  serverActionPath,
  serverRpcPath,
  startRequestIdHeader,
  startTraceparentHeader
} from "./rpc.js";

export type StartRequestTraceTransport = "ssr" | "rpc" | "action" | "unknown";
export type StartRequestTraceStatus = "success" | "failure" | "cancelled";
export type StartRequestTraceFailureKind =
  | "domain"
  | "validation"
  | "protocol"
  | "transport"
  | "defect"
  | "interruption";
export type StartRequestTraceStreamState = "open" | "closed" | "cancelled" | "errored";
export type StartRequestTraceFiberStatus = "running" | "done" | "interrupted" | "failed";

export interface StartRequestTraceHeader {
  readonly name: string;
  readonly value: string;
}

export interface StartRequestTraceCookie {
  readonly name: string;
  readonly value: string;
}

export interface StartRequestTraceRequest {
  readonly id?: string;
  readonly traceparent?: string;
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly transport: StartRequestTraceTransport;
  readonly headers?: ReadonlyArray<StartRequestTraceHeader>;
  readonly cookies?: ReadonlyArray<StartRequestTraceCookie>;
}

export interface StartRequestTraceResponse {
  readonly status: number;
  readonly statusText?: string;
  readonly headers?: ReadonlyArray<StartRequestTraceHeader>;
  readonly setCookieCount?: number;
}

export interface StartRequestTraceResource {
  readonly key: string;
  readonly family: string;
  readonly input?: unknown;
  readonly state?: string;
}

export interface StartRequestTraceCollection {
  readonly name: string;
  readonly state?: string;
  readonly eventCount?: number;
}

export interface StartRequestTraceServerFunction {
  readonly name: string;
  readonly status?: StartRequestTraceStatus;
  readonly failureKind?: StartRequestTraceFailureKind;
}

export interface StartRequestTraceAction {
  readonly name: string;
  readonly state?: string;
  readonly failureKind?: StartRequestTraceFailureKind;
  readonly invalidationIndexes?: ReadonlyArray<number>;
}

export interface StartRequestTraceFiber {
  readonly name: string;
  readonly status: StartRequestTraceFiberStatus;
}

export interface StartRequestTraceStream {
  readonly name: string;
  readonly state: StartRequestTraceStreamState;
  readonly chunkCount?: number;
}

export interface StartRequestTraceTeardownSnapshot {
  readonly fiberCount: number;
  readonly familyCount: number;
  readonly moduleCount: number;
  readonly tagCount: number;
}

export interface StartRequestTraceTeardown {
  readonly runtimeDisposed: boolean;
  readonly reason?: string;
  readonly at?: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly durationMillis?: number;
  readonly beforeDispose?: StartRequestTraceTeardownSnapshot;
  readonly afterDispose?: StartRequestTraceTeardownSnapshot;
}

export interface StartRequestTrace {
  readonly request: StartRequestTraceRequest;
  readonly response?: StartRequestTraceResponse;
  readonly services: ReadonlyArray<string>;
  readonly routePlan?: StartRequestTraceRoutePlan;
  readonly resources: ReadonlyArray<StartRequestTraceResource>;
  readonly collections: ReadonlyArray<StartRequestTraceCollection>;
  readonly serverFunctions: ReadonlyArray<StartRequestTraceServerFunction>;
  readonly actions: ReadonlyArray<StartRequestTraceAction>;
  readonly fibers: ReadonlyArray<StartRequestTraceFiber>;
  readonly streams: ReadonlyArray<StartRequestTraceStream>;
  readonly status: StartRequestTraceStatus;
  readonly failureKind?: StartRequestTraceFailureKind;
  readonly teardown?: StartRequestTraceTeardown;
}

export interface StartRequestTraceRoutePlan {
  readonly _tag: "Matched" | "NotFound";
  readonly href: string;
  readonly match:
    | {
        readonly path: string;
        readonly href: string;
        readonly params: unknown;
        readonly search: unknown;
      }
    | undefined;
  readonly resources: ReadonlyArray<{
    readonly key: string;
    readonly family: string;
    readonly input: unknown;
  }>;
  readonly hydration: {
    readonly resourceCount: number;
  };
}

export interface StartRequestTraceFacts {
  readonly requestId: string;
  readonly transport: StartRequestTraceTransport;
  readonly startedAt: number;
  routePlan?: StartRequestTraceRoutePlan;
  collections: StartRequestTraceCollection[];
  serverFunctions: StartRequestTraceServerFunction[];
  actions: StartRequestTraceAction[];
  failureKind?: StartRequestTraceFailureKind;
}

export interface StartCollectionPreloadTraceInput {
  readonly routeTouchedCollections: ReadonlyArray<AnyCollection>;
  readonly routeDeclaredCollections: ReadonlyArray<AnyCollection>;
  readonly registeredCollections: ReadonlyArray<AnyCollection>;
  readonly dehydratedCollections: ReadonlyArray<AnyCollection>;
}

/** Best-effort request diagnostics hook. Failures from the hook are ignored. */
export type StartRequestTraceHandler = (trace: StartRequestTrace) => EffectInput<void, unknown, never>;

export const startRequestTraceTransport = (request: Request): StartRequestTraceTransport => {
  const pathname = new URL(request.url).pathname;
  return pathname === serverRpcPath
    ? "rpc"
    : pathname === serverActionPath
      ? "action"
      : "ssr";
};

const traceHeaders = (headers: Headers): ReadonlyArray<StartRequestTraceHeader> => {
  const out: StartRequestTraceHeader[] = [];
  headers.forEach((value, name) => {
    out.push({ name, value });
  });
  return out.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.value.localeCompare(right.value) : byName;
  });
};

const traceCookies = (headers: Headers): ReadonlyArray<StartRequestTraceCookie> => {
  const cookie = headers.get("cookie");
  if (!cookie) {
    return [];
  }

  return cookie
    .split(";")
    .flatMap((part) => {
      const [rawName, ...rawValue] = part.trim().split("=");
      return rawName
        ? [
            {
              name: decodeURIComponent(rawName),
              value: decodeURIComponent(rawValue.join("="))
            }
          ]
        : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

const traceResponse = (response: Response): StartRequestTraceResponse => {
  const headers = traceHeaders(response.headers);
  const setCookieCount = response.headers.getSetCookie().length;
  return {
    status: response.status,
    ...(response.statusText === "" ? {} : { statusText: response.statusText }),
    ...(headers.length === 0 ? {} : { headers }),
    ...(setCookieCount === 0 ? {} : { setCookieCount })
  };
};

const traceRequest = (
  request: Request,
  facts: StartRequestTraceFacts
): StartRequestTraceRequest => {
  const url = new URL(request.url);
  const headers = traceHeaders(request.headers);
  const cookies = traceCookies(request.headers);
  const traceparent = request.headers.get(startTraceparentHeader)?.trim() || undefined;
  return {
    id: facts.requestId,
    ...(traceparent === undefined ? {} : { traceparent }),
    method: request.method,
    url: request.url,
    path: url.pathname,
    transport: facts.transport,
    ...(headers.length === 0 ? {} : { headers }),
    ...(cookies.length === 0 ? {} : { cookies })
  };
};

const traceResourceRefs = (
  refs: ReadonlyArray<{ readonly key: string; readonly family: { readonly options: { readonly name: string } }; readonly input: unknown }>
): ReadonlyArray<StartRequestTraceResource> =>
  refs.map((ref) => ({
    key: ref.key,
    family: ref.family.options.name,
    input: ref.input
  }));

export const traceRoutePlan = (
  plan: Route.NavigationPlan
): StartRequestTraceRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match
    ? {
        path: plan.match.route.path,
        href: plan.match.href,
        params: plan.match.params,
        search: plan.match.search
      }
    : undefined,
  resources: traceResourceRefs(plan.refs).map((resource) => ({
    key: resource.key,
    family: resource.family,
    input: resource.input
  })),
  hydration: {
    resourceCount: plan.resources.resources.length
  }
});

const uniqueCollections = (
  collections: Iterable<AnyCollection>
): ReadonlyArray<AnyCollection> => {
  const names = new Set<string>();
  const out: Array<AnyCollection> = [];
  for (const collection of collections) {
    if (!names.has(collection.name)) {
      names.add(collection.name);
      out.push(collection);
    }
  }
  return out;
};

const collectionTraceState = (
  runtime: EffectUiRuntime<unknown, unknown>,
  collection: AnyCollection
): string | undefined => {
  try {
    return runWithRuntime(runtime, () => collection.state().get()._tag);
  } catch {
    return undefined;
  }
};

export const traceCollectionPreload = (
  runtime: EffectUiRuntime<unknown, unknown>,
  collectionPreload: StartCollectionPreloadTraceInput
): ReadonlyArray<StartRequestTraceCollection> =>
  uniqueCollections([
    ...collectionPreload.routeTouchedCollections,
    ...collectionPreload.routeDeclaredCollections,
    ...collectionPreload.registeredCollections,
    ...collectionPreload.dehydratedCollections
  ])
    .map((collection) => {
      const state = collectionTraceState(runtime, collection);
      return {
        name: collection.name,
        ...(state === undefined ? {} : { state })
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

export const startRequestTraceFactsEffect = (
  request: Request
): Effect.Effect<StartRequestTraceFacts> =>
  Effect.gen(function* () {
    const incomingRequestId = request.headers.get(startRequestIdHeader)?.trim();
    const startedAt = yield* Clock.currentTimeMillis;
    return {
      requestId: incomingRequestId && !/[\r\n]/.test(incomingRequestId)
        ? incomingRequestId
        : yield* makeStartRequestIdEffect,
      transport: startRequestTraceTransport(request),
      startedAt,
      collections: [],
      serverFunctions: [],
      actions: []
    };
  });

export const emitStartRequestTraceEffect = (
  handler: StartRequestTraceHandler | undefined,
  trace: StartRequestTrace
): Effect.Effect<void> =>
  handler === undefined
    ? Effect.void
    : toEffect(handler(trace)).pipe(
        Effect.catchCause(() => Effect.void)
      );

export const buildStartRequestTrace = (
  request: Request,
  facts: StartRequestTraceFacts,
  status: StartRequestTraceStatus,
  options: {
    readonly response?: Response;
    readonly teardown: StartRequestTraceTeardown;
    readonly stream?: StartRequestTraceStream;
  }
): StartRequestTrace => {
  const traceStatus = facts.failureKind === undefined || status === "cancelled"
    ? status
    : "failure";
  const fiberStatus: StartRequestTraceFiberStatus = traceStatus === "success"
    ? "done"
    : traceStatus === "cancelled" || facts.failureKind === "interruption"
      ? "interrupted"
      : "failed";

  return {
    request: traceRequest(request, facts),
    ...(options.response === undefined ? {} : { response: traceResponse(options.response) }),
    services: ["RequestContext", "ResponseContext"],
    ...(facts.routePlan === undefined ? {} : { routePlan: facts.routePlan }),
    resources: facts.routePlan?.resources ?? [],
    collections: facts.collections,
    serverFunctions: [...facts.serverFunctions],
    actions: [...facts.actions],
    fibers: [
      {
        name: "request-runtime",
        status: fiberStatus
      }
    ],
    streams: options.stream === undefined ? [] : [options.stream],
    status: traceStatus,
    ...(facts.failureKind === undefined ? {} : { failureKind: facts.failureKind }),
    teardown: options.teardown
  };
};

export const requestRuntimeTeardownSnapshot = (
  runtime: EffectUiRuntime<unknown, unknown>
): StartRequestTraceTeardownSnapshot => ({
  fiberCount: runtime.resourceStore.fibers.size,
  familyCount: runtime.resourceStore.families.size,
  moduleCount: runtime.resourceStore.modules.size,
  tagCount: runtime.resourceStore.tagIndex.size
});

export const requestRuntimeDisposeTraceEffect = (
  runtime: EffectUiRuntime<unknown, unknown>
): Effect.Effect<{
  readonly beforeDispose: StartRequestTraceTeardownSnapshot;
  readonly afterDispose: StartRequestTraceTeardownSnapshot;
  readonly completedAt: number;
}> =>
  Effect.gen(function* () {
    const beforeDispose = requestRuntimeTeardownSnapshot(runtime);
    yield* runtime.disposeEffect;
    const afterDispose = requestRuntimeTeardownSnapshot(runtime);
    const completedAt = yield* Clock.currentTimeMillis;
    return {
      beforeDispose,
      afterDispose,
      completedAt
    };
  });

export const startRequestTraceTeardown = (
  facts: StartRequestTraceFacts,
  options: {
    readonly runtimeDisposed: boolean;
    readonly reason: string;
    readonly completedAt: number;
    readonly beforeDispose: StartRequestTraceTeardownSnapshot;
    readonly afterDispose: StartRequestTraceTeardownSnapshot;
  }
): StartRequestTraceTeardown => ({
  runtimeDisposed: options.runtimeDisposed,
  reason: options.reason,
  at: options.completedAt,
  startedAt: facts.startedAt,
  completedAt: options.completedAt,
  durationMillis: Math.max(0, options.completedAt - facts.startedAt),
  beforeDispose: options.beforeDispose,
  afterDispose: options.afterDispose
});
