import {
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  preloadRequestEffect,
  submitStartActionEffect,
  type StartFetch,
  type StartRequestHandler,
  type StartRequestTrace
} from "@effect-ui/start";

const startExports: Array<unknown> = [
  createRequestHandler,
  createStartStreamedHtmlResponseEffect,
  preloadRequestEffect,
  submitStartActionEffect
];
type StartTypes = StartFetch | StartRequestHandler | StartRequestTrace;
void startExports;
type _StartTypes = StartTypes;
