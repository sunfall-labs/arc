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

/**
 * Descriptor for Start's current JSON RPC endpoint expressed in Effect RPC terms.
 *
 * This is metadata only. It lets diagnostics and generators see the method,
 * path, media type, protocol version, and header contract without replacing
 * Start's existing request handler with `effect/unstable/rpc` server runtime.
 */
export interface StartEffectRpcEndpointDescriptor {
  /** Start server functions are dispatched through one JSON POST boundary. */
  readonly method: "POST";
  /** Resolved RPC endpoint path from the server-function manifest. */
  readonly path: string;
  /** Request body media type accepted by the Start transport. */
  readonly requestMediaType: typeof startJsonMediaType;
  /** Response body media type emitted by the Start transport. */
  readonly responseMediaType: typeof startJsonMediaType;
  /** Start transport protocol version carried in diagnostics and response headers. */
  readonly protocolVersion: typeof startTransportProtocolVersion;
  /** Header names used by the Start RPC transport envelope. */
  readonly headers: {
    /** Per-request id header used for request traces and diagnostics. */
    readonly requestId: typeof startRequestIdHeader;
    /** Header that identifies the transport as RPC rather than action/form traffic. */
    readonly transportKind: typeof startTransportKindHeader;
    /** Header that carries the Start transport protocol version. */
    readonly protocolVersion: typeof startTransportProtocolHeader;
  };
}

/** One server-function procedure as projected into the Effect RPC compatibility artifact. */
export interface StartEffectRpcProcedureDescriptor {
  /** Stable manifest id for the server-function entry. */
  readonly id: string;
  /** Effect RPC tag, currently the public server-function name. */
  readonly tag: string;
  /** Server module that owns the implementation export. */
  readonly module: string;
  /** Named server export that handles this procedure. */
  readonly exportName: string;
  /** Whether the manifest found a concrete server handler. */
  readonly hasHandler: boolean;
  /** Whether the generated client calls the RPC endpoint or imports directly. */
  readonly clientReference: "rpc" | "import";
  /** Schema-presence facts retained by production manifests. */
  readonly schemas: {
    /** True when the payload/input schema was present at manifest build time. */
    readonly payload: boolean;
    /** True when the success/output schema was present at manifest build time. */
    readonly success: boolean;
    /** True when the typed error schema was present at manifest build time. */
    readonly error: boolean;
  };
}

/** Deterministic compatibility artifact for generators and diagnostics. */
export interface StartEffectRpcCompatibilityArtifact {
  /** Artifact schema version. */
  readonly version: 1;
  /** Effect primitive being described by this compatibility artifact. */
  readonly primitive: "effect/unstable/rpc";
  /** Endpoint metadata shared by every procedure. */
  readonly endpoint: StartEffectRpcEndpointDescriptor;
  /** Procedures projected from the server-function manifest. */
  readonly procedures: readonly StartEffectRpcProcedureDescriptor[];
  /** Current migration support and known blockers. */
  readonly adoption: {
    /** Compatibility facts that are safe today. */
    readonly supported: readonly string[];
    /** Gaps that prevent replacing Start transport with Effect RPC outright. */
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
  fn: ServerFunction<any, any, any, any>
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
  functions: Iterable<ServerFunction<any, any, any, any>>
): RpcGroup.RpcGroup<Rpc.AnyWithProps> =>
  RpcGroup.make(...Array.from(functions, serverFunctionToEffectRpc));

/**
 * Builds endpoint metadata for Start's Effect RPC compatibility artifact.
 *
 * Use this when tooling needs the endpoint contract without also materializing
 * every server-function procedure.
 */
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
