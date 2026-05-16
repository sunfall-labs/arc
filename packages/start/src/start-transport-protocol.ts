import {
  Action,
  ActionResult,
  type CoreDefinitionRegistry,
  isResourceRef,
  isResourceTag,
  Resource,
  Server,
  ServerFunctionNotFound,
  ServerRpcProtocolError,
  ServerTransportError,
  type ActionDefinition,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type FormFieldErrors,
  type ResourceInvalidationCause,
  type ResourceInvalidationPlan,
  type ResourceSnapshotCodecError,
  type ServerFunction
} from "@effect-ui/core";
import { Cause, Data, Effect, Exit, Schema } from "effect";
import {
  createStartHydrationPayload,
  type StartCollectionHydrationOptions,
  type StartHydrationPayload
} from "./hydration.js";
import {
  hasContentType,
  negotiateAcceptedMediaType,
  startHtmlMediaType,
  startJsonMediaType,
  validateStartActionResponseEffect,
  validateStartRpcResponseEffect,
  type StartTransportRequestError
} from "./rpc.js";
import {
  isStartActionEndpointRequest,
  isStartRpcEndpointRequest,
  resolveStartActionEndpoint,
  type StartActionEndpointManifest,
  type StartActionEndpointSource,
  type StartTransportEndpointOverrides,
  type StartTransportEndpointManifestSource,
  type StartTransportEndpointSource
} from "./start-transport-endpoints.js";
import {
  readStartTransportFormDataBodyEffect,
  readStartTransportJsonBodyEffect,
  readStartTransportResponseTextEffect
} from "./start-transport-body.js";
import type { StartRequestTraceFailureKind } from "./request-trace.js";
import type { ServerRpcClientOptions } from "./start-fetch.js";

export {
  applyStartActionResponseEffect,
  hydrateActionResponseEffect
} from "./start-action-response-application.js";

/**
 * Options for clients that submit Start actions.
 *
 * Extends RPC options with optional collection hydration settings. Supplying a
 * runtime runs action response hydration in that runtime.
 */
export interface StartActionClientOptions<
  FetchError = never,
  FetchRequirements = never,
  RuntimeError = never
> extends ServerRpcClientOptions<FetchError, FetchRequirements, RuntimeError>,
    Pick<
      StartActionEndpointSource,
      "actionPath" | "actionManifest" | "appGraph" | "endpoints"
    >,
    StartCollectionHydrationOptions {
  /**
   * Runtime used for action response hydration and, when `transportRuntime` is
   * omitted, for fetch Effects that require services.
   */
  readonly runtime?: EffectUiRuntime<FetchRequirements, RuntimeError> | AnyEffectUiRuntime<RuntimeError>;
}

/** JSON payload accepted by the Start action transport. */
export interface StartActionRequest {
  readonly name: string;
  readonly input: unknown;
}

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

/** Extracts the input value type from a core `ActionDefinition`. */
export type ActionDefinitionInputValue<D> =
  D extends ActionDefinition<infer I, infer _A, infer _E, infer _R> ? I : never;

/** Extracts the output value type from a core `ActionDefinition`. */
export type ActionDefinitionOutputValue<D> =
  D extends ActionDefinition<infer _I, infer A, infer _E, infer _R> ? A : never;

/** Extracts the error value type from a core `ActionDefinition`. */
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
  /** Hidden form field name. */
  readonly name: string;
  /** Serialized hidden form field value. */
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
  /** Form action URL. Defaults to the Start action endpoint. */
  readonly action?: string;
  /** Action endpoint path. Defaults to the shared Start action path. */
  readonly actionPath?: string;
  /** Endpoint pair resolved from the Start transport endpoint policy. */
  readonly endpoints?: StartTransportEndpointOverrides;
  /** Action manifest whose `actionPath` should be used when no explicit action is supplied. */
  readonly actionManifest?: StartActionEndpointManifest;
  /** App graph whose action manifest should supply the action path. */
  readonly appGraph?: StartTransportEndpointManifestSource;
  /** Partial input serialized into the hidden input field. */
  readonly input?: Partial<I>;
}

/** Any core action definition that can be exposed through Start actions. */
export type StartActionDefinition =
  | ActionDefinition<any, any, never, any>
  | ActionDefinition<any, any, any, any>;

