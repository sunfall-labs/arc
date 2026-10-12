import { ActionResult, type Action } from "@sunfall/arc-core";
import {
  encodeActionWire,
  type PostedActionSubmission,
  type PostedFormValues,
} from "@sunfall/arc-core/internal";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { serverActionPath, startJsonMediaType } from "./rpc.js";
import {
  decodeStartActionFormPost,
  readStartActionFormPost,
  serializeDefect,
  type StartActionDefinition,
} from "./start-action-request-codec.js";
import {
  decodeStartActionOutcome,
  type StartActionResponseBody,
} from "./start-action-response-codec.js";

/**
 * A no-JavaScript form post the page renders again: the Action's name, the
 * posted fields, its decoded input (when it decoded), and its outcome as the
 * action endpoint encodes it (`ValidationFailure` or `Failure`). Carried by
 * the root hydration payload so the hydrating client starts from the same
 * state the server rendered.
 */
export interface StartPostedAction {
  readonly action: string;
  readonly values: PostedFormValues;
  /** The decoded input, encoded with the Action's input schema. */
  readonly input?: unknown;
  readonly outcome: Extract<
    StartActionResponseBody,
    { readonly _tag: "ValidationFailure" | "Failure" }
  >;
}

/** What a page form post answers: a response of its own, or the page rendered again. */
export type StartActionFormPostResult =
  | { readonly _tag: "Respond"; readonly response: Response }
  | { readonly _tag: "Render"; readonly status: number; readonly posted: StartPostedAction };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const textResponse = (status: number, message: string): Response =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** The first line of a schema failure, without its path (the field names the path). */
const schemaMessage = (error: unknown): string =>
  Schema.isSchemaError(error)
    ? (error.message.split("\n")[0] ?? error.message)
    : String((error as { readonly message?: unknown }).message ?? error);

/**
 * Runs a no-JavaScript form post of a served Action at the page it was posted
 * to. The fields decode into the Action's input (a decode failure is the
 * form's validation failure, with no submission), and the Action runs through
 * the action endpoint (`submit`, given the JSON request body). A redirect
 * answers with it, and a success with a 303 back to the page; a validation
 * failure or a failure renders the page again with the outcome and the
 * posted fields.
 */
export const runStartActionFormPost = (options: {
  readonly request: Request;
  readonly actions: ReadonlyMap<string, StartActionDefinition>;
  readonly submit: (request: Request) => Effect.Effect<Response>;
}): Effect.Effect<StartActionFormPostResult> =>
  Effect.gen(function* () {
    const read = yield* Effect.exit(readStartActionFormPost(options.request));
    if (Exit.isFailure(read)) {
      return {
        _tag: "Respond",
        response: textResponse(400, "This form post names no Action."),
      } as const;
    }
    const post = read.value;
    const action = options.actions.get(post.name);
    if (action === undefined) {
      return {
        _tag: "Respond",
        response: textResponse(404, `No Action named ${post.name} is served here.`),
      } as const;
    }
    const decoded = yield* Effect.exit(decodeStartActionFormPost(action, post));
    if (Exit.isFailure(decoded)) {
      const failure = decoded.cause.reasons.find(Cause.isFailReason)?.error;
      const fieldErrors = Object.fromEntries(
        Object.entries(failure?.fieldErrors ?? {}).map(([field, errors]) => [
          field,
          (errors as ReadonlyArray<unknown>).map(schemaMessage),
        ]),
      );
      return {
        _tag: "Render",
        status: 422,
        posted: {
          action: action.name,
          values: post.values,
          outcome: {
            _tag: "ValidationFailure",
            fieldErrors,
            formErrors: (failure?.formErrors ?? []).map(schemaMessage),
          },
        },
      } as const;
    }
    const input = yield* encodeActionWire(action.input, decoded.value).pipe(Effect.orDie);
    const url = new URL(options.request.url);
    const headers = new Headers(options.request.headers);
    headers.set("content-type", startJsonMediaType);
    headers.set("accept", startJsonMediaType);
    headers.delete("content-length");
    const response = yield* options.submit(
      new Request(new URL(serverActionPath, url), {
        method: "POST",
        headers,
        body: JSON.stringify({ name: action.name, input }),
      }),
    );
    const text = yield* Effect.promise(() => response.text());
    const body = yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (!isRecord(body)) {
      return {
        _tag: "Respond",
        response: textResponse(500, "The Action answered with an unreadable response."),
      } as const;
    }
    switch (body._tag) {
      case "Redirect":
        return {
          _tag: "Respond",
          response: new Response(null, {
            status: typeof body.status === "number" ? body.status : 303,
            headers: {
              ...(isRecord(body.headers) ? (body.headers as Record<string, string>) : {}),
              location: String(body.location),
            },
          }),
        } as const;
      case "Success":
        // Post/Redirect/Get: show the page as it is now.
        return {
          _tag: "Respond",
          response: new Response(null, {
            status: 303,
            headers: { location: `${url.pathname}${url.search}` },
          }),
        } as const;
      case "ValidationFailure":
      case "Failure":
        return {
          _tag: "Render",
          status: body._tag === "ValidationFailure" ? 422 : 400,
          posted: {
            action: action.name,
            values: post.values,
            input,
            outcome: body as StartPostedAction["outcome"],
          },
        } as const;
      default:
        return {
          _tag: "Respond",
          response: textResponse(
            response.status >= 400 ? response.status : 500,
            `The Action failed: ${JSON.stringify(serializeDefect(body))}`,
          ),
        } as const;
    }
  });

/**
 * The posted submission as a runtime's `PostedActions` entry: a renderer
 * binding of `posted.action` decodes it with its definition's schemas into
 * the state the server rendered.
 */
export const postedActionSubmission = (posted: StartPostedAction): PostedActionSubmission => ({
  action: posted.action,
  values: posted.values,
  state: <I, A, E, R>(definition: Action.Definition<I, A, E, R>) =>
    Effect.gen(function* () {
      const input =
        posted.input === undefined || !Schema.isSchema(definition.input)
          ? Option.none<I>()
          : Option.some(
              (yield* Schema.decodeUnknownEffect(definition.input as Schema.Decoder<I>)(
                posted.input,
              ).pipe(Effect.orDie)) as I,
            );
      const outcome = yield* decodeStartActionOutcome(definition, posted.outcome).pipe(
        Effect.orElseSucceed(() => ({
          _tag: "Value" as const,
          value: ActionResult.validation({
            formErrors: ["The form could not be checked."],
          }) as A,
        })),
      );
      return {
        input,
        result:
          outcome._tag === "Value"
            ? AsyncResult.success(outcome.value)
            : AsyncResult.failure(Cause.fail(outcome.error)),
      } as Action.State<I, A, E | Action.ClientError>;
    }),
});
