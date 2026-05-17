import {
  ActionResult,
  isResourceRef,
  isResourceTag,
  Resource,
  Server,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  type ActionDefinition,
  type FormFieldErrors,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type ResourceSnapshotCodecError,
} from "@sunfall/arc-core";
import { Cause, Effect, Exit, Schema } from "effect";
import { createStartHydrationPayload, type StartHydrationPayload } from "./hydration.js";
import {
  hasContentType,
  negotiateAcceptedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  validateStartActionResponseEffect,
  type StartTransportRequestError,
} from "./rpc.js";
import { readStartTransportResponseTextEffect } from "./start-transport-body.js";
import { type StartActionDefinition } from "./start-action-request-codec.js";
import { decodeWithSchema, encodeWithSchema } from "./start-schema-codec.js";

/**
 * Serializable invalidation target emitted by a Start action response.
 *
 * Ref targets include the concrete resource input for client-side hydration and
 * invalidation. Tag targets represent broad invalidation groups.
 */
export type StartActionInvalidationTarget =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

/**
 * Serializable reason a resource ref was included in an action invalidation plan.
 *
 * Causes omit the original input so action responses can explain fan-out
 * without duplicating potentially large resource inputs.
 */
export type StartActionInvalidationCause =
  | {
      readonly _tag: "Ref";
      readonly key: string;
      readonly family: string;
    }
  | {
      readonly _tag: "Tag";
      readonly key: string;
      readonly name: string;
    };

/** Serializable description of resources invalidated by a Start action. */
export interface StartActionInvalidationPlan {
  readonly targets: ReadonlyArray<StartActionInvalidationTarget>;
  readonly entries: ReadonlyArray<{
    readonly ref: {
      readonly key: string;
      readonly family: string;
      readonly input: unknown;
    };
    readonly causes: ReadonlyArray<StartActionInvalidationCause>;
  }>;
}

/** Optional client-side work bundled with a Start action response. */
export interface StartActionResponseMeta {
  readonly invalidation?: StartActionInvalidationPlan;
  readonly hydration?: StartHydrationPayload;
}

/** Wire response body used by the Start action transport. */
export type StartActionResponseBody =
  | ({ readonly _tag: "Success"; readonly value: unknown } & StartActionResponseMeta)
  | ({
      readonly _tag: "ValidationFailure";
      readonly fieldErrors: unknown;
      readonly formErrors: readonly unknown[];
      readonly cause?: unknown;
    } & StartActionResponseMeta)
  | ({
      readonly _tag: "Redirect";
      readonly location: string;
      readonly status: number;
      readonly headers?: Readonly<Record<string, string>>;
      readonly replace?: boolean;
    } & StartActionResponseMeta)
  | ({ readonly _tag: "Failure"; readonly error: unknown } & StartActionResponseMeta)
  | { readonly _tag: "ServerError"; readonly error: unknown }
  | { readonly _tag: "Defect"; readonly defect: unknown };

/** Decoded client result for a Start action submission. */
export type StartActionResult<
  A,
  Values extends object = Record<string, unknown>,
  ValidationError = never,
  E = never,
> =
  | ({ readonly _tag: "Success"; readonly value: A } & StartActionResponseMeta)
  | ({
      readonly _tag: "ValidationFailure";
      readonly fieldErrors: FormFieldErrors<Values, ValidationError>;
      readonly formErrors: readonly ValidationError[];
      readonly cause?: unknown;
    } & StartActionResponseMeta)
  | ({
      readonly _tag: "Redirect";
      readonly location: string;
      readonly status: number;
      readonly headers?: Readonly<Record<string, string>>;
      readonly replace?: boolean;
    } & StartActionResponseMeta)
  | ({ readonly _tag: "Failure"; readonly error: E } & StartActionResponseMeta);

type StartActionOutputSuccess<A> = [
  Extract<A, { readonly _tag: "Success"; readonly value: unknown }>,
] extends [never]
  ? A
  : Extract<A, { readonly _tag: "Success"; readonly value: unknown }> extends {
        readonly value: infer Success;
      }
    ? Success
    : A;

