import {
  ActionResult,
  isResourceRef,
  isResourceTag,
  Resource,
  ResourceTagIdentityTypeId,
  ResourceTagTypeId,
  ActionNotFound,
  ActionProtocolError,
  ActionTransportError,
  type Action,
} from "@sunfall/arc-core";
import {
  decodeActionWire,
  encodeActionWire,
  lookupResourceFamily,
} from "@sunfall/arc-core/internal";
import { Cause, Effect, Exit, Schema } from "effect";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  createStartHydrationPayload,
  hydrateStartPayload,
  type StartHydrationPayload,
} from "./hydration.js";
import {
  hasContentType,
  mediaTypeOf,
  negotiateAcceptedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  type StartTransportRequestError,
} from "./rpc.js";
import type { StartRequestFailureKind } from "./request-trace.js";
import { serializeDefect, type StartActionDefinition } from "./start-action-request-codec.js";

const refFields = { key: Schema.String, family: Schema.String };
const Ref = Schema.Struct({ ...refFields, input: Schema.Unknown });
const Tag = Schema.TaggedStruct("Tag", { key: Schema.String, name: Schema.String });

const InvalidationPlan = Schema.Struct({
  targets: Schema.Array(Schema.Union([Schema.TaggedStruct("Ref", Ref.fields), Tag])),
  entries: Schema.Array(
    Schema.Struct({
      ref: Ref,
      // Causes omit the ref input so fan-out stays small on the wire.
      causes: Schema.Array(Schema.Union([Schema.TaggedStruct("Ref", refFields), Tag])),
    }),
  ),
});

// Resource snapshots are checked when the payload hydrates.
const HydrationPayload = Schema.Struct({
  resources: Schema.Array(Schema.Unknown),
}) as unknown as Schema.Codec<StartHydrationPayload>;

const meta = {
  invalidation: Schema.optionalKey(InvalidationPlan),
  hydration: Schema.optionalKey(HydrationPayload),
};

/** Wire response body of the Start action transport, as an Effect Schema tagged union. */
const StartActionResponseBody = Schema.TaggedUnion({
  Success: { value: Schema.Unknown, ...meta },
  ValidationFailure: {
    fieldErrors: Schema.Unknown,
    formErrors: Schema.Array(Schema.Unknown),
    cause: Schema.optionalKey(Schema.Unknown),
    ...meta,
  },
  Redirect: {
    location: Schema.String,
    status: Schema.Int,
    headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    replace: Schema.optionalKey(Schema.Boolean),
    ...meta,
  },
  Failure: { error: Schema.Unknown, ...meta },
  ServerError: { error: Schema.Unknown },
  Defect: { defect: Schema.Unknown },
});

/** Wire response body used by the Start action transport. */
export type StartActionResponseBody = typeof StartActionResponseBody.Type;

/**
 * Serializable description of resources invalidated by a Start action.
 *
 * Ref targets carry the resource input for client-side invalidation; causes
 * omit it so responses can explain fan-out without duplicating inputs.
 */
export type StartActionInvalidationPlan = typeof InvalidationPlan.Type;

/** Optional client-side work bundled with a Start action response. */
export interface StartActionResponseMeta {
  readonly invalidation?: StartActionInvalidationPlan;
  readonly hydration?: StartHydrationPayload;
}