/** Hidden form field that carries the action name for progressive POST forms. */
export const startActionNameField = "__effect_ui_action";
/** Hidden form field that carries the JSON-serialized action input. */
export const startActionInputField = "__effect_ui_input";

/** Error raised by the synchronous progressive form encoding facade. */
export class StartActionFormEncodeError extends Data.TaggedError(
  "StartActionFormEncodeError"
)<{
  readonly actionName: string;
  readonly operation: "schema-encode" | "json-stringify";
  readonly input: unknown;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

/** True when a request targets the Start server-function RPC endpoint. */
export const isServerRpcRequest = (
  request: Request,
  endpoints?: StartTransportEndpointSource
): boolean =>
  isStartRpcEndpointRequest(request, endpoints);

/** True when a request targets the Start action endpoint. */
export const isServerActionRequest = (
  request: Request,
  endpoints?: StartTransportEndpointSource
): boolean =>
  isStartActionEndpointRequest(request, endpoints);

/** Creates the hidden POST fields needed to submit a Start action from HTML. */
export const startActionForm = <I, A, E, R>(
  definition: ActionDefinition<I, A, E, R>,
  options: StartActionFormOptions<I> = {}
): StartActionForm => ({
  method: "post",
  action: String(resolveStartActionEndpoint(options)),
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
            value: encodeStartActionFormInput(definition, options.input)
          }
        ])
  ]
});

type StartTransportJsonBody = Server.RpcResponse | StartActionResponseBody;

const startTransportDefectBody = (cause: unknown): Extract<Server.RpcResponse, { readonly _tag: "Defect" }> => ({
  _tag: "Defect",
  defect: Server.serializeDefect(cause)
});

const startTransportJson = (body: StartTransportJsonBody, status = 200): Response =>
  {
    const headers = {
      "content-type": startJsonMediaType
    };

    try {
      return new Response(JSON.stringify(body), { status, headers });
    } catch (cause) {
      return new Response(JSON.stringify(startTransportDefectBody(cause)), {
        status: 500,
        headers
      });
    }
  };

const rpcJson = (body: Server.RpcResponse, status = 200): Response =>
  startTransportJson(body, status);

const actionJson = (body: StartActionResponseBody, status = 200): Response =>
  startTransportJson(body, status);