type StartActionOutputValues<A> = [
  Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }>,
] extends [never]
  ? Record<string, unknown>
  : Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }> extends {
        readonly fieldErrors: FormFieldErrors<infer Values, infer _Error>;
      }
    ? Values
    : Record<string, unknown>;

type StartActionOutputValidationError<A> = [
  Extract<A, { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }>,
] extends [never]
  ? never
  : Extract<
        A,
        { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }
      > extends {
        readonly formErrors: readonly (infer ValidationError)[];
      }
    ? ValidationError
    : never;

type StartActionOutputFailure<A, E> = [
  Extract<A, { readonly _tag: "Failure"; readonly error: unknown }>,
] extends [never]
  ? E
  : Extract<A, { readonly _tag: "Failure"; readonly error: unknown }> extends {
        readonly error: infer Failure;
      }
    ? E | Failure
    : E;

/** Extracts the output value type from a core `ActionDefinition`. */
export type ActionDefinitionOutputValue<D> =
  D extends ActionDefinition<infer _I, infer A, infer _E, infer _R> ? A : never;

/** Extracts the error value type from a core `ActionDefinition`. */
export type ActionDefinitionErrorValue<D> =
  D extends ActionDefinition<infer _I, infer _A, infer E, infer _R> ? E : never;

/** Infers the typed Start action client result from an action output and error. */
export type StartActionResultFor<A, E = never> = StartActionResult<
  StartActionOutputSuccess<A>,
  StartActionOutputValues<A>,
  StartActionOutputValidationError<A>,
  StartActionOutputFailure<A, E>
>;

const startActionDefectBody = (
  cause: unknown,
): Extract<StartActionResponseBody, { readonly _tag: "Defect" }> => ({
  _tag: "Defect",
  defect: Server.serializeDefect(cause),
});

const actionJson = (body: StartActionResponseBody, status = 200): Response => {
  const headers = {
    "content-type": startJsonMediaType,
  };

  try {
    return new Response(JSON.stringify(body), { status, headers });
  } catch (cause) {
    return new Response(JSON.stringify(startActionDefectBody(cause)), {
      status: 500,
      headers,
    });
  }
};

const actionServerErrorBody = (
  error: ServerRpcProtocolError | ServerFunctionNotFound,
): Extract<StartActionResponseBody, { readonly _tag: "ServerError" }> => ({
  _tag: "ServerError",
  error: Server.serializeServerError(error),
});

export const actionRuntimeFailureResponse = (error: unknown): Response =>
  actionJson(startActionDefectBody(error), 500);

export const actionProtocolFailureResponse = (
  error: ServerRpcProtocolError,
  status = 400,
): Response => actionJson(actionServerErrorBody(error), status);

const withTransportRequestErrorHeaders = (
  response: Response,
  error: StartTransportRequestError,
): Response => {
  if (error.allow) {
    response.headers.set("allow", error.allow);
  }
  return response;
};

export const actionTransportRequestFailureResponse = (
  error: StartTransportRequestError,
): Response =>
  withTransportRequestErrorHeaders(actionProtocolFailureResponse(error.error, error.status), error);

export const actionFunctionNotFoundResponse = (actionName: string): Response =>
  actionJson(actionServerErrorBody(new ServerFunctionNotFound({ functionName: actionName })), 404);

const firstFail = <E>(cause: Cause.Cause<E>): E | undefined => {
  const reason = cause.reasons.find(Cause.isFailReason);
  return reason?.error;
};

const firstDefect = <E>(cause: Cause.Cause<E>): unknown | undefined => {
  const reason = cause.reasons.find(Cause.isDieReason);
  return reason?.defect;
};

const describeStartActionInvalidationTarget = (
  target: ResourceInvalidationPlan<any>["targets"][number],
): StartActionInvalidationTarget | undefined => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      key: target.key,
      family: target.family.options.name,
      input: target.input,
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name,
    };
  }

  return undefined;
};

const describeStartActionInvalidationCause = (
  cause: ResourceInvalidationCause,
): StartActionInvalidationCause =>
  cause._tag === "Ref"
    ? {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name,
      }
    : {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name,
      };

