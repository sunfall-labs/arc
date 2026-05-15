import { Effect, type Schema } from "effect";
import type { EffectInput, EffectInputCallbackError } from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import {
  FormValidationError,
  type FormFieldErrors,
  type FormFieldKey,
  type FormInstance
} from "./form.js";
import type { ResourceInvalidation } from "./resource.js";

export const ActionResultTypeId: unique symbol = Symbol.for(
  "@effect-ui/core/ActionResult"
) as typeof ActionResultTypeId;

/** HTTP redirect statuses supported by Start action redirects. */
export type ActionRedirectStatus = 303 | 307 | 308;

/** Shared metadata carried by action results. */
export interface ActionResultOptions<R = never> {
  /** Resources or tags to invalidate after the action result is accepted. */
  readonly invalidates?: ReadonlyArray<ResourceInvalidation<R>>;
}

/** Options for an action result that redirects the client. */
export interface ActionResultRedirectOptions<R = never> extends ActionResultOptions<R> {
  /** Redirect status. Defaults to `303`, which turns form posts into a GET navigation. */
  readonly status?: ActionRedirectStatus;
  /** Extra headers to attach to the redirect response. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Hint for clients that track history: replace the current entry instead of pushing one. */
  readonly replace?: boolean;
}

/** Input used to build a field/form validation failure result. */
export interface ActionResultValidationInput<Values extends object, E> {
  /** Per-field errors keyed by known form field names. */
  readonly fieldErrors?: FormFieldErrors<Values, E>;
  /** Errors that apply to the whole form rather than one field. */
  readonly formErrors?: ReadonlyArray<E>;
  /** Original validation cause retained for diagnostics. */
  readonly cause?: unknown;
}

/** Common marker and invalidation metadata shared by every action result variant. */
export interface ActionResultBase<Tag extends string, R = never> {
  readonly [ActionResultTypeId]: typeof ActionResultTypeId;
  readonly _tag: Tag;
  readonly invalidates?: ReadonlyArray<ResourceInvalidation<R>>;
}

/** Successful action result, optionally carrying resource invalidations. */
export interface ActionResultSuccess<A, R = never> extends ActionResultBase<"Success", R> {
  readonly value: A;
}

/** Validation failure result that can be rendered by form UIs without throwing. */
export interface ActionResultValidationFailure<Values extends object, E, R = never>
  extends ActionResultBase<"ValidationFailure", R> {
  readonly fieldErrors: FormFieldErrors<Values, E>;
  readonly formErrors: ReadonlyArray<E>;
  readonly cause: unknown | undefined;
}

/** Redirect result for progressive actions and Start form submissions. */
export interface ActionResultRedirect<R = never> extends ActionResultBase<"Redirect", R> {
  readonly location: string;
  readonly status: ActionRedirectStatus;
  readonly headers?: Readonly<Record<string, string>>;
  readonly replace?: boolean;
}

/** Typed domain failure result produced by action workflows. */
export interface ActionResultFailure<E, R = never> extends ActionResultBase<"Failure", R> {
  readonly error: E;
}

/** Non-success action result variants that callers can handle explicitly. */
export type ActionResultBoundary<
  Values extends object = never,
  ValidationError = never,
  E = never,
  R = never
> =
  | ActionResultValidationFailure<Values, ValidationError, R>
  | ActionResultRedirect<R>
  | ActionResultFailure<E, R>;

/** Serializable action outcome used by core actions and Start action transports. */
export type ActionResult<
  A,
  Values extends object = never,
  ValidationError = never,
  E = never,
  R = never
> =
  | ActionResultSuccess<A, R>
  | ActionResultBoundary<Values, ValidationError, E, R>;

export type AnyActionResult =
  | ActionResultSuccess<unknown, any>
  | ActionResultValidationFailure<Record<string, unknown>, unknown, any>
  | ActionResultRedirect<any>
  | ActionResultFailure<unknown, any>;

