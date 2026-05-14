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
  DevtoolsSerializableValue
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

export const toDevtoolsSerializableValue = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): DevtoolsSerializableValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
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

  if (seen.has(value)) {
    return objectTag("Circular");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const serialized = value.map((item) => toDevtoolsSerializableValue(item, seen));
    seen.delete(value);
    return serialized;
  }

  const record = value as Record<string, unknown>;
  const serialized = Object.keys(record)
    .sort()
    .reduce<Record<string, DevtoolsSerializableValue>>((acc, key) => {
      acc[key] = toDevtoolsSerializableValue(record[key], seen);
      return acc;
    }, {});
  seen.delete(value);
  return serialized;
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
): DevtoolsInvalidationTarget => ({ ...target });

const copyInvalidationCause = (
  cause: DevtoolsInvalidationCause
): DevtoolsInvalidationCause => ({ ...cause });

export const copyInvalidationPlan = (
  plan: DevtoolsInvalidationPlan
): DevtoolsInvalidationPlan => ({
  targets: plan.targets.map(copyInvalidationTarget),
  entries: plan.entries.map((entry) => ({
    ref: { ...entry.ref },
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

const copyRoutePlan = (
  plan: DevtoolsRoutePlan
): DevtoolsRoutePlan => ({
  _tag: plan._tag,
  href: plan.href,
  match: plan.match === undefined
    ? undefined
    : {
        path: plan.match.path,
        href: plan.match.href,
        params: plan.match.params,
        search: plan.match.search
      },
  resources: plan.resources.map((resource) => ({ ...resource })),
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
    ...(trace.routePlan === undefined ? {} : { routePlan: copyRoutePlan(trace.routePlan) }),
    resources: trace.resources.map((resource) => ({ ...resource })),
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