/** Converts a runtime invalidation plan into the serializable action payload. */
export const describeStartActionInvalidationPlan = (
  plan: ResourceInvalidationPlan<any>,
): StartActionInvalidationPlan => ({
  targets: plan.targets.flatMap((target) => {
    const described = describeStartActionInvalidationTarget(target);
    return described === undefined ? [] : [described];
  }),
  entries: plan.entries.map((entry) => ({
    ref: {
      key: entry.ref.key,
      family: entry.ref.family.options.name,
      input: entry.ref.input,
    },
    causes: entry.causes.map(describeStartActionInvalidationCause),
  })),
});

export const actionResponseMetaEffect = (
  plan: ResourceInvalidationPlan<any> | undefined,
): Effect.Effect<StartActionResponseMeta, ResourceSnapshotCodecError> =>
  plan === undefined
    ? Effect.succeed({})
    : Effect.gen(function* () {
        const resources = yield* Resource.hydrationPayloadEffect(
          plan.entries.map((entry) => entry.ref),
        );
        const hydration = createStartHydrationPayload(resources);
        return {
          invalidation: describeStartActionInvalidationPlan(plan),
          ...(hydration.resources.length === 0 && (hydration.collections?.length ?? 0) === 0
            ? {}
            : { hydration }),
        };
      });

export const actionResponseMode = (request: Request): "json" | "redirect" =>
  hasContentType(request.headers, [startJsonMediaType]) ||
  negotiateAcceptedMediaType(request.headers, [startHtmlMediaType, startJsonMediaType]) ===
    startJsonMediaType
    ? "json"
    : "redirect";

const encodeActionResultEffect = (
  action: StartActionDefinition,
  result: unknown,
): Effect.Effect<unknown, Schema.SchemaError> => encodeWithSchema(action.output, result);

const encodedActionResultOrSelf = (
  action: StartActionDefinition,
  result: unknown,
): Effect.Effect<unknown> =>
  Effect.map(Effect.exit(encodeActionResultEffect(action, result)), (exit) =>
    Exit.isSuccess(exit) ? exit.value : result,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const actionResultResponseEffect = (
  action: StartActionDefinition,
  result: unknown,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect",
): Effect.Effect<Response, never> => {
  const actionResult = ActionResult.is(result) ? result : undefined;

  if (actionResult && ActionResult.isRedirect(actionResult)) {
    if (mode === "json") {
      return Effect.succeed(
        actionJson({
          _tag: "Redirect",
          location: actionResult.location,
          status: actionResult.status,
          ...(actionResult.headers === undefined ? {} : { headers: actionResult.headers }),
          ...(actionResult.replace === undefined ? {} : { replace: actionResult.replace }),
          ...meta,
        }),
      );
    }

    return Effect.succeed(
      new Response(null, {
        status: actionResult.status,
        headers: {
          location: actionResult.location,
          ...actionResult.headers,
        },
      }),
    );
  }

  if (actionResult && ActionResult.isValidationFailure(actionResult)) {
    return Effect.map(encodedActionResultOrSelf(action, result), (encoded) => {
      const source = (
        isRecord(encoded) && encoded._tag === "ValidationFailure" ? encoded : actionResult
      ) as {
        readonly fieldErrors?: unknown;
        readonly formErrors?: unknown;
        readonly cause?: unknown;
      };
      return actionJson(
        {
          _tag: "ValidationFailure",
          fieldErrors: source.fieldErrors,
          formErrors: Array.isArray(source.formErrors) ? source.formErrors : [],
          ...(source.cause === undefined ? {} : { cause: Server.serializeDefect(source.cause) }),
          ...meta,
        },
        422,
      );
    });
  }

  if (actionResult && ActionResult.isFailure(actionResult)) {
    return Effect.map(encodedActionResultOrSelf(action, result), (encoded) => {
      const source = (isRecord(encoded) && encoded._tag === "Failure" ? encoded : actionResult) as {
        readonly error?: unknown;
      };
      return actionJson({
        _tag: "Failure",
        error: source.error,
        ...meta,
      });
    });
  }

  if (actionResult && ActionResult.isSuccess(actionResult)) {
    return Effect.gen(function* () {
      const encodedResult = yield* Effect.exit(encodeActionResultEffect(action, result));
      if (
        Exit.isSuccess(encodedResult) &&
        isRecord(encodedResult.value) &&
        encodedResult.value._tag === "Success" &&
        "value" in encodedResult.value
      ) {
        return actionJson({
          _tag: "Success",
          value: encodedResult.value.value,
          ...meta,
        });
      }

      const encodedValue = yield* Effect.exit(encodeWithSchema(action.output, actionResult.value));
      if (Exit.isSuccess(encodedValue)) {
        return actionJson({
          _tag: "Success",
          value: encodedValue.value,
          ...meta,
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encodedValue.cause)),
        },
        500,
      );
    });
  }

  return Effect.gen(function* () {
    const encoded = yield* Effect.exit(encodeWithSchema(action.output, result));
    if (Exit.isSuccess(encoded)) {
      return actionJson({
        _tag: "Success",
        value: encoded.value,
        ...meta,
      });
    }

    return actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(Cause.pretty(encoded.cause)),
      },
      500,
    );
  });
};

