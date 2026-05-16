import {
  createFetchHandler,
  createNodeHandler,
  nodeRequestToWebRequestEffect,
  toFetchHandlerEffect,
  writeNodeResponseEffect,
  type StartFetchHandler,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions,
  type StartNodeHandler
} from "@effect-ui/start/adapters";
import type { EffectUiRuntime } from "@effect-ui/core";
import type { StartRequestHandlerEffect } from "@effect-ui/start";
import { Scope } from "effect";

const startAdapterExports: Array<unknown> = [
  createFetchHandler,
  createNodeHandler,
  nodeRequestToWebRequestEffect,
  toFetchHandlerEffect,
  writeNodeResponseEffect
];
type AdapterHandlers =
  | StartFetchHandler
  | StartFetchPromiseHandler
  | StartFetchPromiseHandlerOptions
  | StartFetchPromiseHandlerRuntimeOptions<Scope.Scope>
  | StartNodeHandler;
void startAdapterExports;
type _AdapterHandlers = AdapterHandlers;

interface RootFetchAdapterTestService {
  readonly rootFetchAdapterTestService: unique symbol;
}

declare const scopeOnlyHandler: StartRequestHandlerEffect<Scope.Scope>;
declare const servicefulHandler: StartRequestHandlerEffect<Scope.Scope | RootFetchAdapterTestService>;
declare const serviceRuntime: EffectUiRuntime<RootFetchAdapterTestService>;

const rootFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(scopeOnlyHandler);
const rootFetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
const rootFetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<
  Scope.Scope | RootFetchAdapterTestService
> = {
  runtime: serviceRuntime
};
const rootServicefulFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(
  servicefulHandler,
  rootFetchRuntimeOptions
);
// @ts-expect-error serviceful Fetch Promise facades must receive a runtime for non-Scope requirements.
createFetchHandler(servicefulHandler, rootFetchPromiseOptions);
void rootFetchPromiseHandler;
void rootServicefulFetchPromiseHandler;
