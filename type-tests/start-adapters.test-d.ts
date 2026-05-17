import {
  createFetchHandler,
  createNodeHandlerEffect,
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  StartNodeAdapterError,
  StartRequestHandlerError,
  toFetchHandlerEffect,
  writeNodeResponseEffect,
  type StartFetchHandlerEffect,
  type StartFetchHandler,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions,
  type StartNodeHandler,
  type StartNodeHandlerEffect,
  type StartNodeServerHandler,
  type StartNodeServerHandlerOptions,
  type StartNodeServerHandlerRuntimeOptions,
} from "@sunfall/arc-start/adapters";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import type { StartRequestHandlerEffect } from "@sunfall/arc-start";
import { Scope } from "effect";

const startAdapterExports: Array<unknown> = [
  createFetchHandler,
  createNodeHandlerEffect,
  createNodeHandler,
  createNodeServerHandler,
  nodeRequestToWebRequestEffect,
  StartNodeAdapterError,
  StartRequestHandlerError,
  toFetchHandlerEffect,
  writeNodeResponseEffect,
];
type AdapterHandlers =
  | StartFetchHandlerEffect
  | StartFetchHandler
  | StartFetchPromiseHandler
  | StartFetchPromiseHandlerOptions
  | StartFetchPromiseHandlerRuntimeOptions<Scope.Scope>
  | StartNodeHandler
  | StartNodeHandlerEffect
  | StartNodeServerHandler
  | StartNodeServerHandlerOptions
  | StartNodeServerHandlerRuntimeOptions<Scope.Scope>;
void startAdapterExports;
type _AdapterHandlers = AdapterHandlers;

interface RootFetchAdapterTestService {
  readonly rootFetchAdapterTestService: unique symbol;
}

declare const scopeOnlyHandler: StartRequestHandlerEffect<Scope.Scope>;
declare const servicefulHandler: StartRequestHandlerEffect<
  Scope.Scope | RootFetchAdapterTestService
>;
declare const serviceRuntime: SunfallArcRuntime<RootFetchAdapterTestService>;

const rootFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(scopeOnlyHandler);
const rootFetchEffectHandler: StartFetchHandlerEffect<Scope.Scope> =
  toFetchHandlerEffect(scopeOnlyHandler);
const rootFetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
const rootFetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<
  Scope.Scope | RootFetchAdapterTestService
> = {
  runtime: serviceRuntime,
};
const rootServicefulFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(
  servicefulHandler,
  rootFetchRuntimeOptions,
);
const servicefulFetchEffectHandler: StartFetchHandlerEffect<
  Scope.Scope | RootFetchAdapterTestService
> = toFetchHandlerEffect(servicefulHandler);
const rootNodeEffectHandler: StartNodeHandlerEffect<Scope.Scope> =
  createNodeHandlerEffect(scopeOnlyHandler);
const servicefulNodeEffectHandler: StartNodeHandlerEffect<
  Scope.Scope | RootFetchAdapterTestService
> = createNodeHandlerEffect(servicefulHandler);
const rootNodeServerHandler: StartNodeServerHandler = createNodeServerHandler(scopeOnlyHandler);
const servicefulNodeServerHandler: StartNodeServerHandler = createNodeServerHandler(
  servicefulHandler,
  {
    runtime: serviceRuntime,
  },
);
// @ts-expect-error serviceful Fetch Promise facades must receive a runtime for non-Scope requirements.
createFetchHandler(servicefulHandler, rootFetchPromiseOptions);
// @ts-expect-error serviceful Node callback facades must receive a runtime for non-Scope requirements.
createNodeServerHandler(servicefulHandler, {});
void rootFetchPromiseHandler;
void rootFetchEffectHandler;
void rootServicefulFetchPromiseHandler;
void servicefulFetchEffectHandler;
void rootNodeEffectHandler;
void servicefulNodeEffectHandler;
void rootNodeServerHandler;
void servicefulNodeServerHandler;
