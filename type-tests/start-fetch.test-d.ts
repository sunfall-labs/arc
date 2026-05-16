import {
  createFetchHandler,
  toFetchHandler,
  toFetchHandlerEffect,
  type StartFetchHandler,
  type StartFetchHandlerEffect,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions
} from "@effect-ui/start-fetch";
import type { EffectUiRuntime } from "@effect-ui/core";
import type { StartRequestHandlerEffect } from "@effect-ui/start";
import { Scope } from "effect";

const fetchPackageExports: Array<unknown> = [createFetchHandler, toFetchHandler, toFetchHandlerEffect];
type FetchPackage =
  | StartFetchHandler
  | StartFetchHandlerEffect
  | StartFetchPromiseHandler
  | StartFetchPromiseHandlerOptions
  | StartFetchPromiseHandlerRuntimeOptions<Scope.Scope>;
void fetchPackageExports;
type _FetchPackage = FetchPackage;

interface FetchAdapterTestService {
  readonly fetchAdapterTestService: unique symbol;
}

declare const scopeOnlyHandler: StartRequestHandlerEffect<Scope.Scope>;
declare const servicefulHandler: StartRequestHandlerEffect<Scope.Scope | FetchAdapterTestService>;
declare const serviceRuntime: EffectUiRuntime<FetchAdapterTestService>;

const fetchHandlerEffect: StartFetchHandlerEffect<Scope.Scope> = toFetchHandlerEffect(scopeOnlyHandler);
const fetchHandler: StartFetchHandler<Scope.Scope> = toFetchHandler(scopeOnlyHandler);
const fetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(scopeOnlyHandler);
const fetchPromiseOptions: StartFetchPromiseHandlerOptions = {};
const fetchRuntimeOptions: StartFetchPromiseHandlerRuntimeOptions<Scope.Scope | FetchAdapterTestService> = {
  runtime: serviceRuntime
};
const servicefulFetchPromiseHandler: StartFetchPromiseHandler = createFetchHandler(
  servicefulHandler,
  fetchRuntimeOptions
);
// @ts-expect-error serviceful Fetch Promise facades must receive a runtime for non-Scope requirements.
createFetchHandler(servicefulHandler, fetchPromiseOptions);
void fetchHandlerEffect;
void fetchHandler;
void fetchPromiseHandler;
void servicefulFetchPromiseHandler;
