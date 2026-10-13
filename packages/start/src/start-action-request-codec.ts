import { ActionProtocolError, Form, type Action, type Server } from "@sunfall/arc-core";
import { Cause, Data, Effect, Exit, Schema } from "effect";
import {
  hasContentType,
  startFormUrlEncodedMediaType,
  startMultipartFormDataMediaType,
} from "./rpc.js";
import {
  actionDefinitionRegistry,
  decodeFormValuesEffect,
  encodeActionWire,
  type CoreDefinitionRegistry,
} from "@sunfall/arc-core/internal";

/**
 * Serializes an `Error` into JSON-safe data: its name and message. The stack
 * stays on the server (it names server files and frames).
 */
export const serializeDefect = (defect: unknown): unknown =>
  defect instanceof Error ? { _tag: defect.name, message: defect.message } : defect;

const protocolBodyReadError = (message: string, cause: unknown): ActionProtocolError =>
  new ActionProtocolError({ message, payload: serializeDefect(cause) });

/** Longest submission id the action endpoint accepts. */
export const startActionSubmissionIdMaxLength = 128;

const StartActionRequestSchema = Schema.Struct({
  name: Schema.String,
  input: Schema.Unknown,
  /**
   * Durable submission id. The endpoint deduplicates by `name` and `id`, so
   * a replayed submission returns its original response.
   */
  id: Schema.optionalKey(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(startActionSubmissionIdMaxLength),
    ),
  ),
});

/** JSON payload accepted by the Start action transport. */
export type StartActionRequest = typeof StartActionRequestSchema.Type;

const isStartActionRequest = Schema.is(StartActionRequestSchema);

/** Hidden field emitted by `startActionForm(...)` for progressive HTML POSTs. */
export interface StartActionFormField {
  /** Hidden form field name. */
  readonly name: string;
  /** Serialized hidden form field value. */
  readonly value: string;
}

/**
 * Minimal HTML form description for progressive enhancement.
 *
 * Render `hiddenFields` into a `<form method="post">` without an `action`:
 * the browser posts it to the page it is on, where Start runs the Action
 * without client JavaScript. A redirect or success answers 303; a
 * validation failure or failure renders the same page again with the
 * Action's outcome and the posted fields.
 */
export interface StartActionForm {
  readonly method: "post";
  readonly hiddenFields: readonly StartActionFormField[];
}

/** Options used to build a progressive HTML form for a typed Start action. */
export interface StartActionFormOptions<I> {
  /** Partial input serialized into the hidden input field. */
  readonly input?: Partial<I>;
}

/** Any core action definition that can be exposed through Start actions. */
export type StartActionDefinition =
  | Action.Definition<any, any, never, any>
  | Action.Definition<any, any, any, any>;

/** Hidden form field that carries the action name for progressive POST forms. */
export const startActionNameField = "__sunfall_arc_action";
/** Hidden form field that carries the JSON-serialized action input. */
export const startActionInputField = "__sunfall_arc_input";

const startActionTransportFields = [startActionNameField, startActionInputField] as const;

const startActionOmittedFormFields = (
  omitFields: Form.DataOptions["omitFields"],
): ReadonlySet<string> => {
  const fields = new Set<string>(startActionTransportFields);

  if (omitFields !== undefined) {
    for (const field of omitFields) {
      fields.add(field);
    }
  }

  return fields;
};

/**
 * Build `Form.decodeFormData(...)` options that omit Start's hidden
 * transport fields while preserving any app-level omitted fields.
 */
export const startActionFormDataDecodeOptions = (
  options: Form.DataOptions = {},
): Form.DataOptions => ({
  ...options,
  omitFields: startActionOmittedFormFields(options.omitFields),
});

/** The encoded default input a `StartAction.form(...)` carries, or `{}` when it has none. */
const startActionFormDefaults = (formData: FormData): Record<string, unknown> => {
  const encoded = formData.get(startActionInputField);
  if (typeof encoded !== "string" || encoded.length === 0) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(encoded);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Decodes a Start action form's `FormData` into the Action's input the way the
 * server decodes the same form when it posts without JavaScript: the visible
 * fields merged over the encoded default input (`StartAction.form(action, {
 * input })`), read as the input schema's encoded shape (checkboxes, repeated
 * names, empty fields; see `Form.decodeFormData`), then decoded by it.
 *
 * So the enhanced submit and the no-JS post decode one form to one value.
 */
export const decodeStartActionFormData = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>,
  formData: FormData,
  options: Form.DataOptions = {},
): Effect.Effect<I, Form.ValidationError<Record<string, unknown>, Schema.SchemaError>> =>
  Effect.suspend(() => {
    const values = {
      ...startActionFormDefaults(formData),
      ...Form.data(formData, startActionFormDataDecodeOptions(options)),
    };
    return Schema.isSchema(definition.input)
      ? (decodeFormValuesEffect(definition.input as Schema.Top, values) as unknown as Effect.Effect<
          I,
          Form.ValidationError<Record<string, unknown>, Schema.SchemaError>
        >)
      : Effect.succeed(values as I);
  });

