import {
  Resource,
  ResourceTagIdentityTypeId,
  ResourceTagTypeId,
  ServerTransportError,
  type ResourceInvalidation
} from "@effect-ui/core";
import { Effect } from "effect";
import { hydrateStartPayloadEffect } from "./hydration.js";
import type {
  StartActionInvalidationCause,
  StartActionInvalidationPlan,
  StartActionInvalidationTarget,
  StartActionResponseBody
} from "./start-action-response-codec.js";
import type { StartActionClientOptions } from "./start-transport-protocol.js";

const startActionInvalidationTransportError = (
  body: StartActionResponseBody,
  target: unknown,
  message: string
): ServerTransportError =>
  new ServerTransportError({
    reason: "InvalidResponse",
    message,
    payload: {
      body,
      target
    }
  });

const resourceTagIdentityFromStartTarget = (
  target: Extract<StartActionInvalidationTarget, { readonly _tag: "Tag" }>
) =>
  target.key === target.name
    ? {
        _tag: "Unkeyed" as const,
        name: target.name
      }
    : target.key.startsWith(`${target.name}:`)
      ? {
          _tag: "Keyed" as const,
          name: target.name,
          key: target.key.slice(target.name.length + 1)
        }
      : undefined;

const malformedStartActionTagTransportError = (
  body: StartActionResponseBody,
  target: StartActionInvalidationTarget | StartActionInvalidationCause
): ServerTransportError =>
  startActionInvalidationTransportError(
    body,
    target,
    "Start action invalidation metadata did not match the Resource tag key."
  );

const startActionInvalidationTargetEffect = (
  body: StartActionResponseBody,
  target: StartActionInvalidationTarget
): Effect.Effect<ResourceInvalidation<any>, ServerTransportError> => {
  if (target._tag === "Tag") {
    const identity = resourceTagIdentityFromStartTarget(target);
    if (identity === undefined) {
      return Effect.fail(malformedStartActionTagTransportError(body, target));
    }
    return Effect.succeed({
      [ResourceTagTypeId]: ResourceTagTypeId,
      [ResourceTagIdentityTypeId]: identity,
      name: target.name,
      key: target.key
    });
  }

  return Effect.flatMap(Resource.definitionEffect(target.family), (family) => {
    if (!family) {
      return Effect.fail(
        startActionInvalidationTransportError(
          body,
          target,
          "Start action invalidation metadata referenced an unknown Resource family."
        )
      );
    }

    const ref = family.ref(target.input);
    return ref.key === target.key
      ? Effect.succeed(ref)
      : Effect.fail(
          startActionInvalidationTransportError(
            body,
            target,
            "Start action invalidation metadata did not match the Resource input."
          )
        );
  });
};

const startActionInvalidationCauseEffect = (
  body: StartActionResponseBody,
  cause: StartActionInvalidationCause
): Effect.Effect<void, ServerTransportError> => {
  if (cause._tag === "Tag") {
    return resourceTagIdentityFromStartTarget(cause) === undefined
      ? Effect.fail(malformedStartActionTagTransportError(body, cause))
      : Effect.void;
  }

  return Effect.flatMap(Resource.definitionEffect(cause.family), (family) =>
    family
      ? Effect.void
      : Effect.fail(
          startActionInvalidationTransportError(
            body,
            cause,
            "Start action invalidation metadata referenced an unknown Resource family."
          )
        )
  );
};

const validateStartActionInvalidationPlanEffect = (
  body: StartActionResponseBody,
  plan: StartActionInvalidationPlan | undefined
): Effect.Effect<ReadonlyArray<ResourceInvalidation<any>>, ServerTransportError> =>
  plan === undefined
    ? Effect.succeed([])
    : Effect.gen(function* () {
        const targets = yield* Effect.forEach(
          plan.targets,
          (target) => startActionInvalidationTargetEffect(body, target)
        );
        yield* Effect.forEach(
          plan.entries,
          (entry) =>
            Effect.gen(function* () {
              yield* startActionInvalidationTargetEffect(body, {
                _tag: "Ref",
                key: entry.ref.key,
                family: entry.ref.family,
                input: entry.ref.input
              });
              yield* Effect.forEach(
                entry.causes,
                (cause) => startActionInvalidationCauseEffect(body, cause),
                { discard: true }
              );
            }),
          { discard: true }
        );
        return targets;
      });

const startActionHydrationTransportError = (
  body: StartActionResponseBody,
  cause: unknown
): ServerTransportError =>
  new ServerTransportError({
    reason: "InvalidResponse",
    message: "Start action response metadata could not be applied.",
    cause,
    payload: body
  });

/**
 * Applies accepted Start action response metadata in the browser Runtime Spine.
 *
 * The workflow validates serialized invalidation targets, hydrates returned
 * resources and collections, filters hydrated refs out of follow-up refresh
 * work, and maps malformed metadata to `ServerTransportError`.
 */
export const applyStartActionResponseEffect = <
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
>(
  body: StartActionResponseBody,
  options: StartActionClientOptions<FetchError, FetchRequirements, RuntimeError>
): Effect.Effect<void, ServerTransportError | RuntimeError, FetchRequirements> => {
  const effect = Effect.gen(function* () {
    const invalidationTargets = "invalidation" in body
      ? yield* validateStartActionInvalidationPlanEffect(body, body.invalidation)
      : [];

    if ("hydration" in body && body.hydration !== undefined) {
      yield* hydrateStartPayloadEffect(body.hydration, options).pipe(
        Effect.mapError((error) => startActionHydrationTransportError(body, error))
      );
    }

    const hydrationKeys = new Set(
      "hydration" in body && body.hydration
        ? body.hydration.resources.map((resource) => resource.key)
        : []
    );

    if (invalidationTargets.length > 0) {
      const plan = yield* Resource.planInvalidationEffect(invalidationTargets);
      yield* Resource.runInvalidationPlanEffect({
        targets: plan.targets,
        entries: plan.entries.filter((entry) => !hydrationKeys.has(entry.ref.key))
      });
    }
  });

  return (options.runtime
    ? options.runtime.provide(effect)
    : effect) as Effect.Effect<void, ServerTransportError | RuntimeError, FetchRequirements>;
};

/** Compatibility alias for the original action response metadata helper. */
export const hydrateActionResponseEffect = applyStartActionResponseEffect;
