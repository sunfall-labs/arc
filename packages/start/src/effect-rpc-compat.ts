import type { ServerFunction } from "@effect-ui/core";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  startJsonMediaType,
  startRequestIdHeader,
  startTransportKindHeader,
  startTransportProtocolHeader,
  startTransportProtocolVersion
} from "./rpc.js";
import type { ServerFunctionManifest } from "./server-function-manifest.js";

export interface StartEffectRpcEndpointDescriptor {
  readonly method: "POST";
  readonly path: string;
  readonly requestMediaType: typeof startJsonMediaType;
  readonly responseMediaType: typeof startJsonMediaType;
  readonly protocolVersion: typeof startTransportProtocolVersion;
  readonly headers: {
    readonly requestId: typeof startRequestIdHeader;
    readonly transportKind: typeof startTransportKindHeader;
    readonly protocolVersion: typeof startTransportProtocolHeader;
  };
}

export interface StartEffectRpcProcedureDescriptor {
  readonly id: string;
  readonly tag: string;
  readonly module: string;
  readonly exportName: string;
  readonly hasHandler: boolean;
  readonly clientReference: "rpc" | "import";
  readonly schemas: {
    readonly payload: boolean;
    readonly success: boolean;
    readonly error: boolean;
  };
}

export interface StartEffectRpcCompatibilityArtifact {
  readonly version: 1;
  readonly primitive: "effect/unstable/rpc";
  readonly endpoint: StartEffectRpcEndpointDescriptor;
  readonly procedures: readonly StartEffectRpcProcedureDescriptor[];
  readonly adoption: {
    readonly supported: readonly string[];
    readonly blocked: readonly string[];
  };
}

const schemaOrUnknown = (schema: unknown): Schema.Top =>
  Schema.isSchema(schema) ? schema : Schema.Unknown;

/**
 * Creates an Effect unstable Rpc descriptor for one Effect UI server function.
 *
 * This is intentionally descriptor-only: Start keeps its current transport while
 * the unstable Rpc server/client APIs settle. Untyped contracts map to
 * Schema.Unknown so the descriptor preserves today's permissive wire behavior.
 */
export const serverFunctionToEffectRpc = (
  fn: ServerFunction<unknown, unknown, unknown, unknown>
): Rpc.AnyWithProps =>
  Rpc.make(fn.name, {
    payload: schemaOrUnknown(fn.input),
    success: schemaOrUnknown(fn.output),
    error: schemaOrUnknown(fn.error)
  });

/**
 * Groups server function descriptors with Effect unstable RpcGroup.
 *
 * Use this as a migration probe or generated metadata source; it does not alter
 * Start's fetch-based RPC endpoint.
 */
export const makeStartEffectRpcGroup = (
  functions: Iterable<ServerFunction<unknown, unknown, unknown, unknown>>
): RpcGroup.RpcGroup<Rpc.AnyWithProps> =>
  RpcGroup.make(...Array.from(functions, serverFunctionToEffectRpc));

export const startEffectRpcEndpointDescriptor = (
  manifest: ServerFunctionManifest
): StartEffectRpcEndpointDescriptor => ({
  method: "POST",
  path: manifest.rpcPath,
  requestMediaType: startJsonMediaType,
  responseMediaType: startJsonMediaType,
  protocolVersion: startTransportProtocolVersion,
  headers: {
    requestId: startRequestIdHeader,
    transportKind: startTransportKindHeader,
    protocolVersion: startTransportProtocolHeader
  }
});

/**
 * Emits a deterministic compatibility artifact from the generated manifest.
 *
 * The artifact records the current Start RPC shape in Effect Rpc terms without
 * pretending we can reconstruct schema objects from production manifests.
 */
export const makeStartEffectRpcCompatibilityArtifact = (
  manifest: ServerFunctionManifest
): StartEffectRpcCompatibilityArtifact => ({
  version: 1,
  primitive: "effect/unstable/rpc",
  endpoint: startEffectRpcEndpointDescriptor(manifest),
  procedures: manifest.entries.map((entry) => ({
    id: entry.id,
    tag: entry.name,
    module: entry.server.module,
    exportName: entry.server.exportName,
    hasHandler: entry.server.hasHandler,
    clientReference: entry.client._tag === "Rpc" ? "rpc" : "import",
    schemas: {
      payload: entry.wire.inputSchema,
      success: entry.wire.outputSchema,
      error: entry.wire.errorSchema
    }
  })),
  adoption: {
    supported: [
      "Server function names map directly to Effect Rpc tags.",
      "Live Server.fn contracts can produce Rpc descriptors and an RpcGroup.",
      "The Start endpoint already matches a single POST JSON RPC boundary."
    ],
    blocked: [
      "Production manifests only contain schema presence booleans, not schema values.",
      "Start RPC response tags do not match Effect RpcSerialization envelopes.",
      "Effect RpcServer/Http protocols are unstable, so serving traffic remains on the existing transport."
    ]
  }
});