/** Error raised by the synchronous progressive form encoding facade. */
export class StartActionFormEncodeError extends Data.TaggedError("StartActionFormEncodeError")<{
  readonly actionName: string;
  readonly operation: "schema-encode" | "json-stringify";
  readonly input: unknown;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Encodes only the present fields of a struct schema; other schemas encode whole.
// Effect schemas are callable, so detect them with `Schema.isSchema`, not `typeof`.
const encodePartialWithSchema = (
  schema: unknown,
  input: unknown,
): Effect.Effect<unknown, Schema.SchemaError> => {
  const fields = Schema.isSchema(schema)
    ? (schema as { readonly fields?: unknown }).fields
    : undefined;
  if (!isRecord(fields) || !isRecord(input)) {
    return encodeActionWire(schema, input);
  }
  const present = Object.fromEntries(
    Object.keys(input).flatMap((key) => (Schema.isSchema(fields[key]) ? [[key, fields[key]]] : [])),
  ) as Schema.Struct.Fields;
  return Schema.encodeUnknownEffect(Schema.Struct(present))(input) as Effect.Effect<
    unknown,
    Schema.SchemaError
  >;
};

/** Encodes a Start action input through the action's declared wire schema. */
export const encodeStartActionInput = (
  action: StartActionDefinition,
  input: unknown,
): Effect.Effect<unknown, Schema.SchemaError> => encodeActionWire(action.input, input);

/** Encodes a partial Start action input through the present fields of a struct input schema. */
export const encodeStartActionPartialInput = (
  action: StartActionDefinition,
  input: unknown,
): Effect.Effect<unknown, Schema.SchemaError> => encodePartialWithSchema(action.input, input);

/** Builds the shared Start action JSON request body before transport stringification. */
export const encodeStartActionRequest = (
  action: StartActionDefinition,
  input: unknown,
  submissionId?: string,
): Effect.Effect<StartActionRequest, Schema.SchemaError> =>
  Effect.map(encodeStartActionInput(action, input), (encodedInput) => ({
    name: action.name,
    input: encodedInput,
    ...(submissionId === undefined ? {} : { id: submissionId }),
  }));

const startActionFormEncodeError = (
  action: StartActionDefinition,
  operation: StartActionFormEncodeError["operation"],
  input: unknown,
  cause: unknown,
): StartActionFormEncodeError =>
  new StartActionFormEncodeError({
    actionName: action.name,
    operation,
    input,
    cause,
    guidance:
      "Start action form defaults must encode through the action input schema and be JSON-serializable.",
  });

/** Encodes progressive form default input through the same action request codec used by JSON submits. */
export const encodeStartActionFormInput = (
  action: StartActionDefinition,
  input: unknown,
): Effect.Effect<string, StartActionFormEncodeError> =>
  Effect.gen(function* () {
    const encodedInput = yield* encodeStartActionPartialInput(action, input).pipe(
      Effect.mapError((cause) => startActionFormEncodeError(action, "schema-encode", input, cause)),
    );

    return yield* Effect.try({
      try: () => {
        const json = JSON.stringify(encodedInput);
        if (json === undefined) {
          throw {
            _tag: "StartActionFormJsonUndefined",
            message: "JSON.stringify returned undefined for a provided Start action form input.",
          };
        }
        return json;
      },
      catch: (cause) => startActionFormEncodeError(action, "json-stringify", encodedInput, cause),
    });
  });

const encodeStartActionFormInputSync = (action: StartActionDefinition, input: unknown): string => {
  const exit = Effect.runSyncExit(encodeStartActionFormInput(action, input));
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

/** Creates the hidden POST fields needed to submit a Start action from HTML. */
export const startActionForm = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>,
  options: StartActionFormOptions<I> = {},
): StartActionForm => ({
  method: "post",
  hiddenFields: [
    {
      name: startActionNameField,
      value: definition.name,
    },
    ...(options.input === undefined
      ? []
      : [
          {
            name: startActionInputField,
            value: encodeStartActionFormInputSync(definition, options.input),
          },
        ]),
  ],
});

const readActionJsonEffect = (
  request: Request,
): Effect.Effect<StartActionRequest, ActionProtocolError> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) => protocolBodyReadError("Expected a JSON action request body.", cause),
    }),
    (payload) =>
      isStartActionRequest(payload)
        ? Effect.succeed(payload)
        : Effect.fail(
            new ActionProtocolError({
              message: `Expected an action request with string name and input fields, and an optional id of 1 to ${startActionSubmissionIdMaxLength} characters.`,
              payload,
            }),
          ),
  );

