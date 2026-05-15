import {
  createFetchHandler,
  toFetchHandler,
  toFetchHandlerEffect,
  type StartFetchHandler,
  type StartFetchPromiseHandlerOptions
} from "@effect-ui/start/fetch-adapter";

const fetchAdapterExports: Array<unknown> = [createFetchHandler, toFetchHandler, toFetchHandlerEffect];
type FetchAdapter = StartFetchHandler | StartFetchPromiseHandlerOptions;
void fetchAdapterExports;
type _FetchAdapter = FetchAdapter;
