import { Data, Effect, Schema, type SchemaIssue } from "effect";
import type { EffectInput } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { runPromise } from "./runtime.js";
import { Signal, type ReadableSignal } from "./signal.js";

export const FormTypeId: unique symbol = Symbol.for("@effect-ui/core/Form") as never;

export type FormFieldKey<Values extends object> = Extract<keyof Values, string>;

export type FormFieldFlags<Values extends object> = Partial<
  Record<FormFieldKey<Values>, boolean>
>;

export type FormFieldErrors<Values extends object, E = unknown> = Partial<
  Record<FormFieldKey<Values>, ReadonlyArray<E>>
>;

export type FormSchemaValues<S extends Schema.Top> = Schema.Schema.Type<S> extends object
  ? Schema.Schema.Type<S>
  : never;

export type FormSchemaServices<S extends Schema.Top> = Schema.Codec.DecodingServices<S>;

export interface FormValidationTools<Values extends object, E> {
  field<K extends FormFieldKey<Values>>(
    field: K,
    error: E
  ): FormValidationError<Values, E>;
  fields(fieldErrors: FormFieldErrors<Values, E>): FormValidationError<Values, E>;
  form(error: E): FormValidationError<Values, E>;
}

export type FormStatus = "Idle" | "Validating" | "Valid" | "Invalid";

export interface FormState<Values extends object, E = unknown> {
  readonly status: FormStatus;
  readonly initial: Values;
  readonly values: Values;
  readonly fieldErrors: FormFieldErrors<Values, E>;
  readonly formErrors: ReadonlyArray<E>;
  readonly dirty: FormFieldFlags<Values>;
  readonly touched: FormFieldFlags<Values>;
}

export interface FormOptions<
  S extends Schema.Top,
  Values extends FormSchemaValues<S>,
  E = never,
  R = never
> {
  readonly schema: S;
  readonly initial: Values;
  readonly validate?: (
    values: Values,
    tools: FormValidationTools<Values, E>
  ) => EffectInput<void, FormValidationError<Values, E>, R>;
}

export interface FormInstance<Values extends object, E = never, R = never> {
  readonly [FormTypeId]: typeof FormTypeId;
  readonly state: ReadableSignal<FormState<Values, E | Schema.SchemaError>>;
  setField<K extends FormFieldKey<Values>>(field: K, value: Values[K]): void;
  touchField<K extends FormFieldKey<Values>>(field: K): void;
  reset(values?: Values): void;
  validateEffect(): Effect.Effect<
    Values,
    FormValidationError<Values, E | Schema.SchemaError>,
    R
  >;
  validate(): Promise<Values>;
}

export class FormValidationError<
  Values extends object = Record<string, unknown>,
  E = unknown
> extends Data.TaggedError("FormValidationError")<{
  readonly fieldErrors: FormFieldErrors<Values, E>;
  readonly formErrors: ReadonlyArray<E>;
  readonly cause: unknown | undefined;
}> {}

const emptyState = <Values extends object, E>(
  initial: Values,
  status: FormStatus = "Idle"
): FormState<Values, E> => ({
  status,
  initial,
  values: initial,
  fieldErrors: {},
  formErrors: [],
  dirty: {},
  touched: {}
});

const setFlag = <Values extends object>(
  flags: FormFieldFlags<Values>,
  field: FormFieldKey<Values>,
  value: boolean
): FormFieldFlags<Values> => ({
  ...flags,
  [field]: value
});

const clearFieldError = <Values extends object, E>(
  fieldErrors: FormFieldErrors<Values, E>,
  field: FormFieldKey<Values>
): FormFieldErrors<Values, E> => {
  if (!(field in fieldErrors)) {
    return fieldErrors;
  }

  const next: Partial<Record<FormFieldKey<Values>, ReadonlyArray<E>>> = {
    ...fieldErrors
  };
  delete next[field];
  return next;
};

const appendFieldError = <Values extends object, E>(
  fieldErrors: Partial<Record<FormFieldKey<Values>, Array<E>>>,
  field: FormFieldKey<Values>,
  error: E
): void => {
  const current = fieldErrors[field] ?? [];
  current.push(error);
  fieldErrors[field] = current;
};

const singleFieldError = <Values extends object, E>(
  field: FormFieldKey<Values>,
  error: E
): FormFieldErrors<Values, E> => {
  const fieldErrors: Partial<Record<FormFieldKey<Values>, Array<E>>> = {};
  appendFieldError(fieldErrors, field, error);
  return fieldErrors;
};

const makeError = <Values extends object, E>(
  fieldErrors: FormFieldErrors<Values, E>,
  formErrors: ReadonlyArray<E> = [],
  cause?: unknown
): FormValidationError<Values, E> =>
  new FormValidationError({
    fieldErrors,
    formErrors,
    cause
  });

const validationTools = <Values extends object, E>(): FormValidationTools<Values, E> => ({
  field: (field, error) =>
    makeError<Values, E>(singleFieldError(field, error)),
  fields: (fieldErrors) => makeError(fieldErrors),
  form: (error) => makeError({}, [error])
});

const issuePaths = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = []
): ReadonlyArray<ReadonlyArray<PropertyKey>> => {
  switch (issue._tag) {
    case "Pointer":
      return issuePaths(issue.issue, [...path, ...issue.path]);
    case "Filter":
    case "Encoding":
      return issuePaths(issue.issue, path);
    case "Composite":
    case "AnyOf":
      return issue.issues.flatMap((child) => issuePaths(child, path));
    case "InvalidType":
    case "InvalidValue":
    case "MissingKey":
    case "UnexpectedKey":
    case "Forbidden":
    case "OneOf":
      return path.length === 0 ? [] : [path];
  }
};

