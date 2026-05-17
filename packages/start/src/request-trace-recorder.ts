import type { EffectUiRuntime, Route } from "@effect-ui/core";
import {
  traceCollectionPreload,
  traceRoutePlan,
  type StartCollectionPreloadTraceInput,
  type StartRequestTraceAction,
  type StartRequestTraceFacts,
  type StartRequestTraceFailureKind,
  type StartRequestTraceServerFunction,
} from "./request-trace.js";

export const recordStartRequestTraceFailure = (
  facts: StartRequestTraceFacts | undefined,
  failureKind: StartRequestTraceFailureKind,
): void => {
  if (facts) {
    facts.failureKind = failureKind;
  }
};

export const recordStartRequestTraceServerFunction = (
  facts: StartRequestTraceFacts | undefined,
  entry: StartRequestTraceServerFunction,
): void => {
  if (!facts) {
    return;
  }
  if (entry.failureKind !== undefined) {
    facts.failureKind = entry.failureKind;
  }
  facts.serverFunctions.push(entry);
};

export const recordStartRequestTraceAction = (
  facts: StartRequestTraceFacts | undefined,
  entry: StartRequestTraceAction,
): void => {
  if (!facts) {
    return;
  }
  if (entry.failureKind !== undefined) {
    facts.failureKind = entry.failureKind;
  }
  facts.actions.push(entry);
};

export const recordStartRequestTracePreload = <RuntimeServices, RuntimeError>(
  facts: StartRequestTraceFacts,
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError>,
  routePlan: Route.NavigationPlan,
  collectionPreload: StartCollectionPreloadTraceInput,
): void => {
  facts.routePlan = traceRoutePlan(routePlan);
  facts.collections = [...traceCollectionPreload(runtime, collectionPreload)];
};