type StartActionDomainBody = Extract<
  StartActionResponseBody,
  { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
>;

const actionJson = (body: StartActionResponseBody, status = 200): Response => {
  const headers = { "content-type": startJsonMediaType };
  try {
    return new Response(JSON.stringify(body), { status, headers });
  } catch (cause) {
    return new Response(JSON.stringify({ _tag: "Defect", defect: serializeDefect(cause) }), {
      status: 500,
      headers,
    });
  }
};

const defectJson = (defect: unknown, status = 500): Response =>
  actionJson({ _tag: "Defect", defect: serializeDefect(defect) }, status);

const serverErrorJson = (error: ActionProtocolError | ActionNotFound, status: number): Response =>
  actionJson(
    {
      _tag: "ServerError",
      error:
        error._tag === "ActionNotFound"
          ? { _tag: error._tag, actionName: error.actionName }
          : { _tag: error._tag, message: error.message, payload: error.payload },
    },
    status,
  );

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Decodes a `ServerError` body's error, falling back to a protocol error. */
const deserializeServerError = (error: unknown): ActionProtocolError | ActionNotFound =>
  isRecordValue(error) && error._tag === "ActionNotFound" && typeof error.actionName === "string"
    ? new ActionNotFound({ actionName: error.actionName })
    : isRecordValue(error) &&
        error._tag === "ActionProtocolError" &&
        typeof error.message === "string"
      ? new ActionProtocolError({ message: error.message, payload: error.payload })
      : new ActionProtocolError({
          message: "The server returned an unknown action protocol error.",
          payload: error,
        });

export const actionRuntimeFailureResponse = (error: unknown): Response => defectJson(error);

export const actionProtocolFailureResponse = (error: ActionProtocolError, status = 400): Response =>
  serverErrorJson(error, status);

export const actionTransportRequestFailureResponse = (
  error: StartTransportRequestError,
): Response => {
  const response = actionProtocolFailureResponse(
    new ActionProtocolError({
      message: error.message,
      ...(error.payload === undefined ? {} : { payload: error.payload }),
    }),
    error.status,
  );
  if (error.allow) {
    response.headers.set("allow", error.allow);
  }
  return response;
};

export const actionFunctionNotFoundResponse = (actionName: string): Response =>
  serverErrorJson(new ActionNotFound({ actionName }), 404);

/** Converts a runtime invalidation plan into the serializable action payload. */
export const describeStartActionInvalidationPlan = (
  plan: Resource.InvalidationPlan<any>,
): StartActionInvalidationPlan => ({
  targets: plan.targets.flatMap((target): StartActionInvalidationPlan["targets"] =>
    isResourceRef(target)
      ? [
          {
            _tag: "Ref" as const,
            key: target.key,
            family: target.family.options.name,
            input: target.input,
          },
        ]
      : isResourceTag(target)
        ? [{ _tag: "Tag" as const, key: target.key, name: target.name }]
        : [],
  ),
  entries: plan.entries.map((entry) => ({
    ref: { key: entry.ref.key, family: entry.ref.family.options.name, input: entry.ref.input },
    causes: entry.causes.map((cause) =>
      cause._tag === "Ref"
        ? { _tag: "Ref" as const, key: cause.ref.key, family: cause.ref.family.options.name }
        : { _tag: "Tag" as const, key: cause.tag.key, name: cause.tag.name },
    ),
  })),
});

export const actionResponseMeta = (
  plan: Resource.InvalidationPlan<any> | undefined,
): Effect.Effect<StartActionResponseMeta, Resource.SnapshotCodecError> =>
  plan === undefined
    ? Effect.succeed({})
    : Effect.gen(function* () {
        const resources = yield* Resource.hydrationPayload(plan.entries.map((entry) => entry.ref));
        const hydration = createStartHydrationPayload(resources);
        return {
          invalidation: describeStartActionInvalidationPlan(plan),
          ...(hydration.resources.length === 0 ? {} : { hydration }),
        };
      });

export const actionResponseMode = (request: Request): "json" | "redirect" =>
  hasContentType(request.headers, [startJsonMediaType]) ||
  negotiateAcceptedMediaType(request.headers, [startHtmlMediaType, startJsonMediaType]) ===
    startJsonMediaType
    ? "json"
    : "redirect";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Encodes a successful action value; an output schema may describe the whole `ActionResult`. */
const actionValueResponse = (
  action: StartActionDefinition,
  result: unknown,
  meta: StartActionResponseMeta,
  mode: "json" | "redirect",
): Effect.Effect<Response> =>
  Effect.gen(function* () {
    const actionResult = ActionResult.is(result) ? result : undefined;
    if (actionResult && ActionResult.isRedirect(actionResult)) {
      const { location, status, headers, replace } = actionResult;
      return mode === "json"
        ? actionJson({
            _tag: "Redirect",
            location,
            status,
            ...(headers === undefined ? {} : { headers }),
            ...(replace === undefined ? {} : { replace }),
            ...meta,
          })
        : new Response(null, { status, headers: { location, ...headers } });
    }

    const whole = yield* Effect.exit(encodeActionWire(action.output, result));
    if (actionResult === undefined) {
      return Exit.isSuccess(whole)
        ? actionJson({ _tag: "Success", value: whole.value, ...meta })
        : defectJson(Cause.pretty(whole.cause));
    }
    // The encoded whole result, when the output schema describes `ActionResult` values.
    const encoded =
      Exit.isSuccess(whole) && isRecord(whole.value) && whole.value._tag === actionResult._tag
        ? whole.value
        : undefined;
    const source = (encoded ?? actionResult) as Record<string, unknown>;

    if (ActionResult.isValidationFailure(actionResult)) {
      return actionJson(
        {
          _tag: "ValidationFailure",
          fieldErrors: source.fieldErrors,
          formErrors: Array.isArray(source.formErrors) ? source.formErrors : [],
          ...(source.cause === undefined ? {} : { cause: serializeDefect(source.cause) }),
          ...meta,
        },
        // A validation outcome is an answer, not a transport error: JSON clients
        // get 200, so browsers log nothing; a form post gets 422.
        mode === "json" ? 200 : 422,
      );
    }
    if (ActionResult.isFailure(actionResult)) {
      return actionJson({ _tag: "Failure", error: source.error, ...meta });
    }
    const value =
      encoded !== undefined && "value" in encoded
        ? Exit.succeed(encoded.value)
        : yield* Effect.exit(
            encodeActionWire(action.output, (actionResult as { readonly value: unknown }).value),
          );
    return Exit.isSuccess(value)
      ? actionJson({ _tag: "Success", value: value.value, ...meta })
      : defectJson(Cause.pretty(value.cause));
  });

/** Encodes an action submission's Exit as the action transport response. */
export const actionExitResponse = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect",
): Effect.Effect<Response> => {
  if (Exit.isSuccess(exit)) {
    return actionValueResponse(action, exit.value, meta, mode);
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure.error)) {
      return Effect.succeed(
        actionProtocolFailureResponse(
          new ActionProtocolError({
            message: failure.error.message,
            payload: serializeDefect(failure.error),
          }),
        ),
      );
    }
    return Effect.map(Effect.exit(encodeActionWire(action.error, failure.error)), (encoded) =>
      Exit.isSuccess(encoded)
        ? actionJson({ _tag: "Failure", error: encoded.value, ...meta })
        : defectJson(Cause.pretty(encoded.cause)),
    );
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      actionJson(
        {
          _tag: "Defect",
          defect: { _tag: "Interrupted", message: "The action fiber was interrupted." },
        },
        499,
      ),
    );
  }

  return Effect.succeed(
    defectJson(exit.cause.reasons.find(Cause.isDieReason)?.defect ?? Cause.pretty(exit.cause)),
  );
};

