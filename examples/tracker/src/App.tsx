import { Action, Route, State } from "@sunfall/arc-core";
import { Component, RouterLink, RouterOutlet, RouterProvider, useRouter } from "@sunfall/arc-solid";
import { StartAction } from "@sunfall/arc-start";
import { Cause, Effect } from "effect";
import { For, Show, onSettled } from "solid-js";
import { RestoreIssue, SignOut } from "./actions.js";
import { boardHref, issueListHref, newIssueHref } from "./hrefs.js";
import { describeError, type ProjectKey } from "./model.js";
import { CurrentUser, Projects } from "./resources.js";
import { routes } from "./routeTree.gen.js";
import { route as IssueRoute } from "./routes/issues/$id.js";
import { route as BoardRoute } from "./routes/projects/$key/index.js";
import { route as IssueListRoute } from "./routes/projects/$key/issues.js";
import { route as NewIssueRoute } from "./routes/projects/$key/new.js";
import { route as HomeRoute } from "./routes/index.js";
import { UndoToast } from "./shell.js";
import { TimelinePanel } from "./timeline-panel.js";
import { Avatar } from "./ui.js";

type AppRoutes = typeof routes;

/** The project the current page belongs to, if any. */
const currentProject = (
  match: Route.Match<AppRoutes[number]> | undefined,
): ProjectKey | undefined =>
  Route.isMatch(BoardRoute, match) ||
  Route.isMatch(IssueListRoute, match) ||
  Route.isMatch(NewIssueRoute, match)
    ? match.params.key
    : Route.isMatch(IssueRoute, match)
      ? (match.params.id.slice(0, match.params.id.lastIndexOf("-")) as ProjectKey)
      : undefined;

type ShortcutModel = {
  readonly help: boolean;
  readonly leader: boolean;
  readonly timeline: boolean;
};
type ShortcutMessage =
  | { readonly _tag: "ToggleHelp" }
  | { readonly _tag: "CloseHelp" }
  | { readonly _tag: "ToggleTimeline" }
  | { readonly _tag: "Leader" }
  | { readonly _tag: "LeaderTimeout" }
  | { readonly _tag: "Go"; readonly href: string };

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The frame around every signed-in page: navigation, the sync status, the
 * undo toast, keyboard shortcuts, and (in development) the Timeline.
 */
