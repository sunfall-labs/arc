import { ActionResult, type Route } from "@sunfall/arc-core";
import { Component, useRouter } from "@sunfall/arc-solid";
import { StartAction } from "@sunfall/arc-start";
import { Cause, Effect } from "effect";
import { For, Show } from "solid-js";
import { SignIn } from "../actions.js";
import { describeError } from "../model.js";
import { safeRedirect } from "../session.js";
import type { route } from "./signin.js";

/**
 * Sign in with a name and an email; there is no password. The form posts the
 * SignIn Action, so it works before (or without) JavaScript; with it, the
 * same Action submits over the action transport.
 */
export default Component.define("SignInPage", function* (props: Route.Props<typeof route>) {
  const router = useRouter();
  const signIn = yield* Component.action(SignIn);
  const next = () => safeRedirect(props.search.next);
  const submit = yield* Component.callback("submit", (form: HTMLFormElement) =>
    StartAction.decodeFormData(SignIn, new FormData(form)).pipe(
      Effect.flatMap((input) => signIn.submit(input)),
      Effect.flatMap((result) =>
        Effect.sync(() => {
          if (ActionResult.isRedirect(result)) {
            router.navigateHref(result.location, { replace: true });
          }
        }),
      ),
      Effect.ignore,
    ),
  );
  const form = () => StartAction.form(SignIn, { input: { redirectTo: next() } });
  // A form post without JavaScript that failed comes back with what it sent.
  const posted = (field: "name" | "email"): string => {
    const value = signIn.formValues()?.[field];
    return typeof value === "string" ? value : "";
  };
  const fieldError = (field: "name" | "email") => {
    const result = signIn.result();
    const value = result._tag === "Success" ? result.value : undefined;
    return value !== undefined && ActionResult.isValidationFailure(value)
      ? (value.fieldErrors as Record<string, ReadonlyArray<string> | undefined>)[field]?.[0]
      : undefined;
  };

  return () => (
    <section class="signIn">
      <div class="signInCard">
        <span class="brandMark large" aria-hidden="true" />
        <h1>Sign in to Tracker</h1>
        <p class="muted">No password: tell us who you are. New emails get a new account.</p>
        <form
          method={form().method}
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <For each={form().hiddenFields}>
            {(field) => <input type="hidden" name={field.name} value={field.value} />}
          </For>
          <label class="field">
            <span>Name</span>
            <input
              name="name"
              autocomplete="name"
              required
              minlength={2}
              placeholder="Ada Lovelace"
              value={posted("name")}
              aria-invalid={fieldError("name") === undefined ? "false" : "true"}
            />
            <Show when={fieldError("name")}>
              {(message) => <small class="fieldError">{message()}</small>}
            </Show>
          </label>
          <label class="field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              autocomplete="email"
              required
              placeholder="ada@example.com"
              value={posted("email")}
              aria-invalid={fieldError("email") === undefined ? "false" : "true"}
            />
            <Show when={fieldError("email")}>
              {(message) => <small class="fieldError">{message()}</small>}
            </Show>
          </label>
          <button type="submit" class="primaryButton wide" disabled={signIn.waiting()}>
            {signIn.waiting() ? "Signing in…" : "Continue"}
          </button>
          <Show when={signIn.failure()}>
            {(cause) => <p class="formError">{describeError(Cause.squash(cause()))}</p>}
          </Show>
        </form>
        <p class="muted small">
          Try <code>mara@tracker.test</code>: she has issues assigned already.
        </p>
      </div>
    </section>
  );
});