const isStartActionResponseBody = Schema.is(StartActionResponseBody);

/**
 * Reads an action response from the `HttpClient`: checks the JSON media type
 * and the protocol shape, then checks the HTTP status against the body's tag
 * and turns `ServerError` / `Defect` bodies into failures.
 */
export const parseStartActionResponse = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<
  StartActionDomainBody,
  ActionTransportError | ActionProtocolError | ActionNotFound
> =>
  Effect.gen(function* () {
    const status = response.status;
    if (mediaTypeOf(response.headers["content-type"]) !== startJsonMediaType) {
      return yield* new ActionTransportError({
        reason: "InvalidResponse",
        status,
        message: "Start action response content-type was not application/json.",
        payload: { contentType: response.headers["content-type"] },
      });
    }
    const text = yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new ActionTransportError({
            reason: "InvalidResponse",
            status,
            message: "Could not read the action response body.",
            cause,
          }),
      ),
    );
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        new ActionTransportError({
          reason: "InvalidResponse",
          status,
          message: "Action response was not valid JSON.",
          cause,
          payload: text,
        }),
    });
    if (!isStartActionResponseBody(payload)) {
      return yield* new ActionTransportError({
        reason: "InvalidResponse",
        status,
        message: "Action response did not match the Sunfall Arc Start action protocol.",
        payload,
      });
    }
    switch (payload._tag) {
      case "ServerError":
        return yield* Effect.fail(deserializeServerError(payload.error));
      case "Defect":
        return yield* new ActionTransportError({
          reason: "Defect",
          status,
          message: "Start action failed with a defect.",
          payload: payload.defect,
        });
      default:
        return status >= 200 && status < 300
          ? payload
          : yield* new ActionTransportError({
              reason: "BadStatus",
              status,
              message: `Start action ${payload._tag} response used unexpected HTTP status ${status}.`,
              payload,
            });
    }
  });

