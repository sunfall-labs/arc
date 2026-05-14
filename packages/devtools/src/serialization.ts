import {
  isResourceRef,
  isResourceTag,
  type ResourceInvalidation,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type Route
} from "@effect-ui/core";
import { Data } from "effect";
import type {
  DevtoolsCollectionStoreEvent,
  DevtoolsInvalidationCause,
  DevtoolsInvalidationPlan,
  DevtoolsInvalidationTarget,
  DevtoolsRequestTrace,
  DevtoolsRequestTraceCookie,
  DevtoolsRequestTraceHeader,
  DevtoolsRequestTraceRequest,
  DevtoolsRequestTraceResponse,
  DevtoolsRequestTraceTeardown,
  DevtoolsRoutePlan,
  DevtoolsRuntimeEvent,
  DevtoolsSerializableValue,
  DevtoolsSnapshot,
  DevtoolsStartAppGraphDiagnostics
} from "./index.js";

export class DevtoolsUnknownInvalidationTarget extends Data.TaggedError(
  "DevtoolsUnknownInvalidationTarget"
)<{
  readonly target: unknown;
  readonly guidance: string;
}> {}

const describeResourceRef = (ref: {
  readonly key: string;
  readonly family: { readonly options: { readonly name: string } };
  readonly input: unknown;
}) => ({
  key: ref.key,
  family: ref.family.options.name,
  input: ref.input
});

const describeTarget = (target: ResourceInvalidation): DevtoolsInvalidationTarget => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      ...describeResourceRef(target)
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name
    };
  }

  throw new DevtoolsUnknownInvalidationTarget({
    target,
    guidance: "Record invalidation targets as Resource refs or Resource tags."
  });
};

const describeCause = (cause: ResourceInvalidationCause): DevtoolsInvalidationCause => {
  switch (cause._tag) {
    case "Ref":
      return {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      };
    case "Tag":
      return {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };
  }
};

const objectTag = (tag: string, value?: string): { readonly [key: string]: DevtoolsSerializableValue } =>
  value === undefined
    ? { _tag: tag }
    : {
        _tag: tag,
        value
      };

export interface DevtoolsSerializationPolicy {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxStringLength?: number;
}

const defaultSerializationPolicy = {
  maxDepth: 8,
  maxEntries: 50,
  maxStringLength: 1_000
} satisfies Required<DevtoolsSerializationPolicy>;

const normalizeSerializationPolicy = (
  policy: DevtoolsSerializationPolicy | undefined
): Required<DevtoolsSerializationPolicy> => ({
  maxDepth: policy?.maxDepth ?? defaultSerializationPolicy.maxDepth,
  maxEntries: policy?.maxEntries ?? defaultSerializationPolicy.maxEntries,
  maxStringLength: policy?.maxStringLength ?? defaultSerializationPolicy.maxStringLength
});

const truncatedMarker = (remaining: number): DevtoolsSerializableValue => ({
  _tag: "Truncated",
  remaining
});

const truncatedString = (
  value: string,
  policy: Required<DevtoolsSerializationPolicy>
): string | DevtoolsSerializableValue =>
  value.length <= policy.maxStringLength
    ? value
    : {
        _tag: "TruncatedString",
        length: value.length,
        value: value.slice(0, policy.maxStringLength)
      };

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "Error";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const serializeEntries = <A>(
  values: Iterable<A>,
  policy: Required<DevtoolsSerializationPolicy>,
  serialize: (value: A) => DevtoolsSerializableValue
): ReadonlyArray<DevtoolsSerializableValue> => {
  const serialized: DevtoolsSerializableValue[] = [];
  let index = 0;
  let truncated = 0;
  for (const value of values) {
    if (index < policy.maxEntries) {
      serialized.push(serialize(value));
    } else {
      truncated += 1;
    }
    index += 1;
  }

  if (truncated > 0) {
    serialized.push(truncatedMarker(truncated));
  }

  return serialized;
};