type IsAny<T> = 0 extends (1 & T) ? true : false;

export type ActionResultInvalidationRequirements<Value> =
  Value extends {
    readonly [ActionResultTypeId]: typeof ActionResultTypeId;
    readonly invalidates?: ReadonlyArray<ResourceInvalidation<infer R>>;
  }
    ? IsAny<R> extends true ? never : R
    : never;

type WithActionResultInvalidation<Result, R> =
  Result extends ActionResultSuccess<infer A, infer Existing>
    ? ActionResultSuccess<A, Existing | R>
    : Result extends ActionResultValidationFailure<infer Values, infer E, infer Existing>
      ? ActionResultValidationFailure<Values, E, Existing | R>
      : Result extends ActionResultRedirect<infer Existing>
        ? ActionResultRedirect<Existing | R>
        : Result extends ActionResultFailure<infer E, infer Existing>
          ? ActionResultFailure<E, Existing | R>
          : Result;

/** Exhaustive matcher callbacks for an `ActionResult`. */
export interface ActionResultMatch<
  A,
  Values extends object,
  ValidationError,
  E,
  B,
  R = never
> {
  readonly success: (value: A, result: ActionResultSuccess<A, R>) => B;
  readonly validation: (
    failure: ActionResultValidationFailure<Values, ValidationError, R>
  ) => B;
  readonly redirect: (redirect: ActionResultRedirect<R>) => B;
  readonly failure: (error: E, result: ActionResultFailure<E, R>) => B;
}

const optionalInvalidates = (
  options: ActionResultOptions<any> = {}
): Pick<ActionResultBase<string, any>, "invalidates"> =>
  options.invalidates && options.invalidates.length > 0
    ? { invalidates: Object.freeze([...options.invalidates]) }
    : {};

const emptyInvalidations = Object.freeze([]) as ReadonlyArray<ResourceInvalidation<never>>;
const emptyFieldErrors = Object.freeze({}) as FormFieldErrors<any, never>;
const emptyFormErrors = Object.freeze([]) as ReadonlyArray<never>;

const freezeHeaders = (
  headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> =>
  Object.freeze({ ...headers });

const freezeFieldErrors = <Values extends object, E>(
  fieldErrors: FormFieldErrors<Values, E> | undefined
): FormFieldErrors<Values, E> => {
  if (fieldErrors === undefined) {
    return emptyFieldErrors as FormFieldErrors<Values, E>;
  }

  const snapshot: Partial<Record<FormFieldKey<Values>, ReadonlyArray<E>>> = {};
  for (const field of Object.keys(fieldErrors) as Array<FormFieldKey<Values>>) {
    const errors = fieldErrors[field];
    if (errors !== undefined) {
      snapshot[field] = Object.freeze([...errors]);
    }
  }
  return Object.freeze(snapshot) as FormFieldErrors<Values, E>;
};

const freezeFormErrors = <E>(
  formErrors: ReadonlyArray<E> | undefined
): ReadonlyArray<E> =>
  formErrors === undefined
    ? emptyFormErrors as ReadonlyArray<E>
    : Object.freeze([...formErrors]);

/** Builds a successful action result. */
const success = <A, R = never>(
  value: A,
  options: ActionResultOptions<R> = {}
): ActionResultSuccess<A, R> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Success",
  value,
  ...optionalInvalidates(options)
});

/** Builds a typed action failure result without throwing or failing the Effect. */
const failure = <E, R = never>(
  error: E,
  options: ActionResultOptions<R> = {}
): ActionResultFailure<E, R> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Failure",
  error,
  ...optionalInvalidates(options)
});

/** Builds a redirect result for form posts or action transports. */
const redirect = <R = never>(
  location: string,
  options: ActionResultRedirectOptions<R> = {}
): ActionResultRedirect<R> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Redirect",
  location,
  status: options.status ?? 303,
  ...optionalInvalidates(options),
  ...(options.headers === undefined ? {} : { headers: freezeHeaders(options.headers) }),
  ...(options.replace === undefined ? {} : { replace: options.replace })
});