/** A decoded remote action outcome: the value or typed error a local `run` would produce. */
export type StartActionOutcome<A, E> =
  | { readonly _tag: "Value"; readonly value: A }
  | { readonly _tag: "Error"; readonly error: E };

const actionResultTags: ReadonlySet<unknown> = new Set([
  "Success",
  "ValidationFailure",
  "Redirect",
  "Failure",
]);

/**
 * Decodes an action response into the outcome a local submission of the same
 * definition produces: an output schema that describes `ActionResult` values
 * decodes the whole response; otherwise `Success` decodes the output value,
 * `Failure` the typed error, and `ValidationFailure` / `Redirect` become the
 * `ActionResult` values the server action returned.
 */
export const decodeStartActionOutcome = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>,
  body: StartActionDomainBody,
): Effect.Effect<StartActionOutcome<A, E>, Schema.SchemaError> =>
  Effect.gen(function* () {
    const whole = yield* Effect.exit(decodeActionWire(definition.output, body));
    if (Exit.isSuccess(whole) && isRecord(whole.value) && actionResultTags.has(whole.value._tag)) {
      return { _tag: "Value", value: whole.value as A };
    }

    switch (body._tag) {
      case "Success":
        return {
          _tag: "Value",
          value: (yield* decodeActionWire(definition.output, body.value)) as A,
        };
      case "Failure":
        return {
          _tag: "Error",
          error: (yield* decodeActionWire(definition.error, body.error)) as E,
        };
      case "ValidationFailure":
        return {
          _tag: "Value",
          value: ActionResult.validation({
            fieldErrors: body.fieldErrors as never,
            formErrors: body.formErrors as never,
            ...(body.cause === undefined ? {} : { cause: body.cause }),
          }) as A,
        };
      case "Redirect":
        return {
          _tag: "Value",
          value: ActionResult.redirect(body.location, {
            status: body.status as ActionResult.RedirectStatus,
            ...(body.headers === undefined ? {} : { headers: body.headers }),
            ...(body.replace === undefined ? {} : { replace: body.replace }),
          }) as A,
        };
    }
  });

type WireInvalidation =
  | StartActionInvalidationPlan["targets"][number]
  | StartActionInvalidationPlan["entries"][number]["causes"][number];

/**
 * Resolves one wire invalidation target (or cause) against the runtime's
 * Resource families; a Ref without `input` (a cause) only checks its family.
 */
const resolveInvalidation = (
  body: StartActionResponseBody,
  target: WireInvalidation,
): Effect.Effect<Resource.Invalidation<any> | undefined, ActionTransportError> => {
  const invalid = (message: string) =>
    Effect.fail(
      new ActionTransportError({
        reason: "InvalidResponse",
        message: `Start action invalidation metadata ${message}`,
        payload: { body, target },
      }),
    );
  if (target._tag === "Tag") {
    const identity =
      target.key === target.name
        ? { _tag: "Unkeyed" as const, name: target.name }
        : target.key.startsWith(`${target.name}:`)
          ? {
              _tag: "Keyed" as const,
              name: target.name,
              key: target.key.slice(target.name.length + 1),
            }
          : undefined;
    return identity === undefined
      ? invalid("did not match the Resource tag key.")
      : Effect.succeed({
          [ResourceTagTypeId]: ResourceTagTypeId,
          [ResourceTagIdentityTypeId]: identity,
          name: target.name,
          key: target.key,
        });
  }
  return Effect.flatMap(lookupResourceFamily(target.family), (family) => {
    if (!family) {
      return invalid("referenced an unknown Resource family.");
    }
    if (!("input" in target)) {
      return Effect.succeed(undefined);
    }
    const ref = family.ref(target.input);
    return ref.key === target.key
      ? Effect.succeed(ref)
      : invalid("did not match the Resource input.");
  });
};

