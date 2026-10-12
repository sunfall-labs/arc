import { State } from "@sunfall/arc-core";
import { Effect } from "effect";
import type { IssueId } from "./model.js";

/*
 * Client state the whole shell shares: the undo toast. It is an app State, so
 * the shell (which renders it) and the pages (which delete issues) bind the
 * same instance with `Component.state(UndoToast)`, and it outlives the page
 * that showed it.
 */

export interface DeletedIssue {
  readonly id: IssueId;
  readonly title: string;
}

type ToastModel = { readonly deleted: DeletedIssue | null };
type ToastMessage =
  | { readonly _tag: "Deleted"; readonly issue: DeletedIssue }
  | { readonly _tag: "Expire"; readonly id: IssueId }
  | { readonly _tag: "Dismiss" };

/** "Issue deleted · Undo", for eight seconds after a delete. */
export const UndoToast = State.define<ToastModel, ToastMessage>()({
  name: "Shell.undoToast",
  scope: "app",
  initial: { deleted: null },
  on: {
    Deleted: (_model, message) =>
      State.next(
        { deleted: message.issue },
        State.emit(
          Effect.sleep("8 seconds").pipe(
            Effect.as({ _tag: "Expire", id: message.issue.id } as const),
          ),
        ),
      ),
    // Only the toast it was scheduled for: a newer delete keeps its own eight seconds.
    Expire: (model, message) => (model.deleted?.id === message.id ? { deleted: null } : model),
    Dismiss: () => ({ deleted: null }),
  },
});