const serializeValue = (
  value: unknown,
  policy: Required<DevtoolsSerializationPolicy>,
  seen: WeakSet<object>,
  depth: number
): DevtoolsSerializableValue => {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncatedString(value, policy);
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : objectTag("NonFiniteNumber", String(value));
  }

  if (typeof value === "bigint") {
    return objectTag("BigInt", value.toString());
  }

  if (typeof value === "undefined") {
    return objectTag("Undefined");
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return {
      _tag: "NonSerializable",
      kind: typeof value,
      value: String(value)
    };
  }

  if (value instanceof Date) {
    return {
      _tag: "Date",
      value: Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()
    };
  }

  if (value instanceof Error) {
    return {
      _tag: "Error",
      name: value.name,
      message: truncatedString(value.message, policy),
      ...(value.stack === undefined ? {} : { stack: truncatedString(value.stack, policy) })
    };
  }

  if (depth >= policy.maxDepth) {
    return objectTag("MaxDepth");
  }

  if (seen.has(value)) {
    return objectTag("Circular");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const serialized = serializeEntries(
      value,
      policy,
      (item) => serializeValue(item, policy, seen, depth + 1)
    );
    seen.delete(value);
    return serialized;
  }

  if (value instanceof Map) {
    const entries = serializeEntries(
      value.entries(),
      policy,
      ([key, item]) => [
        serializeValue(key, policy, seen, depth + 1),
        serializeValue(item, policy, seen, depth + 1)
      ]
    );
    seen.delete(value);
    return {
      _tag: "Map",
      size: value.size,
      entries
    };
  }

  if (value instanceof Set) {
    const values = serializeEntries(
      value.values(),
      policy,
      (item) => serializeValue(item, policy, seen, depth + 1)
    );
    seen.delete(value);
    return {
      _tag: "Set",
      size: value.size,
      values
    };
  }

  const record = value as Record<string, unknown>;
  let keys: string[];
  try {
    keys = Object.keys(record).sort();
  } catch (error) {
    seen.delete(value);
    return {
      _tag: "UninspectableObject",
      name: errorName(error),
      message: truncatedString(errorMessage(error), policy)
    };
  }

  const serialized: Record<string, DevtoolsSerializableValue> = {};
  let truncated = 0;
  for (const key of keys) {
    if (Object.keys(serialized).length >= policy.maxEntries) {
      truncated += 1;
      continue;
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch (error) {
      serialized[key] = {
        _tag: "UninspectableProperty",
        name: errorName(error),
        message: truncatedString(errorMessage(error), policy)
      };
      continue;
    }

    if (descriptor === undefined || !("value" in descriptor)) {
      serialized[key] = objectTag("Accessor");
      continue;
    }

    serialized[key] = serializeValue(descriptor.value, policy, seen, depth + 1);
  }

  if (truncated > 0) {
    serialized.__devtoolsTruncated = truncatedMarker(truncated);
  }

  seen.delete(value);
  return serialized;
};

export const toDevtoolsSerializableValue = (
  value: unknown,
  policy?: DevtoolsSerializationPolicy
): DevtoolsSerializableValue =>
  serializeValue(value, normalizeSerializationPolicy(policy), new WeakSet(), 0);

const copyDetachedValue = <A>(
  value: A,
  seen: WeakMap<object, unknown> = new WeakMap()
): A => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value) as A;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as A;
  }

  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) {
      copy.set(copyDetachedValue(key, seen), copyDetachedValue(item, seen));
    }
    return copy as A;
  }

  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) {
      copy.add(copyDetachedValue(item, seen));
    }
    return copy as A;
  }

  if (value instanceof DataView) {
    return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) as A;
  }

  if (ArrayBuffer.isView(value)) {
    return (value as unknown as { slice: () => A }).slice();
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(copyDetachedValue(item, seen));
    }
    return copy as A;
  }

  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  let keys: string[];
  try {
    keys = Object.keys(record);
  } catch (error) {
    return {
      _tag: "UninspectableObject",
      name: errorName(error),
      message: errorMessage(error)
    } as A;
  }
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch (error) {
      copy[key] = {
        _tag: "UninspectableProperty",
        name: errorName(error),
        message: errorMessage(error)
      };
      continue;
    }
    copy[key] = descriptor !== undefined && "value" in descriptor
      ? copyDetachedValue(descriptor.value, seen)
      : objectTag("Accessor");
  }
  return copy as A;
};

