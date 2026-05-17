import { Effect, type Schema } from "effect";
import type {
  EffectInput,
  EffectInputCallbackError,
  PlainValue
} from "./effect-like.js";
import { toEffect } from "./effect-like.js";
import { rejectPlainSyncCallbackValue } from "./effect-input-sync.js";
import { validateResourceInvalidationsArraySync } from "./resource-dependency-graph.js";
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
  readonly fieldErrors?: FormFieldErrors<Values, PlainValue<E>>;
  /** Errors that apply to the whole form rather than one field. */
  readonly formErrors?: ReadonlyArray<PlainValue<E>>;
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
    ? {
        invalidates: validateResourceInvalidationsArraySync(
          "ActionResult.invalidates",
          options.invalidates,
          "ActionResult invalidation metadata must be Resource refs or tags. Move host Promise work into the action run Effect before building the result."
        )
      }
    : {};

const emptyInvalidations = Object.freeze([]) as ReadonlyArray<ResourceInvalidation<never>>;
const emptyFieldErrors = Object.freeze({}) as FormFieldErrors<any, never>;
const emptyFormErrors = Object.freeze([]) as ReadonlyArray<never>;

const freezeHeaders = (
  headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> =>
  Object.freeze({ ...headers });

const freezeFieldErrors = <Values extends object, E>(
  fieldErrors: FormFieldErrors<Values, PlainValue<E>> | undefined
): FormFieldErrors<Values, E> => {
  if (fieldErrors === undefined) {
    return emptyFieldErrors as FormFieldErrors<Values, E>;
  }

  const snapshot: Partial<Record<FormFieldKey<Values>, ReadonlyArray<E>>> = {};
  for (const field of Object.keys(fieldErrors) as Array<FormFieldKey<Values>>) {
    const errors = fieldErrors[field];
    if (errors !== undefined) {
      snapshot[field] = Object.freeze(
        errors.map((error) => rejectActionResultValidationError(error as E))
      );
    }
  }
  return Object.freeze(snapshot) as FormFieldErrors<Values, E>;
};

const freezeFormErrors = <E>(
  formErrors: ReadonlyArray<PlainValue<E>> | undefined
): ReadonlyArray<E> =>
  formErrors === undefined
    ? emptyFormErrors as ReadonlyArray<E>
    : Object.freeze(formErrors.map((error) => rejectActionResultValidationError(error as E)));

const actionResultSuccessPromiseGuidance =
  "ActionResult success values must be plain data. Move host Promise work into the action run Effect with Effect.tryPromise(...) before building the result. Direct Effect values are executable work, not result data.";

const actionResultFailurePromiseGuidance =
  "ActionResult failure values must be plain data. Move host Promise work into the action run Effect with Effect.tryPromise(...) before building the result. Direct Effect values are executable work, not failure data.";

const actionResultValidationPromiseGuidance =
  "ActionResult validation errors must be plain data. Move host Promise work into validation Effects with Effect.tryPromise(...) before building the result. Direct Effect values are executable work, not validation data.";

const rejectActionResultValidationError = <E>(error: E): E =>
  rejectPlainSyncCallbackValue(
    "ActionResult.validation",
    error,
    actionResultValidationPromiseGuidance
  );

/** Builds a successful action result with plain data; Promise-shaped and Effect-shaped payloads are rejected. */
const success = <A, R = never>(
  value: PlainValue<A>,
  options: ActionResultOptions<R> = {}
): ActionResultSuccess<A, R> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Success",
  value: rejectPlainSyncCallbackValue(
    "ActionResult.success",
    value,
    actionResultSuccessPromiseGuidance
  ) as A,
  ...optionalInvalidates(options)
});

/** Builds a typed action failure with plain error data; Promise-shaped and Effect-shaped errors are rejected. */
const failure = <E, R = never>(
  error: PlainValue<E>,
  options: ActionResultOptions<R> = {}
): ActionResultFailure<E, R> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Failure",
  error: rejectPlainSyncCallbackValue(
    "ActionResult.failure",
    error,
    actionResultFailurePromiseGuidance
  ) as E,
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