const isFormValidationError = <Values extends object, E>(
  value: unknown
): value is FormValidationError<Values, E> =>
  value instanceof FormValidationError ||
  (
    typeof value === "object" &&
    value !== null &&
    (value as { _tag?: unknown })._tag === "FormValidationError" &&
    "fieldErrors" in value &&
    "formErrors" in value
  );

/** Builds a validation failure from form validation output or explicit errors. */
const validation = <Values extends object, E, R = never>(
  input: FormValidationError<Values, E> | ActionResultValidationInput<Values, E>,
  options: ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> => {
  const source: ActionResultValidationInput<Values, E> = isFormValidationError<Values, E>(input)
    ? {
        fieldErrors: input.fieldErrors,
        formErrors: input.formErrors,
        cause: input.cause
      }
    : input;

  return {
    [ActionResultTypeId]: ActionResultTypeId,
    _tag: "ValidationFailure",
    fieldErrors: freezeFieldErrors(source.fieldErrors),
    formErrors: freezeFormErrors(source.formErrors),
    cause: source.cause,
    ...optionalInvalidates(options)
  };
};

/** Builds a validation failure from a field-error map. */
const fields = <Values extends object, E, R = never>(
  fieldErrors: FormFieldErrors<Values, E>,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> =>
  validation(
    {
      fieldErrors,
      ...(options.formErrors === undefined ? {} : { formErrors: options.formErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    },
    options
  );

/** Builds a validation failure for one field. */
const fieldError = <Values extends object, K extends FormFieldKey<Values>, E, R = never>(
  field: K,
  error: E,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> => {
  const fieldErrors: FormFieldErrors<Values, E> = {};
  fieldErrors[field] = [error];
  return fields(fieldErrors, options);
};

/** Builds a validation failure for one form-level error. */
const formError = <Values extends object, E, R = never>(
  error: E,
  options: Omit<ActionResultValidationInput<Values, E>, "formErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> =>
  validation(
    {
      formErrors: [error],
      ...(options.fieldErrors === undefined ? {} : { fieldErrors: options.fieldErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    },
    options
  );

/** Appends invalidations to an existing action result. */
const withInvalidation = <Result extends AnyActionResult, R = never>(
  result: Result,
  invalidates: ReadonlyArray<ResourceInvalidation<R>>
): WithActionResultInvalidation<Result, R> =>
  ({
    ...result,
    invalidates: Object.freeze([...(result.invalidates ?? []), ...invalidates])
  }) as unknown as WithActionResultInvalidation<Result, R>;

/** Reads invalidations from any action result, returning an empty array when none are present. */
const invalidations = <R = never>(
  result: { readonly invalidates?: ReadonlyArray<ResourceInvalidation<R>> }
): ReadonlyArray<ResourceInvalidation<R>> =>
  result.invalidates ?? emptyInvalidations;

/** Runtime guard for values produced by `ActionResult` helpers. */
const is = (value: unknown): value is AnyActionResult =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionResultTypeId]?: unknown })[ActionResultTypeId] === ActionResultTypeId;

const isSuccess = <A, R = never>(
  result: ActionResult<A, object, unknown, unknown, R>
): result is ActionResultSuccess<A, R> => result._tag === "Success";

const isValidationFailure = <Values extends object, E, R = never>(
  result: ActionResult<unknown, Values, E, unknown, R>
): result is ActionResultValidationFailure<Values, E, R> =>
  result._tag === "ValidationFailure";

const isRedirect = <R = never>(
  result: ActionResult<unknown, object, unknown, unknown, R>
): result is ActionResultRedirect<R> => result._tag === "Redirect";

const isFailure = <E, R = never>(
  result: ActionResult<unknown, object, unknown, E, R>
): result is ActionResultFailure<E, R> => result._tag === "Failure";

/** Runs the matching branch for a result variant. */
const match = <A, Values extends object, ValidationError, E, B, R = never>(
  result: ActionResult<A, Values, ValidationError, E, R>,
  handlers: ActionResultMatch<A, Values, ValidationError, E, B, R>
): B => {
  switch (result._tag) {
    case "Success":
      return handlers.success(result.value, result);
    case "ValidationFailure":
      return handlers.validation(result);
    case "Redirect":
      return handlers.redirect(result);
    case "Failure":
      return handlers.failure(result.error, result);
  }
};

const successEffect = <A, R = never>(
  value: A,
  options: ActionResultOptions<R> = {}
): Effect.Effect<ActionResultSuccess<A, R>> =>
  Effect.succeed(success(value, options));

const failureEffect = <E, R = never>(
  error: E,
  options: ActionResultOptions<R> = {}
): Effect.Effect<ActionResultFailure<E, R>> =>
  Effect.succeed(failure(error, options));

const redirectEffect = <R = never>(
  location: string,
  options: ActionResultRedirectOptions<R> = {}
): Effect.Effect<ActionResultRedirect<R>> =>
  Effect.succeed(redirect(location, options));

const validationEffect = <Values extends object, E, R = never>(
  input: FormValidationError<Values, E> | ActionResultValidationInput<Values, E>,
  options: ActionResultOptions<R> = {}
): Effect.Effect<ActionResultValidationFailure<Values, E, R>> =>
  Effect.succeed(validation(input, options));

/** Converts an Effect into a successful or failure `ActionResult`. */
const fromEffect = <A, E = never, R = never>(
  effect: EffectInput<A, E, R> & (A extends PromiseLike<unknown> ? never : unknown)
): Effect.Effect<ActionResult<A, never, never, E>, never, R> =>
  toEffect(effect as never).pipe(
    Effect.map((value) => success(value)),
    Effect.catch((error) => Effect.succeed(failure(error)))
  ) as Effect.Effect<ActionResult<A, never, never, E>, never, R>;

/** Converts a form validation Effect into success or validation-failure results. */
const fromValidationEffect = <Values extends object, E, R = never>(
  effect: EffectInput<Values, FormValidationError<Values, E>, R> &
    (Values extends PromiseLike<unknown> ? never : unknown)
): Effect.Effect<ActionResult<Values, Values, E, never>, never, R> =>
  toEffect(effect as never).pipe(
    Effect.map((value) => success(value)),
    Effect.catch((error) => Effect.succeed(validation(error)))
  ) as Effect.Effect<ActionResult<Values, Values, E, never>, never, R>;

/** Validates a `FormInstance` and returns an action result instead of failing. */
const validateFormEffect = <Values extends object, E, R = never>(
  form: FormInstance<Values, E, R>
): Effect.Effect<ActionResult<Values, Values, E | Schema.SchemaError | EffectInputCallbackError, never>, never, R> =>
  fromValidationEffect(form.validateEffect() as never);

/** Extracts a success value or fails with the boundary result for explicit handling. */
const requireSuccessEffect = <A, Values extends object, ValidationError, E>(
  result: ActionResult<A, Values, ValidationError, E>
): Effect.Effect<A, ActionResultBoundary<Values, ValidationError, E>> =>
  result._tag === "Success"
    ? Effect.succeed(result.value)
    : Effect.fail(result);

/** Constructors, guards, matchers, and Effect helpers for action outcomes. */
export const ActionResult = {
  success,
  failure,
  fail: failure,
  redirect,
  validation,
  fields,
  fieldError,
  formError,
  withInvalidation,
  invalidations,
  is,
  isSuccess,
  isValidationFailure,
  isRedirect,
  isFailure,
  match,
  successEffect,
  failureEffect,
  failEffect: failureEffect,
  redirectEffect,
  validationEffect,
  fromEffect,
  fromValidationEffect,
  validateFormEffect,
  requireSuccessEffect
} as const;
