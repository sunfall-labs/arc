import {
  createFetchHandler,
  toFetchHandler,
  type StartFetchHandler,
  type StartFetchPromiseHandler,
  type StartFetchPromiseHandlerOptions,
  type StartFetchPromiseHandlerRuntimeOptions,
} from "@sunfall/arc-start/fetch";
import type { SunfallArcRuntime } from "@sunfall/arc-core";
import type { StartRequestHandler } from "@sunfall/arc-start";
import { Scope } from "effect";

const fetchAdapterExports: Array<unknown> = [createFetchHandler, toFetchHandler];
type FetchAdapter =
  | StartFetchHandler
  | StartFetchPromiseHandler
  | StartFetchPromiseHandlerOptions
  | StartFetchPromiseHandlerRuntimeOptions<Scope.Scope>;
void fetchAdapterExports;
type _FetchAdapter = FetchAdapter;

interface FetchAdapterTestService {
  readonly fetchAdapterTestService: unique symbol;
}

declare const scopeOnlyHandler: StartRequestHandler<Scope.Scope>;
declare const servicefulHandler: StartRequestHandler<Scope.Scope | FetchAdapterTestService>;
declare const serviceRuntime: SunfallArcRuntime<FetchAdapterTestService>;

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
// @ts-expect-error effect-first fetch adapters cannot hide requirements through partial generics
const hiddenFetchHandler: StartFetchHandler = toFetchHandler(servicefulHandler);
void fetchHandler;
void fetchPromiseHandler;
void servicefulFetchPromiseHandler;
void hiddenFetchHandler;