/** Builds a validation failure from plain validation errors; Promise-shaped errors are rejected. */
const validation = <Values extends object, E, R = never>(
  input: FormValidationError<Values, E> | ActionResultValidationInput<Values, E>,
  options: ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> => {
  const source: ActionResultValidationInput<Values, E> = isFormValidationError<Values, E>(input)
    ? {
        fieldErrors: input.fieldErrors as FormFieldErrors<Values, PlainValue<E>>,
        formErrors: input.formErrors as ReadonlyArray<PlainValue<E>>,
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

/** Builds a validation failure from a field-error map of plain errors. */
const fields = <Values extends object, E, R = never>(
  fieldErrors: FormFieldErrors<Values, PlainValue<E>>,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> =>
  validation<Values, E, R>(
    {
      fieldErrors,
      ...(options.formErrors === undefined ? {} : { formErrors: options.formErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    } as ActionResultValidationInput<Values, E>,
    options
  );

/** Builds a validation failure for one field using plain error data. */
const fieldError = <Values extends object, K extends FormFieldKey<Values>, E, R = never>(
  field: K,
  error: PlainValue<E>,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> => {
  const fieldErrors: FormFieldErrors<Values, PlainValue<E>> = {};
  fieldErrors[field] = [error];
  return fields(fieldErrors, options);
};

/** Builds a validation failure for one form-level plain error. */
const formError = <Values extends object, E, R = never>(
  error: PlainValue<E>,
  options: Omit<ActionResultValidationInput<Values, E>, "formErrors"> &
    ActionResultOptions<R> = {}
): ActionResultValidationFailure<Values, E, R> =>
  validation<Values, E, R>(
    {
      formErrors: [error],
      ...(options.fieldErrors === undefined ? {} : { fieldErrors: options.fieldErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    } as ActionResultValidationInput<Values, E>,
    options
  );

/** Appends invalidations to an existing action result. */
const withInvalidation = <Result extends AnyActionResult, R = never>(
  result: Result,
  invalidates: ReadonlyArray<ResourceInvalidation<R>>
): WithActionResultInvalidation<Result, R> =>
  ({
    ...result,
    invalidates: validateResourceInvalidationsArraySync(
      "ActionResult.withInvalidation",
      [...(result.invalidates ?? []), ...invalidates],
      "ActionResult invalidation metadata must be Resource refs or tags. Move host Promise work into the action run Effect before appending invalidations."
    )
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

/** Effect constructor for a successful action result with plain, non-Promise data. */
const successEffect = <A, R = never>(
  value: PlainValue<A>,
  options: ActionResultOptions<R> = {}
): Effect.Effect<ActionResultSuccess<A, R>> =>
  Effect.succeed(success<A, R>(value, options));

/** Effect constructor for a failure action result with plain, non-Promise error data. */
const failureEffect = <E, R = never>(
  error: PlainValue<E>,
  options: ActionResultOptions<R> = {}
): Effect.Effect<ActionResultFailure<E, R>> =>
  Effect.succeed(failure<E, R>(error, options));

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

/** Converts an Effect into an `ActionResult`; successes and errors must be plain data. */
const fromEffect = <A, E = never, R = never>(
  effect: PlainValue<A> | Effect.Effect<PlainValue<A>, PlainValue<E>, R>
): Effect.Effect<ActionResult<A, never, never, E>, never, R> =>
  toEffect(effect as never).pipe(
    Effect.map((value) => success<A>(value as PlainValue<A>)),
    Effect.catch((error) => Effect.succeed(failure<E>(error as PlainValue<E>)))
  ) as Effect.Effect<ActionResult<A, never, never, E>, never, R>;

/** Converts a form validation Effect into plain success or validation-failure results. */
const fromValidationEffect = <Values extends object, E, R = never>(
  effect: EffectInput<Values, FormValidationError<Values, E>, R>
): Effect.Effect<ActionResult<Values, Values, E, never>, never, R> =>
  toEffect(effect as never).pipe(
    Effect.map((value) => success<Values>(value as PlainValue<Values>)),
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
