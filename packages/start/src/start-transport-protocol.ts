import {
  Action,
  ActionResult,
  type CoreDefinitionRegistry,
  isResourceRef,
  isResourceTag,
  Resource,
  ResourceTagTypeId,
  Server,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  type ActionDefinition,
  type EffectUiRuntime,
  type FormFieldErrors,
  type ResourceInvalidation,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type ServerFunction
} from "@effect-ui/core";
import { Cause, Effect, Exit, Schema } from "effect";
import {
  createStartHydrationPayload,
  hydrateStartPayloadEffect,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";
import {
  hasContentType,
  serverActionPath,
  serverRpcPath,
  startJsonMediaType,
  validateStartRpcResponseEffect,
  type StartTransportRequestError
} from "./rpc.js";
import type { StartRequestTraceFailureKind } from "./request-trace.js";
import type { ServerRpcClientOptions } from "./start-fetch.js";

/**
 * Options for clients that submit Start actions.
 *
 * Extends RPC options with optional collection hydration settings. Supplying a
 * runtime runs action response hydration in that runtime.
 */
export interface StartActionClientOptions<FetchError = never, RuntimeError = never>
  extends ServerRpcClientOptions<FetchError>, StartCollectionHydrationOptions {
  readonly runtime?: EffectUiRuntime<unknown, RuntimeError>;
}

/** JSON payload accepted by the Start action transport. */
export interface StartActionRequest {
  readonly name: string;
  readonly input: unknown;
}

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
export type StartActionResult<A, Values extends object = Record<string, unknown>, ValidationError = never, E = never> =
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

type StartActionOutputSuccess<A> =
  [Extract<A, { readonly _tag: "Success"; readonly value: unknown }>] extends [never]
    ? A
    : Extract<A, { readonly _tag: "Success"; readonly value: unknown }> extends { readonly value: infer Success }
    ? Success
    : A;

type StartActionOutputValues<A> =
  [Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }>] extends [never]
    ? Record<string, unknown>
    : Extract<A, { readonly _tag: "ValidationFailure"; readonly fieldErrors: unknown }> extends {
    readonly fieldErrors: FormFieldErrors<infer Values, infer _Error>;
  }
    ? Values
    : Record<string, unknown>;

type StartActionOutputValidationError<A> =
  [Extract<A, { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }>] extends [never]
    ? never
    : Extract<A, { readonly _tag: "ValidationFailure"; readonly formErrors: readonly unknown[] }> extends {
    readonly formErrors: readonly (infer ValidationError)[];
  }
    ? ValidationError
    : never;

type StartActionOutputFailure<A, E> =
  [Extract<A, { readonly _tag: "Failure"; readonly error: unknown }>] extends [never]
    ? E
    : Extract<A, { readonly _tag: "Failure"; readonly error: unknown }> extends { readonly error: infer Failure }
    ? E | Failure
    : E;

export type ActionDefinitionInputValue<D> =
  D extends ActionDefinition<infer I, infer _A, infer _E, infer _R> ? I : never;

export type ActionDefinitionOutputValue<D> =
  D extends ActionDefinition<infer _I, infer A, infer _E, infer _R> ? A : never;

export type ActionDefinitionErrorValue<D> =
  D extends ActionDefinition<infer _I, infer _A, infer E, infer _R> ? E : never;

/** Infers the typed Start action client result from an action output and error. */
export type StartActionResultFor<A, E = never> =
  StartActionResult<
    StartActionOutputSuccess<A>,
    StartActionOutputValues<A>,
    StartActionOutputValidationError<A>,
    StartActionOutputFailure<A, E>
  >;

export interface StartActionFormField {
  readonly name: string;
  readonly value: string;
}

/**
 * Minimal HTML form description for progressive enhancement.
 *
 * Render `hiddenFields` into a POST form to submit through the action transport
 * without client JavaScript.
 */
export interface StartActionForm {
  readonly method: "post";
  readonly action: string;
  readonly hiddenFields: readonly StartActionFormField[];
}

export interface StartActionFormOptions<I> {
  readonly action?: string;
  readonly input?: Partial<I>;
}