const AppShell = Component.define("AppShell", function* () {
  const user = yield* Component.resource(CurrentUser);
  const projects = yield* Component.resource(Projects);
  const outbox = yield* Action.outbox;
  const restore = yield* Component.action(RestoreIssue);
  const signOut = yield* Component.action(SignOut);
  const toast = yield* Component.state(UndoToast);
  const Timeline = yield* TimelinePanel;
  const router = useRouter<AppRoutes>();
  const shortcuts = yield* Component.state(
    State.define<ShortcutModel, ShortcutMessage>()({
      name: "Shell.shortcuts",
      initial: { help: false, leader: false, timeline: false },
      on: {
        ToggleHelp: (model) => ({ ...model, help: !model.help }),
        CloseHelp: (model) => ({ ...model, help: false }),
        ToggleTimeline: (model) => ({ ...model, timeline: !model.timeline }),
        // `g` then a letter: the second key must come within a second.
        Leader: (model) =>
          State.next(
            { ...model, leader: true },
            State.emit(
              Effect.sleep("1 second").pipe(Effect.as({ _tag: "LeaderTimeout" } as const)),
            ),
          ),
        LeaderTimeout: (model) => ({ ...model, leader: false }),
        Go: (model, message) =>
          State.next(
            { ...model, leader: false, help: false },
            State.emit(Effect.sync(() => router.navigateHref(message.href))),
          ),
      },
    }),
  );
  const undo = yield* Component.callback("undo", () => {
    const deleted = toast.committed.get().deleted;
    return deleted === null
      ? Effect.void
      : restore
          .submit({ id: deleted.id })
          .pipe(Effect.andThen(toast.dispatch({ _tag: "Dismiss" })), Effect.ignore);
  });
  const leave = yield* Component.callback("signOut", () =>
    signOut.submit({}).pipe(
      Effect.flatMap((result) =>
        Effect.sync(() => {
          if (result._tag === "Redirect") {
            router.navigateHref(result.location, { replace: true });
          }
        }),
      ),
      Effect.ignore,
    ),
  );
  const signOutForm = StartAction.form(SignOut, { input: {} });
  const project = () => currentProject(router.match());

  // Keyboard shortcuts: an imperative sink that sends State messages.
  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) {
        return;
      }
      const key = project() ?? projects("all")[0]?.key;
      if (shortcuts.model().leader && key !== undefined) {
        const target =
          event.key === "b"
            ? boardHref(key)
            : event.key === "l"
              ? issueListHref(key)
              : event.key === "h"
                ? "/"
                : undefined;
        if (target !== undefined) {
          event.preventDefault();
          shortcuts.send.Go({ href: target });
          return;
        }
      }
      switch (event.key) {
        case "?":
          shortcuts.send.ToggleHelp();
          break;
        case "Escape":
          shortcuts.send.CloseHelp();
          break;
        case "g":
          shortcuts.send.Leader();
          break;
        case "c":
          if (key !== undefined) {
            event.preventDefault();
            shortcuts.send.Go({ href: newIssueHref(key) });
          }
          break;
        case "/": {
          event.preventDefault();
          const search = document.getElementById("issue-search");
          if (search instanceof HTMLInputElement) {
            search.focus();
            search.select();
          } else if (key !== undefined) {
            shortcuts.send.Go({ href: issueListHref(key) });
          }
          break;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return () => (
    <Show
      when={user("current")}
      fallback={
        <main class="authLayout">
          <RouterOutlet router={router} notFound={() => <NotFoundView />} />
        </main>
      }
    >
      {(me) => (
        <div class="shell">
          <header class="topBar">
            <RouterLink route={HomeRoute} class="brand" aria-label="Tracker home">
              <span class="brandMark" aria-hidden="true" />
              <span class="brandName">Tracker</span>
            </RouterLink>
            <nav class="projectNav" aria-label="Projects">
              <For each={projects("all")}>
                {(entry) => (
                  <RouterLink
                    route={BoardRoute}
                    options={{ params: { key: entry.key } }}
                    class={{ active: project() === entry.key }}
                  >
                    {entry.name}
                  </RouterLink>
                )}
              </For>
            </nav>
            <div class="topBarEnd">
              <Show when={outbox.pending.get().length > 0}>
                <span class="syncPill" role="status" data-testid="sync-pending">
                  {outbox.pending.get().length === 1
                    ? "1 change waiting to sync"
                    : `${outbox.pending.get().length} changes waiting to sync`}
                </span>
              </Show>
              <Show when={import.meta.env.DEV}>
                <button
                  type="button"
                  class="ghostButton small"
                  aria-pressed={shortcuts.model().timeline ? "true" : "false"}
                  onClick={shortcuts.send.ToggleTimeline}
                >
                  Timeline
                </button>
              </Show>
              <button
                type="button"
                class="ghostButton small keyHint"
                title="Keyboard shortcuts"
                onClick={shortcuts.send.ToggleHelp}
              >
                ?
              </button>
              <form
                method={signOutForm.method}
                class="userMenu"
                onSubmit={(event) => {
                  event.preventDefault();
                  leave();
                }}
              >
                <For each={signOutForm.hiddenFields}>
                  {(field) => <input type="hidden" name={field.name} value={field.value} />}
                </For>
                <Avatar user={me()} size="md" />
                <span class="userName">{me().name}</span>
                <button type="submit" class="linkButton">
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <div
            class={["navProgress", { active: router.state()._tag === "Pending" }]}
            aria-hidden="true"
          />
          <main class="page">
            <RouterOutlet
              router={router}
              pending={() => <div class="pageLoading" aria-busy="true" />}
              notFound={() => <NotFoundView />}
              failure={(state) => (
                <FailureView
                  message={
                    state.error?._tag === "RoutePreloadError"
                      ? describeError(state.error.cause)
                      : "Something went wrong loading this page."
                  }
                />
              )}
            />
          </main>

          <Show when={toast.model().deleted}>
            {(deleted) => (
              <div class="toast" role="status">
                <span>
                  Deleted <strong>{deleted().id}</strong> {deleted().title}
                </span>
                <button type="button" class="linkButton" onClick={() => undo()}>
                  Undo
                </button>
                <button
                  type="button"
                  class="iconButton"
                  aria-label="Dismiss"
                  onClick={toast.send.Dismiss}
                >
                  ×
                </button>
              </div>
            )}
          </Show>
          <Show when={restore.failure()}>
            {(cause) => (
              <div class="toast error" role="alert">
                Undo failed: {describeError(Cause.squash(cause()))}
              </div>
            )}
          </Show>

          <Show when={shortcuts.model().help}>
            <ShortcutHelp onClose={shortcuts.send.CloseHelp} />
          </Show>
          <Show when={shortcuts.model().timeline}>
            <Timeline />
          </Show>
        </div>
      )}
    </Show>
  );
}).pipe(Component.catchAll((error) => <FailureView message={describeError(error)} />));

function ShortcutHelp(props: { readonly onClose: () => void }) {
  const keys: ReadonlyArray<readonly [string, string]> = [
    ["c", "New issue"],
    ["/", "Search issues"],
    ["g b", "Go to the board"],
    ["g l", "Go to the list"],
    ["g h", "Go home"],
    ["?", "Show these shortcuts"],
  ];
  return (
    <div class="dialogBackdrop" onClick={() => props.onClose()}>
      <div
        class="dialog"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Keyboard shortcuts</h2>
        <dl class="shortcutList">
          <For each={keys}>
            {([key, label]) => (
              <>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </>
            )}
          </For>
        </dl>
        <button type="button" class="ghostButton" onClick={() => props.onClose()}>
          Close
        </button>
      </div>
    </div>
  );
}

export function NotFoundView() {
  return (
    <section class="statusPage" data-testid="not-found">
      <p class="statusCode">404</p>
      <h1>Nothing here</h1>
      <p>The page or issue you were looking for does not exist, or it was deleted.</p>
      <a href="/" class="primaryButton">
        Back home
      </a>
    </section>
  );
}

export function FailureView(props: { readonly message: string }) {
  return (
    <section class="statusPage" role="alert">
      <h1>Something went wrong</h1>
      <p>{props.message}</p>
    </section>
  );
}

/**
 * The Tracker root: Start renders it on the server and `App.launch`
 * hydrates it in the browser.
 */
const Tracker = Component.define("Tracker", function* (props: { readonly href: string }) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  const Shell = yield* AppShell;
  return () => (
    <RouterProvider router={router}>
      <Shell />
    </RouterProvider>
  );
});

export default Tracker;