const fieldErrorsFromSchemaError = <Values extends object>(
  error: Schema.SchemaError
): FormValidationError<Values, Schema.SchemaError> => {
  const fieldErrors: Partial<Record<FormFieldKey<Values>, Array<Schema.SchemaError>>> = {};
  const formErrors: Array<Schema.SchemaError> = [];
  const paths = issuePaths(error.issue);

  if (paths.length === 0) {
    formErrors.push(error);
  }

  for (const path of paths) {
    const field = path[0];
    if (typeof field === "string") {
      appendFieldError(fieldErrors, field as FormFieldKey<Values>, error);
    } else {
      formErrors.push(error);
    }
  }

  return makeError(fieldErrors, formErrors, error);
};

const normalizeValidationError = <Values extends object, E>(
  error: FormValidationError<Values, E> | FormValidationError<Values, Schema.SchemaError>
): FormValidationError<Values, E | Schema.SchemaError> =>
  makeError(
    error.fieldErrors as FormFieldErrors<Values, E | Schema.SchemaError>,
    error.formErrors as ReadonlyArray<E | Schema.SchemaError>,
    error.cause
  );

export const isForm = (value: unknown): value is FormInstance<object, unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [FormTypeId]?: unknown })[FormTypeId] === FormTypeId;

export namespace Form {
  export type FieldKey<Values extends object> = FormFieldKey<Values>;
  export type FieldFlags<Values extends object> = FormFieldFlags<Values>;
  export type FieldErrors<Values extends object, E = unknown> = FormFieldErrors<Values, E>;
  export type Status = FormStatus;
  export type State<Values extends object, E = unknown> = FormState<Values, E>;
  export type Instance<Values extends object, E = never, R = never> = FormInstance<
    Values,
    E,
    R
  >;
  export type ValidationTools<Values extends object, E> = FormValidationTools<Values, E>;
  export type ValidationError<Values extends object, E = unknown> = FormValidationError<
    Values,
    E
  >;

  export const error = makeError;

  export const fieldError = <Values extends object, K extends FormFieldKey<Values>, E>(
    field: K,
    error: E
  ): FormValidationError<Values, E> =>
    makeError(singleFieldError(field, error));

  export const make = <
    S extends Schema.Top,
    E = never,
    R = never,
    Values extends FormSchemaValues<S> = FormSchemaValues<S>
  >(
    options: FormOptions<S, Values, E, R>
  ): FormInstance<Values, E, R | FormSchemaServices<S>> => {
    const state = Signal.make<FormState<Values, E | Schema.SchemaError>>(
      emptyState<Values, E | Schema.SchemaError>(options.initial)
    );

    const setField = <K extends FormFieldKey<Values>>(field: K, value: Values[K]): void => {
      state.update((current) => ({
        ...current,
        status: "Idle",
        values: {
          ...current.values,
          [field]: value
        } as Values,
        fieldErrors: clearFieldError(current.fieldErrors, field),
        dirty: setFlag(current.dirty, field, !Object.is(current.initial[field], value)),
        touched: setFlag(current.touched, field, true)
      }));
    };

    const touchField = <K extends FormFieldKey<Values>>(field: K): void => {
      state.update((current) => ({
        ...current,
        touched: setFlag(current.touched, field, true)
      }));
    };

    const reset = (values: Values = state.get().initial): void => {
      state.set(emptyState<Values, E | Schema.SchemaError>(values));
    };

    const validateEffect = (): Effect.Effect<
      Values,
      FormValidationError<Values, E | Schema.SchemaError>,
      R | FormSchemaServices<S>
    > =>
      Effect.gen(function* () {
        state.update((current) => ({
          ...current,
          status: "Validating"
        }));

        const decoded = yield* (
          Schema.decodeUnknownEffect(options.schema)(state.get().values, {
            errors: "all"
          }) as Effect.Effect<Values, Schema.SchemaError, FormSchemaServices<S>>
        ).pipe(
          Effect.catch((schemaError) =>
            Effect.fail(normalizeValidationError(fieldErrorsFromSchemaError<Values>(schemaError)))
          )
        );

        if (options.validate) {
          yield* toEffect(options.validate(decoded, validationTools<Values, E>())).pipe(
            Effect.catch((error) => Effect.fail(normalizeValidationError(error)))
          );
        }

        state.update((current) => ({
          ...current,
          status: "Valid",
          values: decoded,
          fieldErrors: {},
          formErrors: []
        }));

        return decoded;
      }).pipe(
        Effect.catch((error: FormValidationError<Values, E | Schema.SchemaError>) =>
          Effect.sync(() => {
            state.update((current) => ({
              ...current,
              status: "Invalid",
              fieldErrors: error.fieldErrors,
              formErrors: error.formErrors
            }));
            return error;
          }).pipe(Effect.flatMap(Effect.fail))
        )
      );

    return {
      [FormTypeId]: FormTypeId,
      state,
      setField,
      touchField,
      reset,
      validateEffect,
      validate: () => runPromise(validateEffect())
    };
  };

  export const validateEffect = <Values extends object, E, R>(
    form: FormInstance<Values, E, R>
  ): Effect.Effect<Values, FormValidationError<Values, E | Schema.SchemaError>, R> =>
    form.validateEffect();

  export const validate = <Values extends object, E>(
    form: FormInstance<Values, E, never>
  ): Promise<Values> => form.validate();
}