export const readJsonEffect = (request: Request): Effect.Effect<unknown, ServerRpcProtocolError> =>
  readStartTransportJsonBodyEffect(
    request,
    "Expected a JSON server function request body."
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasOwn = (
  value: Record<string, unknown>,
  key: string
): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

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

const structSchemaFields = (
  schema: unknown
): Record<string, unknown> | undefined => {
  const fields = isRecord(schema) ? schema.fields : undefined;
  return isRecord(fields) ? fields : undefined;
};

const encodePartialWithSchema = (
  schema: unknown,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> => {
  const fields = structSchemaFields(schema);
  if (!Schema.isSchema(schema) || fields === undefined || !isRecord(input)) {
    return encodeWithSchema(schema, input);
  }

  const presentFields: Record<string, Schema.Schema<unknown>> = {};
  for (const key of Object.keys(input)) {
    const field = fields[key];
    if (Schema.isSchema(field)) {
      presentFields[key] = field as Schema.Schema<unknown>;
    }
  }

  return Schema.encodeUnknownEffect(Schema.Struct(presentFields))(input) as Effect.Effect<unknown, Schema.SchemaError>;
};

/** Encodes a Start action input through the action's declared wire schema. */
export const encodeStartActionInputEffect = (
  action: StartActionDefinition,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodeWithSchema(action.input, input);

/** Encodes a partial Start action input through the present fields of a struct input schema. */
export const encodeStartActionPartialInputEffect = (
  action: StartActionDefinition,
  input: unknown
): Effect.Effect<unknown, Schema.SchemaError> =>
  encodePartialWithSchema(action.input, input);

/** Builds the shared Start action JSON request body before transport stringification. */
export const encodeStartActionRequestEffect = (
  action: StartActionDefinition,
  input: unknown
): Effect.Effect<StartActionRequest, Schema.SchemaError> =>
  Effect.map(encodeStartActionInputEffect(action, input), (encodedInput) => ({
    name: action.name,
    input: encodedInput
  }));

const startActionFormEncodeError = (
  action: StartActionDefinition,
  operation: StartActionFormEncodeError["operation"],
  input: unknown,
  cause: unknown
): StartActionFormEncodeError =>
  new StartActionFormEncodeError({
    actionName: action.name,
    operation,
    input,
    cause,
    guidance: "Start action form defaults must encode through the action input schema and be JSON-serializable."
  });

/** Encodes progressive form default input through the same action request codec used by JSON submits. */
export const encodeStartActionFormInputEffect = (
  action: StartActionDefinition,
  input: unknown
): Effect.Effect<string, StartActionFormEncodeError> =>
  Effect.gen(function* () {
    const encodedInput = yield* encodeStartActionPartialInputEffect(action, input).pipe(
      Effect.mapError((cause) => startActionFormEncodeError(action, "schema-encode", input, cause))
    );

    return yield* Effect.try({
      try: () => {
        const json = JSON.stringify(encodedInput);
        if (json === undefined) {
          throw {
            _tag: "StartActionFormJsonUndefined",
            message: "JSON.stringify returned undefined for a provided Start action form input."
          };
        }
        return json;
      },
      catch: (cause) => startActionFormEncodeError(action, "json-stringify", encodedInput, cause)
    });
  });

const encodeStartActionFormInput = (
  action: StartActionDefinition,
  input: unknown
): string => {
  const exit = Effect.runSyncExit(encodeStartActionFormInputEffect(action, input));
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
  if (failure !== undefined) {
    throw failure;
  }

  throw startActionFormEncodeError(action, "schema-encode", input, Cause.squash(exit.cause));
};

const serverErrorBody = (
  error: ServerRpcProtocolError | ServerFunctionNotFound
): Extract<Server.RpcResponse, { readonly _tag: "ServerError" }> => ({
  _tag: "ServerError",
  error: Server.serializeServerError(error)
});

const defectBody = (
  defect: unknown
): Extract<Server.RpcResponse, { readonly _tag: "Defect" }> => ({
  _tag: "Defect",
  defect: Server.serializeDefect(defect)
});

const startTransportRuntimeFailureResponse = <Body extends Extract<StartTransportJsonBody, { readonly _tag: "Defect" }>>(
  json: (body: Body, status?: number) => Response,
  error: unknown
): Response => json(defectBody(error) as Body, 500);

const startTransportProtocolFailureResponse = <Body extends Extract<StartTransportJsonBody, { readonly _tag: "ServerError" }>>(
  json: (body: Body, status?: number) => Response,
  error: ServerRpcProtocolError,
  status = 400
): Response => json(serverErrorBody(error) as Body, status);

const startTransportFunctionNotFoundResponse = <Body extends Extract<StartTransportJsonBody, { readonly _tag: "ServerError" }>>(
  json: (body: Body, status?: number) => Response,
  functionName: string
): Response =>
  json(serverErrorBody(new ServerFunctionNotFound({ functionName })) as Body, 404);

export const rpcRuntimeFailureResponse = (error: unknown): Response =>
  startTransportRuntimeFailureResponse(rpcJson, error);

export const actionRuntimeFailureResponse = (error: unknown): Response =>
  startTransportRuntimeFailureResponse(actionJson, error);

export const actionProtocolFailureResponse = (
  error: ServerRpcProtocolError,
  status = 400
): Response => startTransportProtocolFailureResponse(actionJson, error, status);

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
  startTransportFunctionNotFoundResponse(actionJson, actionName);

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
    const formData = yield* readStartTransportFormDataBodyEffect(
      request,
      "Expected an action form body."
    );
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

export class StartActionDuplicateName extends Data.TaggedError("StartActionDuplicateName")<{
  readonly actionName: string;
  readonly first: number;
  readonly duplicate: number;
  readonly message: string;
}> {}

export const makeActionMap = (
  actions?: Iterable<StartActionDefinition>,
  registry?: CoreDefinitionRegistry<StartActionDefinition, ServerFunction<any, any, any, any>>
): ReadonlyMap<string, StartActionDefinition> => {
  if (actions === undefined) {
    return registry?.actions ?? Action.definitions();
  }

  const actionMap = new Map<string, StartActionDefinition>();
  const firstIndexes = new Map<string, number>();
  let index = 0;
  for (const action of actions) {
    const first = firstIndexes.get(action.name);
    if (first !== undefined) {
      throw new StartActionDuplicateName({
        actionName: action.name,
        first,
        duplicate: index,
        message: `Duplicate Start action name: ${action.name}`
      });
    }
    actionMap.set(action.name, action);
    firstIndexes.set(action.name, index);
    index++;
  }

  return actionMap;
};

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
  startTransportProtocolFailureResponse(rpcJson, error, status);

export const rpcTransportRequestFailureResponse = (
  error: StartTransportRequestError
): Response =>
  withTransportRequestErrorHeaders(
    protocolFailureResponse(error.error, error.status),
    error
  );

export const functionNotFoundResponse = (functionName: string): Response =>
  startTransportFunctionNotFoundResponse(rpcJson, functionName);

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
  target: ResourceInvalidationPlan<any>["targets"][number]
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
  plan: ResourceInvalidationPlan<any>
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
  plan: ResourceInvalidationPlan<any> | undefined
): Effect.Effect<StartActionResponseMeta, ResourceSnapshotCodecError> =>
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
  hasContentType(request.headers, [startJsonMediaType]) ||
    negotiateAcceptedMediaType(request.headers, [startHtmlMediaType, startJsonMediaType]) === startJsonMediaType
    ? "json"
    : "redirect";

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
    const text = yield* readStartTransportResponseTextEffect(
      response,
      "Could not read the server function response body."
    );
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

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

const isStartActionResponseBody = (value: unknown): value is StartActionResponseBody => {
  if (!isRecord(value) || !isStartActionResponseMeta(value)) {
    return false;
  }

  switch (value._tag) {
    case "Success":
      return hasOwn(value, "value");
    case "ValidationFailure":
      return hasOwn(value, "fieldErrors") &&
        Array.isArray(value.formErrors);
    case "Redirect":
      return typeof value.location === "string" &&
        Number.isInteger(value.status) &&
        (value.headers === undefined || isStringRecord(value.headers)) &&
        (value.replace === undefined || typeof value.replace === "boolean");
    case "Failure":
    case "ServerError":
      return hasOwn(value, "error");
    case "Defect":
      return hasOwn(value, "defect");
    default:
      return false;
  }
};

const isStartActionInvalidationTarget = (value: unknown): value is StartActionInvalidationTarget => {
  if (!isRecord(value)) {
    return false;
  }

  if (value._tag === "Ref") {
    return typeof value.key === "string" &&
      typeof value.family === "string" &&
      hasOwn(value, "input");
  }

  return value._tag === "Tag" &&
    typeof value.key === "string" &&
    typeof value.name === "string";
};

const isStartActionInvalidationCause = (value: unknown): value is StartActionInvalidationCause => {
  if (!isRecord(value)) {
    return false;
  }

  if (value._tag === "Ref") {
    return typeof value.key === "string" &&
      typeof value.family === "string";
  }

  return value._tag === "Tag" &&
    typeof value.key === "string" &&
    typeof value.name === "string";
};

const isStartActionInvalidationPlan = (value: unknown): value is StartActionInvalidationPlan => {
  if (!isRecord(value) || !Array.isArray(value.targets) || !Array.isArray(value.entries)) {
    return false;
  }

  return value.targets.every(isStartActionInvalidationTarget) &&
    value.entries.every((entry) =>
      isRecord(entry) &&
      isRecord(entry.ref) &&
      typeof entry.ref.key === "string" &&
      typeof entry.ref.family === "string" &&
      hasOwn(entry.ref, "input") &&
      Array.isArray(entry.causes) &&
      entry.causes.every(isStartActionInvalidationCause)
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
  response: Response
): Effect.Effect<StartActionResponseBody, ServerTransportError> =>
  Effect.gen(function* () {
    yield* validateStartActionResponseEffect(response);
    const text = yield* readStartTransportResponseTextEffect(
      response,
      "Could not read the action response body."
    );
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
