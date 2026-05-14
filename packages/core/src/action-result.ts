import { Effect, type Schema } from "effect";
import type { EffectInput } from "./effect-like.js";
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

export type ActionRedirectStatus = 303 | 307 | 308;

export interface ActionResultOptions {
  readonly invalidates?: ReadonlyArray<ResourceInvalidation>;
}

export interface ActionResultRedirectOptions extends ActionResultOptions {
  readonly status?: ActionRedirectStatus;
  readonly headers?: Readonly<Record<string, string>>;
  readonly replace?: boolean;
}

export interface ActionResultValidationInput<Values extends object, E> {
  readonly fieldErrors?: FormFieldErrors<Values, E>;
  readonly formErrors?: ReadonlyArray<E>;
  readonly cause?: unknown;
}

export interface ActionResultBase<Tag extends string> {
  readonly [ActionResultTypeId]: typeof ActionResultTypeId;
  readonly _tag: Tag;
  readonly invalidates?: ReadonlyArray<ResourceInvalidation>;
}

export interface ActionResultSuccess<A> extends ActionResultBase<"Success"> {
  readonly value: A;
}

export interface ActionResultValidationFailure<Values extends object, E>
  extends ActionResultBase<"ValidationFailure"> {
  readonly fieldErrors: FormFieldErrors<Values, E>;
  readonly formErrors: ReadonlyArray<E>;
  readonly cause: unknown | undefined;
}

export interface ActionResultRedirect extends ActionResultBase<"Redirect"> {
  readonly location: string;
  readonly status: ActionRedirectStatus;
  readonly headers?: Readonly<Record<string, string>>;
  readonly replace?: boolean;
}

export interface ActionResultFailure<E> extends ActionResultBase<"Failure"> {
  readonly error: E;
}

export type ActionResultBoundary<Values extends object = never, ValidationError = never, E = never> =
  | ActionResultValidationFailure<Values, ValidationError>
  | ActionResultRedirect
  | ActionResultFailure<E>;

export type ActionResult<A, Values extends object = never, ValidationError = never, E = never> =
  | ActionResultSuccess<A>
  | ActionResultBoundary<Values, ValidationError, E>;

export type AnyActionResult =
  | ActionResultSuccess<unknown>
  | ActionResultValidationFailure<Record<string, unknown>, unknown>
  | ActionResultRedirect
  | ActionResultFailure<unknown>;

export interface ActionResultMatch<
  A,
  Values extends object,
  ValidationError,
  E,
  B
> {
  readonly success: (value: A, result: ActionResultSuccess<A>) => B;
  readonly validation: (
    failure: ActionResultValidationFailure<Values, ValidationError>
  ) => B;
  readonly redirect: (redirect: ActionResultRedirect) => B;
  readonly failure: (error: E, result: ActionResultFailure<E>) => B;
}

const optionalInvalidates = (
  options: ActionResultOptions = {}
): Pick<ActionResultBase<string>, "invalidates"> =>
  options.invalidates && options.invalidates.length > 0
    ? { invalidates: options.invalidates }
    : {};

const success = <A>(
  value: A,
  options: ActionResultOptions = {}
): ActionResultSuccess<A> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Success",
  value,
  ...optionalInvalidates(options)
});

const failure = <E>(
  error: E,
  options: ActionResultOptions = {}
): ActionResultFailure<E> => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Failure",
  error,
  ...optionalInvalidates(options)
});