export const actionExitResponseEffect = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect",
): Effect.Effect<Response, never> => {
  if (Exit.isSuccess(exit)) {
    return actionResultResponseEffect(action, exit.value, meta, mode);
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed(
        actionProtocolFailureResponse(
          new ServerRpcProtocolError({
            message: failure.message,
            payload: Server.serializeDefect(failure),
          }),
        ),
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(encodeWithSchema(action.error, failure));
      if (Exit.isSuccess(encoded)) {
        return actionJson({
          _tag: "Failure",
          error: encoded.value,
          ...meta,
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause)),
        },
        500,
      );
    });
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      actionJson(
        {
          _tag: "Defect",
          defect: {
            _tag: "Interrupted",
            message: "The action fiber was interrupted.",
          },
        },
        499,
      ),
    );
  }

  return Effect.succeed(
    actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause)),
      },
      500,
    ),
  );
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isStartActionResponseBody = (value: unknown): value is StartActionResponseBody => {
  if (!isRecord(value) || !isStartActionResponseMeta(value)) {
    return false;
  }

  switch (value._tag) {
    case "Success":
      return hasOwn(value, "value");
    case "ValidationFailure":
      return hasOwn(value, "fieldErrors") && Array.isArray(value.formErrors);
    case "Redirect":
      return (
        typeof value.location === "string" &&
        Number.isInteger(value.status) &&
        (value.headers === undefined || isStringRecord(value.headers)) &&
        (value.replace === undefined || typeof value.replace === "boolean")
      );
    case "Failure":
    case "ServerError":
      return hasOwn(value, "error");
    case "Defect":
      return hasOwn(value, "defect");
    default:
      return false;
  }
};

const isStartActionInvalidationTarget = (
  value: unknown,
): value is StartActionInvalidationTarget => {
  if (!isRecord(value)) {
    return false;
  }

  if (value._tag === "Ref") {
    return (
      typeof value.key === "string" && typeof value.family === "string" && hasOwn(value, "input")
    );
  }

  return value._tag === "Tag" && typeof value.key === "string" && typeof value.name === "string";
};

const isStartActionInvalidationCause = (value: unknown): value is StartActionInvalidationCause => {
  if (!isRecord(value)) {
    return false;
  }

  if (value._tag === "Ref") {
    return typeof value.key === "string" && typeof value.family === "string";
  }

  return value._tag === "Tag" && typeof value.key === "string" && typeof value.name === "string";
};

const isStartActionInvalidationPlan = (value: unknown): value is StartActionInvalidationPlan => {
  if (!isRecord(value) || !Array.isArray(value.targets) || !Array.isArray(value.entries)) {
    return false;
  }

  return (
    value.targets.every(isStartActionInvalidationTarget) &&
    value.entries.every(
      (entry) =>
        isRecord(entry) &&
        isRecord(entry.ref) &&
        typeof entry.ref.key === "string" &&
        typeof entry.ref.family === "string" &&
        hasOwn(entry.ref, "input") &&
        Array.isArray(entry.causes) &&
        entry.causes.every(isStartActionInvalidationCause),
    )
  );
};

const isStartHydrationPayload = (value: unknown): value is StartHydrationPayload =>
  isRecord(value) &&
  Array.isArray(value.resources) &&
  (value.collections === undefined || Array.isArray(value.collections));