/** Any core action definition that can be exposed through Start actions. */
export type StartActionDefinition =
  | ActionDefinition<any, any, never, any>
  | ActionDefinition<any, any, any, any>;

export const startActionNameField = "__effect_ui_action";
export const startActionInputField = "__effect_ui_input";

export const isServerRpcRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverRpcPath;

export const isServerActionRequest = (request: Request): boolean =>
  new URL(request.url).pathname === serverActionPath;

/** Creates the hidden POST fields needed to submit a Start action from HTML. */
export const startActionForm = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  options: StartActionFormOptions<I> = {}
): StartActionForm => ({
  method: "post",
  action: options.action ?? serverActionPath,
  hiddenFields: [
    {
      name: startActionNameField,
      value: definition.name
    },
    ...(options.input === undefined
      ? []
      : [
          {
            name: startActionInputField,
            value: JSON.stringify(options.input)
          }
        ])
  ]
});

const rpcJson = (body: Server.RpcResponse, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": startJsonMediaType
    }
  });

const actionJson = (body: StartActionResponseBody, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": startJsonMediaType
    }
  });

export const readJsonEffect = (request: Request): Effect.Effect<unknown, ServerRpcProtocolError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new ServerRpcProtocolError({
        message: "Expected a JSON server function request body.",
        payload: Server.serializeDefect(cause)
      })
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const decodeWithSchema = <A>(
  schema: unknown,
  input: unknown
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.decodeUnknownEffect(schema as Schema.Decoder<A>)(input)
    : Effect.succeed(input as A);

export const encodeWithSchema = (
  schema: unknown,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  Schema.isSchema(schema)
    ? Schema.encodeUnknownEffect(schema as Schema.Encoder<unknown>)(input)
    : Effect.succeed(input);

const protocolErrorBody = (error: ServerRpcProtocolError): StartActionResponseBody => ({
  _tag: "ServerError",
  error: Server.serializeServerError(error)
});

export const rpcRuntimeFailureResponse = (error: unknown): Response =>
  rpcJson(
    {
      _tag: "Defect",
      defect: Server.serializeDefect(error)
    },
    500
  );

export const actionRuntimeFailureResponse = (error: unknown): Response =>
  actionJson(
    {
      _tag: "Defect",
      defect: Server.serializeDefect(error)
    },
    500
  );

export const actionProtocolFailureResponse = (
  error: ServerRpcProtocolError,
  status = 400
): Response => actionJson(protocolErrorBody(error), status);

const withTransportRequestErrorHeaders = (
  response: Response,
  error: StartTransportRequestError
): Response => {
  if (error.allow) {
    response.headers.set("allow", error.allow);
  }
  return response;
};

export const actionTransportRequestFailureResponse = (
  error: StartTransportRequestError
): Response =>
  withTransportRequestErrorHeaders(
    actionProtocolFailureResponse(error.error, error.status),
    error
  );

export const actionFunctionNotFoundResponse = (actionName: string): Response =>
  actionJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(new ServerFunctionNotFound({ functionName: actionName }))
    },
    404
  );

const readActionJsonEffect = (request: Request): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  Effect.gen(function* () {
    const payload = yield* readJsonEffect(request);
    if (
      !isRecord(payload) ||
      typeof payload.name !== "string" ||
      !("input" in payload)
    ) {
      return yield* new ServerRpcProtocolError({
        message: "Expected an action request with string name and input fields.",
        payload
      });
    }

    return {
      name: payload.name,
      input: payload.input
    };
  });

const formValue = (value: FormDataEntryValue): unknown =>
  typeof value === "string" ? value : value.name;

const formDataToObject = (formData: FormData): Record<string, unknown> => {
  const input: Record<string, unknown> = {};

  formData.forEach((value, key) => {
    if (key === startActionNameField || key === startActionInputField) {
      return;
    }

    const next = formValue(value);
    const existing = input[key];
    if (existing === undefined) {
      input[key] = next;
    } else if (Array.isArray(existing)) {
      existing.push(next);
    } else {
      input[key] = [existing, next];
    }
  });

  return input;
};

