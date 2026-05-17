import type { ResourceHydrationPayload } from "@effect-ui/core";
import type { CollectionHydrationPayload } from "@effect-ui/db";
import { Effect } from "effect";
import {
  createHydrationScript,
  createHydrationScriptEffect,
  createStartHydrationPayload,
  type StartHydrationPayload,
  type StartHydrationPayloadSerializeError
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
  readonly resources: ResourceHydrationPayload;
  /** Collection hydration payload captured for the request runtime. */
  readonly collections: CollectionHydrationPayload;
}

const emptyResourceHydrationPayload: ResourceHydrationPayload = { resources: [] };

/**
 * Builds the hydration plan used by streamed renderers.
 *
 * The root payload carries non-streamed state such as DB collection snapshots.
 * Route resource refs move into streamed chunks so a renderer cannot emit the
 * same resource pair in both the root script and the stream.
 */
export const createStartRenderHydrationPlanEffect = (
  options: CreateStartRenderHydrationPlanOptions
): Effect.Effect<StartRenderHydrationPlan, StartHydrationPayloadSerializeError> =>
  Effect.gen(function* () {
    const rootPayload = createStartHydrationPayload(
      emptyResourceHydrationPayload,
      options.collections
    );
    const rootScript = yield* createHydrationScriptEffect(rootPayload);
    const legacyPayload = createStartHydrationPayload(
      options.resources,
      options.collections
    );
    const streamedResourceChunks = options.resources.resources.length === 0
      ? []
      : [createStartHydrationPayload(options.resources)];
    let legacyScript: string | undefined;

    return {
      root: {
        payload: rootPayload,
        script: rootScript
      },
      legacy: {
        payload: legacyPayload,
        get script() {
          legacyScript ??= createHydrationScript(legacyPayload);
          return legacyScript;
        }
      },
      streamedResourceChunks
    };
  });
