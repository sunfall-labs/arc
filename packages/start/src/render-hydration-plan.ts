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
 * Root payload/script plus the Resource hydration chunks for one SSR render.
 *
 * `root.script` is the root script for renderers that emit Resource chunks
 * separately (the default document does). Route Resource payloads are
 * excluded from it and appear only in `resourceChunks`. `legacy` carries
 * everything in one payload for renderers that emit a single script.
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
  readonly resourceChunks: readonly StartHydrationPayload[];
}

/** Inputs for building the root-plus-chunks SSR hydration plan. */
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
 * Builds the hydration plan for one SSR render.
 *
 * The root payload carries the request's outcome: the route failure or
 * not-found verdict, settled durable submissions, and a posted form.
 * Route Resource refs move into separate chunks so a renderer cannot emit
 * the same Resource pair in both the root script and a chunk.
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
    const resourceChunks =
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
      resourceChunks,
    };
  });