export const describeInvalidationPlan = (
  plan: ResourceInvalidationPlan
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(describeTarget),
  entries: plan.entries.map((entry) => ({
    ref: {
      ...describeResourceRef(entry.ref)
    },
    causes: entry.causes.map(describeCause)
  }))
});

const copyInvalidationTarget = (
  target: DevtoolsInvalidationTarget
): DevtoolsInvalidationTarget =>
  target._tag === "Ref"
    ? {
        ...target,
        input: copyDetachedValue(target.input)
      }
    : { ...target };

const copyInvalidationCause = (
  cause: DevtoolsInvalidationCause
): DevtoolsInvalidationCause => ({ ...cause });

export const copyInvalidationPlan = (
  plan: DevtoolsInvalidationPlan
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(copyInvalidationTarget),
  entries: plan.entries.map((entry) => ({
    ref: {
      ...entry.ref,
      input: copyDetachedValue(entry.ref.input)
    },
    causes: entry.causes.map(copyInvalidationCause)
  }))
});

const copyTraceHeaders = (
  headers: ReadonlyArray<DevtoolsRequestTraceHeader> | undefined
): ReadonlyArray<DevtoolsRequestTraceHeader> | undefined =>
  headers === undefined
    ? undefined
    : headers.map((header) => ({ ...header })).sort((left, right) => left.name.localeCompare(right.name));

const copyTraceCookies = (
  cookies: ReadonlyArray<DevtoolsRequestTraceCookie> | undefined
): ReadonlyArray<DevtoolsRequestTraceCookie> | undefined =>
  cookies === undefined
    ? undefined
    : cookies.map((cookie) => ({ ...cookie })).sort((left, right) => left.name.localeCompare(right.name));

export const copyDevtoolsRoutePlan = (
  plan: DevtoolsRoutePlan
): DevtoolsRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match === undefined
    ? undefined
    : {
        path: plan.match.path,
        href: plan.match.href,
        params: copyDetachedValue(plan.match.params),
        search: copyDetachedValue(plan.match.search)
      },
  resources: plan.resources.map((resource) => ({
    ...resource,
    input: copyDetachedValue(resource.input)
  })),
  hydration: { ...plan.hydration }
});

const copyRequestTraceTeardown = (
  teardown: DevtoolsRequestTraceTeardown
): DevtoolsRequestTraceTeardown => ({
  runtimeDisposed: teardown.runtimeDisposed,
  ...(teardown.reason === undefined ? {} : { reason: teardown.reason }),
  ...(teardown.at === undefined ? {} : { at: teardown.at }),
  ...(teardown.startedAt === undefined ? {} : { startedAt: teardown.startedAt }),
  ...(teardown.completedAt === undefined ? {} : { completedAt: teardown.completedAt }),
  ...(teardown.durationMillis === undefined ? {} : { durationMillis: teardown.durationMillis }),
  ...(teardown.beforeDispose === undefined ? {} : { beforeDispose: { ...teardown.beforeDispose } }),
  ...(teardown.afterDispose === undefined ? {} : { afterDispose: { ...teardown.afterDispose } })
});

