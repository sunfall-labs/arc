import {
  createFetchHandler,
  toFetchHandler,
  toFetchHandlerEffect,
  type StartFetchHandler,
  type StartFetchPromiseHandlerOptions
} from "@effect-ui/start-fetch";

const fetchPackageExports: Array<unknown> = [createFetchHandler, toFetchHandler, toFetchHandlerEffect];
type FetchPackage = StartFetchHandler | StartFetchPromiseHandlerOptions;
void fetchPackageExports;
type _FetchPackage = FetchPackage;