const readActionFormEffect = (request: Request): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  Effect.gen(function* () {
    const formData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: (cause) =>
        new ServerRpcProtocolError({
          message: "Expected an action form body.",
          payload: Server.serializeDefect(cause)
        })
    });
    const name = formData.get(startActionNameField);
    if (typeof name !== "string" || name.length === 0) {
      return yield* new ServerRpcProtocolError({
        message: `Missing ${startActionNameField} form field.`
      });
    }

    const fieldInput = formDataToObject(formData);
    const encodedInput = formData.get(startActionInputField);
    if (typeof encodedInput !== "string" || encodedInput.length === 0) {
      return {
        name,
        input: fieldInput
      };
    }

    const baseInput = yield* Effect.try({
      try: () => JSON.parse(encodedInput) as unknown,
      catch: (cause) =>
        new ServerRpcProtocolError({
          message: `Could not parse ${startActionInputField} as JSON.`,
          payload: Server.serializeDefect(cause)
        })
    });

    return {
      name,
      input: isRecord(baseInput)
        ? {
            ...baseInput,
            ...fieldInput
          }
        : baseInput
    };
  });

export const readStartActionRequestEffect = (
  request: Request
): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  hasContentType(request.headers, [startJsonMediaType])
    ? readActionJsonEffect(request)
    : readActionFormEffect(request);

export const makeActionMap = (
  actions?: Iterable<StartActionDefinition>,
  registry?: CoreDefinitionRegistry<StartActionDefinition, ServerFunction<any, any, any, any>>
): ReadonlyMap<string, StartActionDefinition> =>
  actions === undefined
    ? registry?.actions ?? Action.definitions()
    : new Map(Array.from(actions, (action) => [action.name, action]));

const firstFail = <E>(cause: Cause.Cause<E>): E | undefined => {
  const reason = cause.reasons.find(Cause.isFailReason);
  return reason?.error;
};

const firstDefect = <E>(cause: Cause.Cause<E>): unknown | undefined => {
  const reason = cause.reasons.find(Cause.isDieReason);
  return reason?.defect;
};

export const rpcFailureKindEffect = <FnError>(
  fn: ServerFunction<unknown, unknown, FnError, unknown>,
  exit: Exit.Exit<unknown, FnError>
): Effect.Effect<StartRequestTraceFailureKind> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed("domain");
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed("validation");
    }

    return Effect.map(
      Effect.exit(Server.encodeError(fn, failure)),
      (encoded) => Exit.isSuccess(encoded) ? "domain" : "defect"
    );
  }

  return Effect.succeed(
    exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect"
  );
};

const actionResultFailureKind = (
  result: unknown
): StartRequestTraceFailureKind | undefined => {
  if (!ActionResult.is(result)) {
    return undefined;
  }
  if (ActionResult.isValidationFailure(result)) {
    return "validation";
  }
  if (ActionResult.isFailure(result)) {
    return "domain";
  }
  return undefined;
};

export const actionFailureKindEffect = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>
): Effect.Effect<StartRequestTraceFailureKind | undefined> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed(actionResultFailureKind(exit.value));
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed("validation");
    }

    return Effect.map(
      Effect.exit(encodeWithSchema(action.error, failure)),
      (encoded) => Exit.isSuccess(encoded) ? "domain" : "defect"
    );
  }

  return Effect.succeed(
    exit.cause.reasons.some(Cause.isInterruptReason) ? "interruption" : "defect"
  );
};

export const protocolFailureResponse = (error: ServerRpcProtocolError, status = 400): Response =>
  rpcJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(error)
    },
    status
  );

export const rpcTransportRequestFailureResponse = (
  error: StartTransportRequestError
): Response =>
  withTransportRequestErrorHeaders(
    protocolFailureResponse(error.error, error.status),
    error
  );

export const functionNotFoundResponse = (functionName: string): Response =>
  rpcJson(
    {
      _tag: "ServerError",
      error: Server.serializeServerError(new ServerFunctionNotFound({ functionName }))
    },
    404
  );

