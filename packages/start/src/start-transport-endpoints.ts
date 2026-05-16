import { Data, Effect } from "effect";
import {
  serverActionPath,
  serverRpcPath
} from "./rpc.js";

/** Reasons a Start transport endpoint path can be rejected. */
export type StartEndpointPathInvalidReason =
  | "NotString"
  | "Empty"
  | "ContainsNewline"
  | "FullUrl"
  | "NotOriginForm";

export interface StartEndpointPathErrorInput {
  readonly field: string;
  readonly value: unknown;
  readonly reason: StartEndpointPathInvalidReason;
  readonly guidance: string;
}

export interface StartEndpointConflictErrorInput {
  readonly rpcPath: string;
  readonly actionPath: string;
  readonly guidance: string;
}

export const startEndpointPathGuidance =
  "Use an origin-form endpoint path such as `/__effect-ui/rpc`; full URLs, empty paths, and CR/LF characters are not allowed.";

export const startEndpointConflictGuidance =
  "Use distinct origin-form endpoint paths for RPC and action transports, such as `/__effect-ui/rpc` and `/__effect-ui/action`.";

const urlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export const startEndpointPathInvalidReason = (
  value: unknown
): StartEndpointPathInvalidReason | undefined => {
  if (typeof value !== "string") {
    return "NotString";
  }

  if (/[\r\n]/.test(value)) {
    return "ContainsNewline";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Empty";
  }

  if (urlSchemePattern.test(trimmed) || trimmed.startsWith("//")) {
    return "FullUrl";
  }

  return trimmed.startsWith("/") ? undefined : "NotOriginForm";
};

export const normalizeStartEndpointPath = (value: unknown): string | undefined => {
  const reason = startEndpointPathInvalidReason(value);
  return reason === undefined && typeof value === "string" ? value.trim() : undefined;
};

export const validateStartEndpointPathEffect = <Error>(
  value: unknown,
  options: {
    readonly field: string;
    readonly invalidPath: (input: StartEndpointPathErrorInput) => Error;
  }
): Effect.Effect<string, Error> => {
  const normalized = normalizeStartEndpointPath(value);
  if (normalized !== undefined) {
    return Effect.succeed(normalized);
  }

  return Effect.fail(
    options.invalidPath({
      field: options.field,
      value,
      reason: startEndpointPathInvalidReason(value) ?? "NotOriginForm",
      guidance: startEndpointPathGuidance
    })
  );
};

export class StartTransportEndpointPathError extends Data.TaggedError(
  "StartTransportEndpointPathError"
)<StartEndpointPathErrorInput> {}

export class StartTransportEndpointConflictError extends Data.TaggedError(
  "StartTransportEndpointConflictError"
)<StartEndpointConflictErrorInput> {}

/** Runtime endpoint paths used by Start RPC and action transports. */
export interface StartTransportEndpoints {
  /** Origin-form path for Start server-function RPC requests. */
  readonly rpcPath: string;
  /** Origin-form path for Start action requests. */
  readonly actionPath: string;
}

/** Partial endpoint override accepted by Start handler and client options. */
export type StartTransportEndpointOverrides = Partial<StartTransportEndpoints>;

/** Server-function manifest fields needed for endpoint resolution. */
export interface StartServerFunctionEndpointManifest {
  readonly rpcPath?: string;
}

/** Action manifest fields needed for endpoint resolution. */
export interface StartActionEndpointManifest {
  readonly actionPath?: string;
}

/** Manifest-shaped source for resolving Start transport endpoint paths. */
export interface StartTransportEndpointManifestSource {
  readonly serverFunctions?: StartServerFunctionEndpointManifest;
  readonly actions?: StartActionEndpointManifest;
}

/** Option-shaped source for resolving Start transport endpoint paths. */
export interface StartTransportEndpointSource {
  readonly rpcPath?: string;
  readonly actionPath?: string;
  readonly endpoints?: StartTransportEndpointOverrides;
  readonly serverFunctionManifest?: StartServerFunctionEndpointManifest;
  readonly actionManifest?: StartActionEndpointManifest;
  readonly appGraph?: StartTransportEndpointManifestSource;
}

/** Source accepted by RPC client helpers. */
export interface StartRpcEndpointSource extends StartTransportEndpointSource {
  readonly endpoint?: string | URL;
  readonly manifest?: {
    readonly rpcPath?: string;
  };
}

