import {
  Resource,
  ResourceTagIdentityTypeId,
  ResourceTagTypeId,
  ServerTransportError,
} from "@sunfall/arc-core";
import { lookupResourceFamily } from "@sunfall/arc-core/internal";
import { Effect } from "effect";
import { hydrateStartPayload } from "./hydration.js";
import type {
  StartActionInvalidationCause,
  StartActionInvalidationPlan,
  StartActionInvalidationTarget,
  StartActionResponseBody,
} from "./start-action-response-codec.js";

const startActionInvalidationTransportError = (
  body: StartActionResponseBody,
  target: unknown,
  message: string,
): ServerTransportError =>
  new ServerTransportError({
    reason: "InvalidResponse",
    message,
    payload: {
      body,
      target,
    },
  });

const resourceTagIdentityFromStartTarget = (
  target: Extract<StartActionInvalidationTarget, { readonly _tag: "Tag" }>,
) =>
  target.key === target.name
    ? {
        _tag: "Unkeyed" as const,
        name: target.name,
      }
    : target.key.startsWith(`${target.name}:`)
      ? {
          _tag: "Keyed" as const,
          name: target.name,
          key: target.key.slice(target.name.length + 1),
        }
      : undefined;

const malformedStartActionTagTransportError = (
  body: StartActionResponseBody,
  target: StartActionInvalidationTarget | StartActionInvalidationCause,
): ServerTransportError =>
  startActionInvalidationTransportError(
    body,
    target,
    "Start action invalidation metadata did not match the Resource tag key.",
  );

const startActionInvalidationTargetEffect = (
  body: StartActionResponseBody,
  target: StartActionInvalidationTarget,
): Effect.Effect<Resource.Invalidation<any>, ServerTransportError> => {
  if (target._tag === "Tag") {
    const identity = resourceTagIdentityFromStartTarget(target);
    if (identity === undefined) {
      return Effect.fail(malformedStartActionTagTransportError(body, target));
    }
    return Effect.succeed({
      [ResourceTagTypeId]: ResourceTagTypeId,
      [ResourceTagIdentityTypeId]: identity,
      name: target.name,
      key: target.key,
    });
  }

  return Effect.flatMap(lookupResourceFamily(target.family), (family) => {
    if (!family) {
      return Effect.fail(
        startActionInvalidationTransportError(
          body,
          target,
          "Start action invalidation metadata referenced an unknown Resource family.",
        ),
      );
    }

    const ref = family.ref(target.input);
    return ref.key === target.key
      ? Effect.succeed(ref)
      : Effect.fail(
          startActionInvalidationTransportError(
            body,
            target,
            "Start action invalidation metadata did not match the Resource input.",
          ),
        );
  });
};

const startActionInvalidationCauseEffect = (
  body: StartActionResponseBody,
  cause: StartActionInvalidationCause,
): Effect.Effect<void, ServerTransportError> => {
  if (cause._tag === "Tag") {
    return resourceTagIdentityFromStartTarget(cause) === undefined
      ? Effect.fail(malformedStartActionTagTransportError(body, cause))
      : Effect.void;
  }

  return Effect.flatMap(lookupResourceFamily(cause.family), (family) =>
    family
      ? Effect.void
      : Effect.fail(
          startActionInvalidationTransportError(
            body,
            cause,
            "Start action invalidation metadata referenced an unknown Resource family.",
          ),
        ),
  );
};

const validateStartActionInvalidationPlanEffect = (
  body: StartActionResponseBody,
  plan: StartActionInvalidationPlan | undefined,
): Effect.Effect<ReadonlyArray<Resource.Invalidation<any>>, ServerTransportError> =>
  plan === undefined
    ? Effect.succeed([])
    : Effect.gen(function* () {
        const targets = yield* Effect.forEach(plan.targets, (target) =>
          startActionInvalidationTargetEffect(body, target),
        );
        yield* Effect.forEach(
          plan.entries,
          (entry) =>
            Effect.gen(function* () {
              yield* startActionInvalidationTargetEffect(body, {
                _tag: "Ref",
                key: entry.ref.key,
                family: entry.ref.family,
                input: entry.ref.input,
              });
              yield* Effect.forEach(
                entry.causes,
                (cause) => startActionInvalidationCauseEffect(body, cause),
                { discard: true },
              );
            }),
          { discard: true },
        );
        return targets;
      });

const startActionHydrationTransportError = (
  body: StartActionResponseBody,
  cause: unknown,
): ServerTransportError =>
  new ServerTransportError({
    reason: "InvalidResponse",
    message: "Start action response metadata could not be applied.",
    cause,
    payload: body,
  });

const startActionResourceIdentity = (name: string, key: string): string =>
  JSON.stringify([name, key]);

const startActionHydrationResourceIdentity = (resource: Resource.Snapshot): string =>
  startActionResourceIdentity(resource.name, resource.key);

const startActionInvalidationEntryIdentity = (
  entry: Resource.InvalidationPlanEntry<unknown>,
): string => startActionResourceIdentity(entry.ref.family.options.name, entry.ref.key);

const startActionResponseInvalidationEffect = (
  body: StartActionResponseBody,
  hydratedResources: ReadonlySet<string> = new Set(),
): Effect.Effect<void, ServerTransportError, any> =>
  Effect.gen(function* () {
    const invalidationTargets =
      "invalidation" in body
        ? yield* validateStartActionInvalidationPlanEffect(body, body.invalidation)
        : [];

    if (invalidationTargets.length > 0) {
      const plan = yield* Resource.planInvalidation(invalidationTargets);
      yield* Resource.runInvalidationPlan({
        targets: plan.targets,
        entries: plan.entries.filter(
          (entry) => !hydratedResources.has(startActionInvalidationEntryIdentity(entry)),
        ),
      });
    }
  });

/**
 * Applies only the invalidation metadata of an action response, in the
 * runtime running this Effect. Superseded `parallel` submissions use it: the
 * visible state and hydrated values stay latest-only, while accepted server
 * mutations still refresh invalidated resources.
 */
export const applyStartActionInvalidation = (
  body: StartActionResponseBody,
): Effect.Effect<void, ServerTransportError> =>
  startActionResponseInvalidationEffect(body) as Effect.Effect<void, ServerTransportError>;

/**
 * Applies accepted Start action response metadata in the runtime running this
 * Effect (the submitting runtime).
 *
 * The workflow validates serialized invalidation targets, hydrates returned
 * resources, filters hydrated refs out of follow-up refresh
 * work, and maps malformed metadata to `ServerTransportError`.
 */
export const applyStartActionResponse = (
  body: StartActionResponseBody,
): Effect.Effect<void, ServerTransportError> =>
  Effect.gen(function* () {
    if ("hydration" in body && body.hydration !== undefined) {
      yield* hydrateStartPayload(body.hydration).pipe(
        Effect.mapError((error) => startActionHydrationTransportError(body, error)),
      );
    }

    const hydratedResources = new Set(
      "hydration" in body && body.hydration
        ? body.hydration.resources.map(startActionHydrationResourceIdentity)
        : [],
    );

    yield* startActionResponseInvalidationEffect(body, hydratedResources);
  }) as Effect.Effect<void, ServerTransportError>;