export const exitToRpcResponse = <FnError>(
  fn: ServerFunction<unknown, unknown, FnError, unknown>,
  exit: Exit.Exit<unknown, FnError>
): Effect.Effect<Response, never> => {
  if (Exit.isSuccess(exit)) {
    return Effect.succeed(
      rpcJson({
        _tag: "Success",
        value: exit.value
      })
    );
  }

  const failure = firstFail(exit.cause);
  if (failure !== undefined) {
    if (Schema.isSchemaError(failure)) {
      return Effect.succeed(
        protocolFailureResponse(
          new ServerRpcProtocolError({
            message: failure.message,
            payload: Server.serializeDefect(failure)
          })
        )
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(Server.encodeError(fn, failure));
      if (Exit.isSuccess(encoded)) {
        return rpcJson({
          _tag: "Failure",
          error: encoded.value
        });
      }

      return rpcJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause))
        },
        500
      );
    });
  }

  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    return Effect.succeed(
      rpcJson(
        {
          _tag: "Defect",
          defect: {
            _tag: "Interrupted",
            message: "The server function fiber was interrupted."
          }
        },
        499
      )
    );
  }

  return Effect.succeed(
    rpcJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause))
      },
      500
    )
  );
};

const describeStartActionInvalidationTarget = (
  target: ResourceInvalidationPlan["targets"][number]
): StartActionInvalidationTarget | undefined => {
  if (isResourceRef(target)) {
    return {
      _tag: "Ref",
      key: target.key,
      family: target.family.options.name,
      input: target.input
    };
  }

  if (isResourceTag(target)) {
    return {
      _tag: "Tag",
      key: target.key,
      name: target.name
    };
  }

  return undefined;
};

const describeStartActionInvalidationCause = (
  cause: ResourceInvalidationCause
): StartActionInvalidationCause =>
  cause._tag === "Ref"
    ? {
        _tag: "Ref",
        key: cause.ref.key,
        family: cause.ref.family.options.name
      }
    : {
        _tag: "Tag",
        key: cause.tag.key,
        name: cause.tag.name
      };

/** Converts a runtime invalidation plan into the serializable action payload. */
export const describeStartActionInvalidationPlan = (
  plan: ResourceInvalidationPlan
): StartActionInvalidationPlan => ({
  targets: plan.targets.flatMap((target) => {
    const described = describeStartActionInvalidationTarget(target);
    return described === undefined ? [] : [described];
  }),
  entries: plan.entries.map((entry) => ({
    ref: {
      key: entry.ref.key,
      family: entry.ref.family.options.name,
      input: entry.ref.input
    },
    causes: entry.causes.map(describeStartActionInvalidationCause)
  }))
});

export const actionResponseMetaEffect = (
  plan: ResourceInvalidationPlan | undefined
): Effect.Effect<StartActionResponseMeta> =>
  plan === undefined
    ? Effect.succeed({})
    : Effect.gen(function* () {
        const resources = yield* Resource.hydrationPayloadEffect(plan.entries.map((entry) => entry.ref));
        const hydration = createStartHydrationPayload(resources);
        return {
          invalidation: describeStartActionInvalidationPlan(plan),
          ...(hydration.resources.length === 0 &&
            (hydration.collections?.length ?? 0) === 0
            ? {}
            : { hydration })
        };
      });

export const actionResponseMode = (request: Request): "json" | "redirect" =>
  hasContentType(request.headers, [startJsonMediaType]) ? "json" : "redirect";