/** Source accepted by action client and form helpers. */
export interface StartActionEndpointSource extends StartTransportEndpointSource {
  readonly endpoint?: string | URL;
  readonly action?: string;
  readonly manifest?: {
    readonly actionPath?: string;
  };
}

/** Default Start transport paths. Constants should stay at this default seam. */
export const defaultStartTransportEndpoints: StartTransportEndpoints = {
  rpcPath: serverRpcPath,
  actionPath: serverActionPath
};

const startTransportEndpointPathError = (
  input: StartEndpointPathErrorInput
): StartTransportEndpointPathError =>
  new StartTransportEndpointPathError(input);

const endpointPath = (
  value: string | undefined,
  field: keyof StartTransportEndpoints
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = normalizeStartEndpointPath(value);
  if (normalized !== undefined) {
    return normalized;
  }

  throw startTransportEndpointPathError({
    field,
    value,
    reason: startEndpointPathInvalidReason(value) ?? "NotOriginForm",
    guidance: startEndpointPathGuidance
  });
};

const adapterTarget = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
};

const validateStartTransportEndpointConflict = (
  endpoints: StartTransportEndpoints
): StartTransportEndpoints => {
  if (endpoints.rpcPath !== endpoints.actionPath) {
    return endpoints;
  }

  throw new StartTransportEndpointConflictError({
    rpcPath: endpoints.rpcPath,
    actionPath: endpoints.actionPath,
    guidance: startEndpointConflictGuidance
  });
};

/** Resolves Start transport endpoint paths from explicit options, manifests, or defaults. */
export const resolveStartTransportEndpoints = (
  source: StartTransportEndpointSource = {}
): StartTransportEndpoints =>
  validateStartTransportEndpointConflict({
    rpcPath:
      endpointPath(source.endpoints?.rpcPath, "rpcPath") ??
      endpointPath(source.rpcPath, "rpcPath") ??
      endpointPath(source.serverFunctionManifest?.rpcPath, "rpcPath") ??
      endpointPath(source.appGraph?.serverFunctions?.rpcPath, "rpcPath") ??
      defaultStartTransportEndpoints.rpcPath,
    actionPath:
      endpointPath(source.endpoints?.actionPath, "actionPath") ??
      endpointPath(source.actionPath, "actionPath") ??
      endpointPath(source.actionManifest?.actionPath, "actionPath") ??
      endpointPath(source.appGraph?.actions?.actionPath, "actionPath") ??
      defaultStartTransportEndpoints.actionPath
  });

export const resolveStartTransportEndpointsEffect = (
  source: StartTransportEndpointSource = {}
): Effect.Effect<
  StartTransportEndpoints,
  StartTransportEndpointPathError | StartTransportEndpointConflictError
> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(resolveStartTransportEndpoints(source));
    } catch (error) {
      if (
        error instanceof StartTransportEndpointPathError ||
        error instanceof StartTransportEndpointConflictError
      ) {
        return Effect.fail(error);
      }
      throw error;
    }
  });

/** Resolves the RPC endpoint used by Start server-function clients. */
export const resolveStartRpcEndpoint = (
  source: StartRpcEndpointSource = {}
): string | URL =>
  source.endpoint ??
  endpointPath(source.manifest?.rpcPath, "rpcPath") ??
  resolveStartTransportEndpoints(source).rpcPath;

/** Resolves the action endpoint used by Start action clients and progressive forms. */
export const resolveStartActionEndpoint = (
  source: StartActionEndpointSource = {}
): string | URL =>
  source.endpoint ??
  adapterTarget(source.action) ??
  endpointPath(source.manifest?.actionPath, "actionPath") ??
  resolveStartTransportEndpoints(source).actionPath;

/** True when a request targets the configured Start server-function RPC endpoint. */
export const isStartRpcEndpointRequest = (
  request: Request,
  source: StartTransportEndpointSource = {}
): boolean =>
  new URL(request.url).pathname === resolveStartTransportEndpoints(source).rpcPath;

/** True when a request targets the configured Start action endpoint. */
export const isStartActionEndpointRequest = (
  request: Request,
  source: StartTransportEndpointSource = {}
): boolean =>
  new URL(request.url).pathname === resolveStartTransportEndpoints(source).actionPath;