const resourceIdentity = (name: string, key: string): string => JSON.stringify([name, key]);

/**
 * Validates the response's invalidation metadata and runs the invalidation in
 * the current runtime, skipping refs whose fresh values were hydrated.
 */
const runResponseInvalidation = (
  body: StartActionResponseBody,
  hydrated: ReadonlySet<string>,
): Effect.Effect<void, ActionTransportError> =>
  Effect.gen(function* () {
    const plan = "invalidation" in body ? body.invalidation : undefined;
    if (plan === undefined) {
      return;
    }
    const targets = yield* Effect.forEach(plan.targets, (target) =>
      resolveInvalidation(body, target),
    );
    yield* Effect.forEach(
      plan.entries.flatMap((entry) => [{ _tag: "Ref" as const, ...entry.ref }, ...entry.causes]),
      (target) => resolveInvalidation(body, target),
      { discard: true },
    );
    if (targets.length === 0) {
      return;
    }
    const planned = yield* Resource.planInvalidation(targets as Array<Resource.Invalidation<any>>);
    yield* Resource.runInvalidationPlan({
      targets: planned.targets,
      entries: planned.entries.filter(
        (entry) => !hydrated.has(resourceIdentity(entry.ref.family.options.name, entry.ref.key)),
      ),
    });
  }) as Effect.Effect<void, ActionTransportError>;

/**
 * Applies only the invalidation metadata of an action response, in the
 * runtime running this Effect. Superseded `parallel` submissions use it: the
 * visible state and hydrated values stay latest-only, while accepted server
 * mutations still refresh invalidated resources.
 */
export const applyStartActionInvalidation = (
  body: StartActionResponseBody,
): Effect.Effect<void, ActionTransportError> => runResponseInvalidation(body, new Set());

/**
 * Applies accepted Start action response metadata in the runtime running this
 * Effect (the submitting runtime): hydrates returned resources, then runs the
 * invalidation for the refs that were not hydrated. Malformed metadata fails
 * with `ActionTransportError`.
 */
export const applyStartActionResponse = (
  body: StartActionResponseBody,
): Effect.Effect<void, ActionTransportError> =>
  Effect.gen(function* () {
    const hydration = "hydration" in body ? body.hydration : undefined;
    if (hydration !== undefined) {
      yield* hydrateStartPayload(hydration).pipe(
        Effect.mapError(
          (cause) =>
            new ActionTransportError({
              reason: "InvalidResponse",
              message: "Start action response metadata could not be applied.",
              cause,
              payload: body,
            }),
        ),
      );
    }
    yield* runResponseInvalidation(
      body,
      new Set(
        (hydration?.resources ?? []).map((resource) =>
          resourceIdentity(resource.name, resource.key),
        ),
      ),
    );
  });

/** Failure category of one action submission's exit, for the request span. */
export const actionFailureKind = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>,
): Effect.Effect<StartRequestFailureKind | undefined> => {
  if (Exit.isSuccess(exit)) {
    const result = exit.value;
    return Effect.succeed(
      !ActionResult.is(result)
        ? undefined
        : ActionResult.isValidationFailure(result)
          ? "validation"
          : ActionResult.isFailure(result)
            ? "domain"
            : undefined,
    );
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure.error)) {
      return Effect.succeed("validation");
    }

    return Effect.map(Effect.exit(encodeActionWire(action.error, failure.error)), (encoded) =>
      Exit.isSuccess(encoded) ? "domain" : "defect",
    );
  }

  return Effect.succeed(
    exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect",
  );
};