export const copyRequestTrace = (
  trace: DevtoolsRequestTrace
): DevtoolsRequestTrace => {
  const request: DevtoolsRequestTraceRequest = {
    method: trace.request.method,
    url: trace.request.url,
    path: trace.request.path,
    transport: trace.request.transport,
    ...(trace.request.id === undefined ? {} : { id: trace.request.id }),
    ...(trace.request.traceparent === undefined ? {} : { traceparent: trace.request.traceparent }),
    ...(trace.request.headers === undefined ? {} : { headers: copyTraceHeaders(trace.request.headers)! }),
    ...(trace.request.cookies === undefined ? {} : { cookies: copyTraceCookies(trace.request.cookies)! })
  };
  const response: DevtoolsRequestTraceResponse | undefined = trace.response === undefined
    ? undefined
    : {
        status: trace.response.status,
        ...(trace.response.statusText === undefined ? {} : { statusText: trace.response.statusText }),
        ...(trace.response.headers === undefined ? {} : { headers: copyTraceHeaders(trace.response.headers)! }),
        ...(trace.response.setCookieCount === undefined ? {} : { setCookieCount: trace.response.setCookieCount })
      };

  return {
    request,
    ...(response === undefined ? {} : { response }),
    services: [...trace.services].sort(),
    ...(trace.routePlan === undefined ? {} : { routePlan: copyDevtoolsRoutePlan(trace.routePlan) }),
    resources: trace.resources.map((resource) => ({
      ...resource,
      ...(resource.input === undefined ? {} : { input: copyDetachedValue(resource.input) })
    })),
    collections: trace.collections.map((collection) => ({ ...collection })),
    serverFunctions: trace.serverFunctions.map((serverFunction) => ({ ...serverFunction })),
    actions: trace.actions.map((action) => ({
      ...action,
      ...(action.invalidationIndexes === undefined ? {} : { invalidationIndexes: [...action.invalidationIndexes] })
    })),
    fibers: trace.fibers.map((fiber) => ({ ...fiber })),
    streams: trace.streams.map((stream) => ({ ...stream })),
    status: trace.status,
    ...(trace.failureKind === undefined ? {} : { failureKind: trace.failureKind }),
    ...(trace.teardown === undefined ? {} : { teardown: copyRequestTraceTeardown(trace.teardown) })
  };
};

const copyCollectionStoreEvent = (
  event: DevtoolsCollectionStoreEvent
): DevtoolsCollectionStoreEvent => {
  switch (event._tag) {
    case "CollectionLoadFailure":
    case "CollectionMutateRolledBack":
      return {
        ...event,
        error: copyDetachedValue(event.error)
      };
    default:
      return { ...event };
  }
};

export const copyDevtoolsRuntimeEvent = (
  event: DevtoolsRuntimeEvent
): DevtoolsRuntimeEvent => {
  switch (event._tag) {
    case "ResourceStoreEvent":
      return {
        ...event,
        event: copyDetachedValue(event.event)
      };
    case "CollectionStoreEvent":
      return {
        ...event,
        event: copyCollectionStoreEvent(event.event)
      };
    case "ActionState":
      return {
        ...event,
        ...(event.input === undefined ? {} : { input: copyDetachedValue(event.input) }),
        ...(event.invalidationIndexes === undefined ? {} : { invalidationIndexes: [...event.invalidationIndexes] })
      };
    case "Invalidation":
      return {
        ...event,
        plan: copyInvalidationPlan(event.plan)
      };
    case "RoutePlan":
      return {
        ...event,
        plan: copyDevtoolsRoutePlan(event.plan)
      };
    case "RequestTrace":
      return {
        ...event,
        trace: copyRequestTrace(event.trace)
      };
    case "Custom":
      return {
        ...event,
        ...(event.payload === undefined ? {} : { payload: copyDetachedValue(event.payload) })
      };
  }
};

export const copyAppGraphDiagnostics = (
  appGraph: DevtoolsStartAppGraphDiagnostics
): DevtoolsStartAppGraphDiagnostics =>
  copyDetachedValue(appGraph);

export const copyDevtoolsSnapshot = (
  snapshot: DevtoolsSnapshot
): DevtoolsSnapshot => ({
  ...(snapshot.appGraph === undefined ? {} : { appGraph: copyAppGraphDiagnostics(snapshot.appGraph) }),
  resources: snapshot.resources.map((resource) => ({ ...resource })),
  actions: snapshot.actions.map((action) => ({
    ...action,
    ...(action.invalidationIndexes === undefined ? {} : { invalidationIndexes: [...action.invalidationIndexes] })
  })),
  invalidations: snapshot.invalidations.map(copyInvalidationPlan),
  routePlans: snapshot.routePlans.map(copyDevtoolsRoutePlan),
  ...(snapshot.requestTraces === undefined ? {} : { requestTraces: snapshot.requestTraces.map(copyRequestTrace) }),
  ...(snapshot.events === undefined ? {} : { events: snapshot.events.map(copyDevtoolsRuntimeEvent) })
});

export const describeRoutePlan = (
  plan: Route.NavigationPlan
): DevtoolsRoutePlan => ({
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
  resources: plan.refs.map(describeResourceRef),
  hydration: {
    resourceCount: plan.resources.resources.length
  }
});