const encodeActionResultEffect = (
  action: StartActionDefinition,
  result: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeWithSchema(action.output, result);

const encodedActionResultOrSelf = (
  action: StartActionDefinition,
  result: unknown
): Effect.Effect<unknown> =>
  Effect.map(
    Effect.exit(encodeActionResultEffect(action, result)),
    (exit) => Exit.isSuccess(exit) ? exit.value : result
  );

const actionResultResponseEffect = (
  action: StartActionDefinition,
  result: unknown,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect"
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
          ...meta
        })
      );
    }

    return Effect.succeed(
      new Response(null, {
        status: actionResult.status,
        headers: {
          location: actionResult.location,
          ...(actionResult.headers ?? {})
        }
      })
    );
  }

  if (actionResult && ActionResult.isValidationFailure(actionResult)) {
    return Effect.map(
      encodedActionResultOrSelf(action, result),
      (encoded) => {
        const source = (isRecord(encoded) && encoded._tag === "ValidationFailure"
          ? encoded
          : actionResult) as {
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
            ...meta
          },
          422
        );
      }
    );
  }

  if (actionResult && ActionResult.isFailure(actionResult)) {
    return Effect.map(
      encodedActionResultOrSelf(action, result),
      (encoded) => {
        const source = (isRecord(encoded) && encoded._tag === "Failure"
          ? encoded
          : actionResult) as { readonly error?: unknown };
        return actionJson({
          _tag: "Failure",
          error: source.error,
          ...meta
        });
      }
    );
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
          ...meta
        });
      }

      const encodedValue = yield* Effect.exit(encodeWithSchema(action.output, actionResult.value));
      if (Exit.isSuccess(encodedValue)) {
        return actionJson({
          _tag: "Success",
          value: encodedValue.value,
          ...meta
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encodedValue.cause))
        },
        500
      );
    });
  }

  return Effect.gen(function* () {
    const encoded = yield* Effect.exit(encodeWithSchema(action.output, result));
    if (Exit.isSuccess(encoded)) {
      return actionJson({
        _tag: "Success",
        value: encoded.value,
        ...meta
      });
    }

    return actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(Cause.pretty(encoded.cause))
      },
      500
    );
  });
};

export const actionExitResponseEffect = <ActionError>(
  action: StartActionDefinition,
  exit: Exit.Exit<unknown, ActionError>,
  meta: StartActionResponseMeta = {},
  mode: "json" | "redirect" = "redirect"
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
            payload: Server.serializeDefect(failure)
          })
        )
      );
    }

    return Effect.gen(function* () {
      const encoded = yield* Effect.exit(encodeWithSchema(action.error, failure));
      if (Exit.isSuccess(encoded)) {
        return actionJson({
          _tag: "Failure",
          error: encoded.value,
          ...meta
        });
      }

      return actionJson(
        {
          _tag: "Defect",
          defect: Server.serializeDefect(Cause.pretty(encoded.cause))
        },
        500
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
            message: "The action fiber was interrupted."
          }
        },
        499
      )
    );
  }

  return Effect.succeed(
    actionJson(
      {
        _tag: "Defect",
        defect: Server.serializeDefect(firstDefect(exit.cause) ?? Cause.pretty(exit.cause))
      },
      500
    )
  );
};

export const parseRpcResponse = (
  response: Response
): Effect.Effect<Server.RpcResponse, ServerTransportError | Schema.SchemaError> =>
  Effect.gen(function* () {
    yield* validateStartRpcResponseEffect(response);
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Could not read the server function response body.",
          cause
        })
    });
    const payload = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Server function response was not valid JSON.",
          cause,
          payload: text
        })
    });
    return yield* Server.decodeRpcResponse(payload);
  });

const isStartActionResponseBody = (value: unknown): value is StartActionResponseBody =>
  isRecord(value) &&
  (
    value._tag === "Success" ||
    value._tag === "ValidationFailure" ||
    value._tag === "Redirect" ||
    value._tag === "Failure" ||
    value._tag === "ServerError" ||
    value._tag === "Defect"
  );

export const parseStartActionResponse = (
  response: Response
): Effect.Effect<StartActionResponseBody, ServerTransportError> =>
  Effect.gen(function* () {
    yield* validateStartRpcResponseEffect(response);
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Could not read the action response body.",
          cause
        })
    });
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        new ServerTransportError({
          reason: "InvalidResponse",
          status: response.status,
          message: "Action response was not valid JSON.",
          cause,
          payload: text
        })
    });
    if (!isStartActionResponseBody(payload)) {
      return yield* new ServerTransportError({
        reason: "InvalidResponse",
        status: response.status,
        message: "Action response did not match the Effect UI Start action protocol.",
        payload
      });
    }

    return payload;
  });

const startActionResponseMeta = (
  body: StartActionResponseBody
): StartActionResponseMeta => ({
  ...("invalidation" in body && body.invalidation !== undefined ? { invalidation: body.invalidation } : {}),
  ...("hydration" in body && body.hydration !== undefined ? { hydration: body.hydration } : {})
});

