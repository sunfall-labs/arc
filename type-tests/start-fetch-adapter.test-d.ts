import {
  createFetchHandler,
  StartRequestHandlerError,
  toFetchHandler,
  toFetchHandlerEffect,
  type StartFetchHandler,
  type StartFetchHandlerEffect,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions,
} from "@sunfall/arc-start/fetch-adapter";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import type { StartRequestHandlerEffect } from "@sunfall/arc-start";
import { Scope } from "effect";

const fetchAdapterExports: Array<unknown> = [
  createFetchHandler,
  StartRequestHandlerError,
  toFetchHandler,
  toFetchHandlerEffect,
];
type FetchAdapter =
  | StartFetchHandler
  | StartFetchHandlerEffect
  | StartFetchPromiseHandler
  | StartFetchPromiseHandlerOptions
  | StartFetchPromiseHandlerRuntimeOptions<Scope.Scope>;
void fetchAdapterExports;
type _FetchAdapter = FetchAdapter;

interface FetchAdapterTestService {
  readonly fetchAdapterTestService: unique symbol;
}

declare const scopeOnlyHandler: StartRequestHandlerEffect<Scope.Scope>;
declare const servicefulHandler: StartRequestHandlerEffect<Scope.Scope | FetchAdapterTestService>;
declare const serviceRuntime: SunfallArcRuntime<FetchAdapterTestService>;

const fetchHandlerEffect: StartFetchHandlerEffect<Scope.Scope> =
  toFetchHandlerEffect(scopeOnlyHandler);
const fetchHandler: StartFetchHandler<Scope.Scope> = toFetchHandler(scopeOnlyHandler);
const fetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(scopeOnlyHandler);
const fetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
const fetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<
  Scope.Scope | FetchAdapterTestService
> = {
  runtime: serviceRuntime,
};
const servicefulFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(
  servicefulHandler,
  fetchRuntimeOptions,
);
// @ts-expect-error serviceful Fetch Promise facades must receive a runtime for non-Scope requirements.
createFetchHandler(servicefulHandler, fetchPromiseOptions);
void fetchHandlerEffect;
void fetchHandler;
void fetchPromiseHandler;
void servicefulFetchPromiseHandler;
