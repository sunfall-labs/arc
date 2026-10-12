import type { Resource, Route } from "@sunfall/arc-core";
import { Effect } from "effect";
import type { StartPostedAction } from "./start-action-form-post.js";
import {
  createHydrationScriptSync,
  createHydrationScript,
  createStartHydrationPayload,
  type StartHydrationPayload,
  type StartHydrationPayloadSerializeError,
} from "./hydration.js";

/**
 * Root payload/script plus resource chunks prepared for streamed SSR hydration.
 *
 * `root.script` is the safe root script for streamed renderers. Route resource
 * payloads are excluded from it and appear only in `streamedResourceChunks`.
 */
export interface StartRenderHydrationPlan {
  readonly root: {
    readonly payload: StartHydrationPayload;
    readonly script: string;
  };
  readonly legacy: {
    readonly payload: StartHydrationPayload;
    readonly script: string;
  };
  readonly streamedResourceChunks: readonly StartHydrationPayload[];
}

/** Inputs for building the root-plus-streamed SSR hydration plan. */
export interface CreateStartRenderHydrationPlanOptions {
  /** Resource hydration payload collected during request preload/render. */
  readonly resources: Resource.HydrationPayload;
  /** Route preload failure the request renders; carried by the root payload. */
  readonly routeFailure?: Route.PreloadFailureSnapshot;
  /** No route matched, so the request renders the not-found state; carried by the root payload. */
  readonly notFound?: boolean;
  /** Pending durable submissions the server settled before rendering; carried by the root payload. */
  readonly settledSubmissions?: ReadonlyArray<string>;
  /** The no-JavaScript form post the page renders again; carried by the root payload. */
  readonly postedAction?: StartPostedAction;
}

const emptyResourceHydrationPayload: Resource.HydrationPayload = { resources: [] };

/**
 * Builds the hydration plan used by streamed renderers.
 *
 * The root payload carries non-streamed state: the route failure or not-found
 * outcome and settled durable submissions.
 * Route resource refs move into streamed chunks so a renderer cannot emit the
 * same resource pair in both the root script and the stream.
 */
export const createStartRenderHydrationPlan = (
  options: CreateStartRenderHydrationPlanOptions,
): Effect.Effect<StartRenderHydrationPlan, StartHydrationPayloadSerializeError> =>
  Effect.gen(function* () {
    const settled = {
      ...(options.settledSubmissions === undefined || options.settledSubmissions.length === 0
        ? {}
        : { settledSubmissions: options.settledSubmissions }),
      ...(options.postedAction === undefined ? {} : { postedAction: options.postedAction }),
    };
    const rootPayload: StartHydrationPayload = {
      ...createStartHydrationPayload(emptyResourceHydrationPayload, options),
      ...settled,
    };
    const rootScript = yield* createHydrationScript(rootPayload);
    const legacyPayload: StartHydrationPayload = {
      ...createStartHydrationPayload(options.resources, options),
      ...settled,
    };
    const streamedResourceChunks =
      options.resources.resources.length === 0
        ? []
        : [createStartHydrationPayload(options.resources)];
    let legacyScript: string | undefined;

    return {
      root: {
        payload: rootPayload,
        script: rootScript,
      },
      legacy: {
        payload: legacyPayload,
        get script() {
          legacyScript ??= createHydrationScriptSync(legacyPayload);
          return legacyScript;
        },
      },
      streamedResourceChunks,
    };
  });