const isStartActionResponseMeta = (value: Record<string, unknown>): boolean =>
  (value.invalidation === undefined || isStartActionInvalidationPlan(value.invalidation)) &&
  (value.hydration === undefined || isStartHydrationPayload(value.hydration));

export const parseStartActionResponse = (
  response: Response,
): Effect.Effect<StartActionResponseBody, ServerTransportError> =>
  Effect.gen(function* () {
    yield* validateStartActionResponseEffect(response);
    const text = yield* readStartTransportResponseTextEffect(
      response,
      "Could not read the action response body.",
    );
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Action response was not valid JSON.",
          cause,
          payload: text,
        }),
    });
    if (!isStartActionResponseBody(payload)) {
      return yield* new ServerTransportError({
        reason: "InvalidResponse",
        status: response.status,
        message: "Action response did not match the Sunfall Arc Start action protocol.",
        payload,
      });
    }

    return payload;
  });

const startActionResponseMeta = (body: StartActionResponseBody): StartActionResponseMeta => ({
  ...("invalidation" in body && body.invalidation !== undefined
    ? { invalidation: body.invalidation }
    : {}),
  ...("hydration" in body && body.hydration !== undefined ? { hydration: body.hydration } : {}),
});

const hasActionResultTag = (
  value: unknown,
): value is Extract<
  StartActionResponseBody,
  { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
> =>
  isRecord(value) &&
  (value._tag === "Success" ||
    value._tag === "ValidationFailure" ||
    value._tag === "Redirect" ||
    value._tag === "Failure");

const normalizeDecodedActionResult = (
  decoded: Extract<
    StartActionResponseBody,
    { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
  >,
  meta: StartActionResponseMeta,
): StartActionResult<unknown, Record<string, unknown>, unknown, unknown> => {
  switch (decoded._tag) {
    case "Success":
      return {
        _tag: "Success",
        value: decoded.value,
        ...meta,
      };
    case "ValidationFailure":
      return {
        _tag: "ValidationFailure",
        fieldErrors: decoded.fieldErrors as FormFieldErrors<Record<string, unknown>, unknown>,
        formErrors: decoded.formErrors,
        ...(decoded.cause === undefined ? {} : { cause: decoded.cause }),
        ...meta,
      };
    case "Redirect":
      return {
        _tag: "Redirect",
        location: decoded.location,
        status: decoded.status,
        ...(decoded.headers === undefined ? {} : { headers: decoded.headers }),
        ...(decoded.replace === undefined ? {} : { replace: decoded.replace }),
        ...meta,
      };
    case "Failure":
      return {
        _tag: "Failure",
        error: decoded.error,
        ...meta,
      };
  }
};

const decodeActionOutputResultEffect = (
  definition: StartActionDefinition,
  body: Extract<
    StartActionResponseBody,
    { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
  >,
  meta: StartActionResponseMeta,
): Effect.Effect<
  StartActionResult<unknown, Record<string, unknown>, unknown, unknown>,
  Schema.SchemaError
> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.exit(decodeWithSchema(definition.output, body));
    if (Exit.isSuccess(decoded) && hasActionResultTag(decoded.value)) {
      return normalizeDecodedActionResult(decoded.value, meta);
    }

    switch (body._tag) {
      case "Success":
        return {
          _tag: "Success",
          value: yield* decodeWithSchema(definition.output, body.value),
          ...meta,
        };
      case "Failure":
        return {
          _tag: "Failure",
          error: yield* decodeWithSchema(definition.error, body.error),
          ...meta,
        };
      case "ValidationFailure":
        return normalizeDecodedActionResult(body, meta);
      case "Redirect":
        return normalizeDecodedActionResult(body, meta);
    }
  });

export const decodeStartActionResponseEffect = <D extends StartActionDefinition>(
  definition: D,
  body: Extract<
    StartActionResponseBody,
    { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }
  >,
): Effect.Effect<
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>,
  Schema.SchemaError
> =>
  Effect.map(
    decodeActionOutputResultEffect(definition, body, startActionResponseMeta(body)),
    (decoded) =>
      decoded as StartActionResultFor<
        ActionDefinitionOutputValue<D>,
        ActionDefinitionErrorValue<D>
      >,
  );
