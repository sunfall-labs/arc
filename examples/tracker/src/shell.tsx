import { Machine, Message, Model, State } from "@sunfall/arc-core";
import { Schema } from "effect";
import { IssueId } from "./model.js";

/*
 * Client state the whole shell shares: the undo toast. It is an app State, so
 * the shell (which renders it) and the pages (which delete issues) bind the
 * same instance with `Component.state(UndoToast)`, and it outlives the page
 * that showed it.
 */

export const DeletedIssue = Schema.Struct({ id: IssueId, title: Schema.String });
export type DeletedIssue = typeof DeletedIssue.Type;

export const ToastModel = Model({
  Hidden: {},
  Showing: { issue: DeletedIssue },
});

export const ToastMessage = Message({
  DeletedIssue: { issue: DeletedIssue },
  RestoredIssue: {},
  ClickedDismiss: {},
  ToastExpired: {},
});

/**
 * "Issue deleted · Undo", for eight seconds after a delete. The eight seconds
 * belong to the Showing state: a newer delete re-enters it, which restarts
 * them, and leaving it cancels them, so an old timer can never hide a newer
 * toast.
 */
export const UndoToast = State.define({
  name: "Shell.undoToast",
  scope: "app",
  machine: Machine.make({ state: ToastModel, event: ToastMessage, initial: ToastModel.Hidden })
    .reenter([ToastModel.Hidden, ToastModel.Showing], ToastMessage.DeletedIssue, ({ event }) =>
      ToastModel.Showing({ issue: event.issue }),
    )
    .on(ToastModel.Showing, ToastMessage.RestoredIssue, () => ToastModel.Hidden)
    .on(ToastModel.Showing, ToastMessage.ClickedDismiss, () => ToastModel.Hidden)
    .on(ToastModel.Showing, ToastMessage.ToastExpired, () => ToastModel.Hidden)
    .timeout(ToastModel.Showing, { duration: "8 seconds", event: ToastMessage.ToastExpired }),
});