const redirect = (
  location: string,
  options: ActionResultRedirectOptions = {}
): ActionResultRedirect => ({
  [ActionResultTypeId]: ActionResultTypeId,
  _tag: "Redirect",
  location,
  status: options.status ?? 303,
  ...optionalInvalidates(options),
  ...(options.headers === undefined ? {} : { headers: options.headers }),
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

const validation = <Values extends object, E>(
  input: FormValidationError<Values, E> | ActionResultValidationInput<Values, E>,
  options: ActionResultOptions = {}
): ActionResultValidationFailure<Values, E> => {
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
    fieldErrors: source.fieldErrors ?? {},
    formErrors: source.formErrors ?? [],
    cause: source.cause,
    ...optionalInvalidates(options)
  };
};

const fields = <Values extends object, E>(
  fieldErrors: FormFieldErrors<Values, E>,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions = {}
): ActionResultValidationFailure<Values, E> =>
  validation(
    {
      fieldErrors,
      ...(options.formErrors === undefined ? {} : { formErrors: options.formErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    },
    options
  );

const fieldError = <Values extends object, K extends FormFieldKey<Values>, E>(
  field: K,
  error: E,
  options: Omit<ActionResultValidationInput<Values, E>, "fieldErrors"> &
    ActionResultOptions = {}
): ActionResultValidationFailure<Values, E> => {
  const fieldErrors: FormFieldErrors<Values, E> = {};
  fieldErrors[field] = [error];
  return fields(fieldErrors, options);
};

const formError = <Values extends object, E>(
  error: E,
  options: Omit<ActionResultValidationInput<Values, E>, "formErrors"> &
    ActionResultOptions = {}
): ActionResultValidationFailure<Values, E> =>
  validation(
    {
      formErrors: [error],
      ...(options.fieldErrors === undefined ? {} : { fieldErrors: options.fieldErrors }),
      ...(options.cause === undefined ? {} : { cause: options.cause })
    },
    options
  );

const withInvalidation = <R extends AnyActionResult>(
  result: R,
  invalidates: ReadonlyArray<ResourceInvalidation>
): R =>
  ({
    ...result,
    invalidates: [...(result.invalidates ?? []), ...invalidates]
  }) as R;

const invalidations = (result: AnyActionResult): ReadonlyArray<ResourceInvalidation> =>
  result.invalidates ?? [];

const is = (value: unknown): value is AnyActionResult =>
  typeof value === "object" &&
  value !== null &&
  (value as { [ActionResultTypeId]?: unknown })[ActionResultTypeId] === ActionResultTypeId;

const isSuccess = <A>(
  result: ActionResult<A, object, unknown, unknown>
): result is ActionResultSuccess<A> => result._tag === "Success";

const isValidationFailure = <Values extends object, E>(
  result: ActionResult<unknown, Values, E, unknown>
): result is ActionResultValidationFailure<Values, E> =>
  result._tag === "ValidationFailure";

const isRedirect = (
  result: ActionResult<unknown, object, unknown, unknown>
): result is ActionResultRedirect => result._tag === "Redirect";

const isFailure = <E>(
  result: ActionResult<unknown, object, unknown, E>
): result is ActionResultFailure<E> => result._tag === "Failure";

const match = <A, Values extends object, ValidationError, E, B>(
  result: ActionResult<A, Values, ValidationError, E>,
  handlers: ActionResultMatch<A, Values, ValidationError, E, B>
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

const successEffect = <A>(
  value: A,
  options: ActionResultOptions = {}
): Effect.Effect<ActionResultSuccess<A>> =>
  Effect.succeed(success(value, options));

const failureEffect = <E>(
  error: E,
  options: ActionResultOptions = {}
): Effect.Effect<ActionResultFailure<E>> =>
  Effect.succeed(failure(error, options));

const redirectEffect = (
  location: string,
  options: ActionResultRedirectOptions = {}
): Effect.Effect<ActionResultRedirect> =>
  Effect.succeed(redirect(location, options));

const validationEffect = <Values extends object, E>(
  input: FormValidationError<Values, E> | ActionResultValidationInput<Values, E>,
  options: ActionResultOptions = {}
): Effect.Effect<ActionResultValidationFailure<Values, E>> =>
  Effect.succeed(validation(input, options));

const fromEffect = <A, E = never, R = never>(
  effect: EffectInput<A, E, R>
): Effect.Effect<ActionResult<A, never, never, E>, never, R> =>
  toEffect(effect).pipe(
    Effect.map((value) => success(value)),
    Effect.catch((error) => Effect.succeed(failure(error)))
  );

const fromValidationEffect = <Values extends object, E, R = never>(
  effect: EffectInput<Values, FormValidationError<Values, E>, R>
): Effect.Effect<ActionResult<Values, Values, E, never>, never, R> =>
  toEffect(effect).pipe(
    Effect.map((value) => success(value)),
    Effect.catch((error) => Effect.succeed(validation(error)))
  );

const validateFormEffect = <Values extends object, E, R = never>(
  form: FormInstance<Values, E, R>
): Effect.Effect<ActionResult<Values, Values, E | Schema.SchemaError, never>, never, R> =>
  fromValidationEffect(form.validateEffect());

const requireSuccessEffect = <A, Values extends object, ValidationError, E>(
  result: ActionResult<A, Values, ValidationError, E>
): Effect.Effect<A, ActionResultBoundary<Values, ValidationError, E>> =>
  result._tag === "Success"
    ? Effect.succeed(result.value)
    : Effect.fail(result);

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