const hasActionResultTag = (
  value: unknown
): value is Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }> =>
  isRecord(value) &&
  (
    value._tag === "Success" ||
    value._tag === "ValidationFailure" ||
    value._tag === "Redirect" ||
    value._tag === "Failure"
  );

const normalizeDecodedActionResult = (
  decoded: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>,
  meta: StartActionResponseMeta
): StartActionResult<unknown, Record<string, unknown>, unknown, unknown> => {
  switch (decoded._tag) {
    case "Success":
      return {
        _tag: "Success",
        value: decoded.value,
        ...meta
      };
    case "ValidationFailure":
      return {
        _tag: "ValidationFailure",
        fieldErrors: decoded.fieldErrors as FormFieldErrors<Record<string, unknown>, unknown>,
        formErrors: decoded.formErrors,
        ...(decoded.cause === undefined ? {} : { cause: decoded.cause }),
        ...meta
      };
    case "Redirect":
      return {
        _tag: "Redirect",
        location: decoded.location,
        status: decoded.status,
        ...(decoded.headers === undefined ? {} : { headers: decoded.headers }),
        ...(decoded.replace === undefined ? {} : { replace: decoded.replace }),
        ...meta
      };
    case "Failure":
      return {
        _tag: "Failure",
        error: decoded.error,
        ...meta
      };
  }
};

const decodeActionOutputResultEffect = (
  definition: StartActionDefinition,
  body: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>,
  meta: StartActionResponseMeta
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
          ...meta
        };
      case "Failure":
        return {
          _tag: "Failure",
          error: yield* decodeWithSchema(definition.error, body.error),
          ...meta
        };
      case "ValidationFailure":
        return normalizeDecodedActionResult(body, meta);
      case "Redirect":
        return normalizeDecodedActionResult(body, meta);
    }
  });

export const decodeStartActionResponseEffect = <D extends StartActionDefinition>(
  definition: D,
  body: Extract<StartActionResponseBody, { readonly _tag: "Success" | "ValidationFailure" | "Redirect" | "Failure" }>
): Effect.Effect<
  StartActionResultFor<ActionDefinitionOutputValue<D>, ActionDefinitionErrorValue<D>>,
  Schema.SchemaError
> =>
  Effect.map(
    decodeActionOutputResultEffect(definition, body, startActionResponseMeta(body)),
    (decoded) => decoded as StartActionResultFor<
      ActionDefinitionOutputValue<D>,
      ActionDefinitionErrorValue<D>
    >
  );

const dieOnActionHydrationFailure = <E, R>(
  effect: Effect.Effect<void, E, R>
): Effect.Effect<void, never, R> =>
  effect.pipe(Effect.catch((error: E) => Effect.die(error)));

export const hydrateActionResponseEffect = <FetchError = never, RuntimeError = never>(
  body: StartActionResponseBody,
  options: StartActionClientOptions<FetchError, RuntimeError>
): Effect.Effect<void, never, unknown> => {
  const invalidationTargets = "invalidation" in body && body.invalidation
    ? body.invalidation.targets.flatMap((target): ReadonlyArray<ResourceInvalidation> =>
        target._tag === "Tag"
          ? [{
              [ResourceTagTypeId]: ResourceTagTypeId,
              name: target.name,
              key: target.key
            }]
          : []
      )
    : [];
  const hydrationKeys = new Set(
    "hydration" in body && body.hydration
      ? body.hydration.resources.map((resource) => resource.key)
      : []
  );
  const effect = Effect.gen(function* () {
    if ("hydration" in body && body.hydration !== undefined) {
      yield* hydrateStartPayloadEffect(body.hydration, options);
    }

    if (invalidationTargets.length > 0) {
      const plan = yield* Resource.planInvalidationEffect(invalidationTargets);
      yield* Resource.runInvalidationPlanEffect({
        targets: plan.targets,
        entries: plan.entries.filter((entry) => !hydrationKeys.has(entry.ref.key))
      });
    }
  });

  return options.runtime
    ? dieOnActionHydrationFailure(options.runtime.provide(effect))
    : dieOnActionHydrationFailure(effect);
};