/** Reads one JSON Start action request: `{ name, input, id? }`. */
export const readStartActionRequest = (
  request: Request,
): Effect.Effect<StartActionRequest, ActionProtocolError> => readActionJsonEffect(request);

/** A no-JavaScript form post of a Start action, as read from its body. */
export interface StartActionFormPost {
  /** The posted Action's name (`startActionNameField`). */
  readonly name: string;
  /** The visible fields as posted: strings, a repeated name as an array, a file by its name. */
  readonly values: Readonly<Record<string, string | ReadonlyArray<string>>>;
  /** The encoded default input (`startActionInputField`), or `{}`. */
  readonly defaults: Readonly<Record<string, unknown>>;
}

/** True when a request is a form post to a page (a no-JavaScript Action submission). */
export const isStartActionFormPost = (request: Request): boolean =>
  request.method === "POST" &&
  hasContentType(request.headers, [startFormUrlEncodedMediaType, startMultipartFormDataMediaType]);

/** Reads a no-JavaScript Action form post: the Action's name, its fields, and its defaults. */
export const readStartActionFormPost = (
  request: Request,
): Effect.Effect<StartActionFormPost, ActionProtocolError> =>
  Effect.gen(function* () {
    const formData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: (cause) => protocolBodyReadError("Expected an action form body.", cause),
    });
    const name = formData.get(startActionNameField);
    if (typeof name !== "string" || name.length === 0) {
      return yield* new ActionProtocolError({
        message: `Missing ${startActionNameField} form field.`,
      });
    }
    return {
      name,
      values: Form.data(formData, startActionFormDataDecodeOptions({ file: "name" })) as Record<
        string,
        string | ReadonlyArray<string>
      >,
      defaults: startActionFormDefaults(formData),
    };
  });

/**
 * Decodes a no-JavaScript form post into the Action's input: its fields
 * merged over its defaults, read as the input schema's encoded shape, then
 * decoded. A schema failure is the form's validation failure.
 */
export const decodeStartActionFormPost = <I, A, E, R>(
  definition: Action.Definition<I, A, E, R>,
  post: StartActionFormPost,
): Effect.Effect<I, Form.ValidationError<Record<string, unknown>, Schema.SchemaError>> =>
  Schema.isSchema(definition.input)
    ? (decodeFormValuesEffect(definition.input as Schema.Top, {
        ...post.defaults,
        ...post.values,
      }) as unknown as Effect.Effect<
        I,
        Form.ValidationError<Record<string, unknown>, Schema.SchemaError>
      >)
    : Effect.succeed({ ...post.defaults, ...post.values } as I);

/** Error raised when multiple Start actions use the same public action name. */
export class StartActionDuplicateName extends Data.TaggedError("StartActionDuplicateName")<{
  readonly actionName: string;
  readonly first: number;
  readonly duplicate: number;
  readonly message: string;
}> {}

export type StartActionMap<Actions extends StartActionDefinition = StartActionDefinition> =
  ReadonlyMap<string, Actions>;

export type StartActionSource<Actions extends StartActionDefinition = StartActionDefinition> =
  | Iterable<Actions>
  | StartActionMap<Actions>;

const isStartActionMap = <Actions extends StartActionDefinition>(
  actions: StartActionSource<Actions>,
): actions is StartActionMap<Actions> =>
  typeof (actions as { readonly get?: unknown }).get === "function" &&
  typeof (actions as { readonly has?: unknown }).has === "function" &&
  typeof (actions as { readonly forEach?: unknown }).forEach === "function";

export const materializeStartActionMap = <Actions extends StartActionDefinition>(
  actions: Iterable<Actions>,
): StartActionMap<Actions> => {
  const actionMap = new Map<string, Actions>();
  const firstIndexes = new Map<string, number>();
  let index = 0;
  for (const action of actions) {
    const first = firstIndexes.get(action.name);
    if (first !== undefined) {
      throw new StartActionDuplicateName({
        actionName: action.name,
        first,
        duplicate: index,
        message: `Duplicate Start action name: ${action.name}`,
      });
    }
    actionMap.set(action.name, action);
    firstIndexes.set(action.name, index);
    index++;
  }

  return actionMap;
};

export const makeActionMap = <Actions extends StartActionDefinition = StartActionDefinition>(
  actions?: StartActionSource<Actions>,
  registry?: CoreDefinitionRegistry<Actions, Server.Fn<any, any, any, any>>,
): StartActionMap<Actions> => {
  if (actions === undefined) {
    return (registry?.actions ?? actionDefinitionRegistry()) as StartActionMap<Actions>;
  }

  return isStartActionMap(actions) ? actions : materializeStartActionMap(actions);
};
