import {
  Server,
  ServerRpcProtocolError,
  type ActionDefinition
} from "@effect-ui/core";
import { Cause, Data, Effect, Exit, Schema } from "effect";
import {
  hasContentType,
  startJsonMediaType
} from "./rpc.js";
import {
  resolveStartActionEndpoint,
  type StartActionEndpointManifest,
  type StartActionEndpointSource,
  type StartTransportEndpointManifestSource,
  type StartTransportEndpointOverrides
} from "./start-transport-endpoints.js";
import {
  readStartTransportFormDataBodyEffect,
  readStartTransportJsonBodyEffect
} from "./start-transport-body.js";

/** JSON payload accepted by the Start action transport. */
export interface StartActionRequest {
  readonly name: string;
  readonly input: unknown;
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const readActionJsonEffect = (request: Request): Effect.Effect<StartActionRequest, ServerRpcProtocolError> =>
  Effect.gen(function* () {
    const payload = yield* readStartTransportJsonBodyEffect(
      request,
      "Expected a JSON server function request body."
    );
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
