import { Action, Machine, Resource, Server } from "@sunfall/arc-core";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { StartAction } from "@sunfall/arc-start";
import { CreateIssue, DeleteIssue, MoveIssue, UpdateIssue } from "./actions.js";
import { parseBlocks, parseInline } from "./markdown.js";
import { type Issue, type IssueId, type IssueRow, type ProjectKey, type UserId } from "./model.js";
import { Board, IssueById } from "./resources.js";
import { ToastMessage, UndoToast } from "./shell.js";

/*
 * Client-side logic with the served Resources' loads mocked: optimistic
 * patches, form normalization, and the pure UI pieces.
 */

const TRK = "TRK" as ProjectKey;
const row = (id: string, status: IssueRow["status"], position: number): IssueRow => ({
  id: id as IssueId,
  projectKey: TRK,
  number: Number(id.split("-")[1]),
  title: `Issue ${id}`,
  status,
  priority: "medium",
  assigneeId: null,
  labelIds: [],
  commentCount: 0,
  position,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  seq: position,
});
const rows = [row("TRK-1", "todo", 1), row("TRK-2", "in_progress", 2)];
const issue: Issue = { ...rows[0]!, description: "", reporterId: "u_mara0001" as UserId };

const Mocks = Server.mockLayer(
  Resource.implement(Board, () => Effect.succeed(rows)),
  Resource.implement(IssueById, () => Effect.succeed(issue)),
);

describe("optimistic patches", () => {
  it("moving an issue re-files its board card and its page at once", () => {
    const changes = Effect.runSync(
      Effect.gen(function* () {
        yield* Resource.preload([Board(TRK), IssueById(issue.id)]);
        return yield* Action.planOptimistic(MoveIssue, {
          id: issue.id,
          status: "done",
          position: 9,
        });
      }).pipe(Effect.provide(Mocks)),
    );
    expect(changes).toEqual([
      {
        _tag: "Update",
        target: Board(TRK),
        key: "TRK-1",
        update: { status: "done", position: 9 },
      },
      expect.objectContaining({ _tag: "Update", key: "TRK-1" }),
      {
        _tag: "Set",
        target: IssueById(issue.id),
        value: { ...issue, status: "done", position: 9 },
      },
    ]);
  });

  it("editing patches only the fields sent", () => {
    const changes = Effect.runSync(
      Effect.gen(function* () {
        yield* Resource.preload(IssueById(issue.id));
        return yield* Action.planOptimistic(UpdateIssue, { id: issue.id, title: "Renamed" });
      }).pipe(Effect.provide(Mocks)),
    );
    expect(changes[0]).toMatchObject({ _tag: "Update", update: { title: "Renamed" } });
    expect(changes[2]).toMatchObject({ _tag: "Set", value: { ...issue, title: "Renamed" } });
  });

  it("deleting hides the card", () => {
    const changes = Effect.runSync(
      Action.planOptimistic(DeleteIssue, { id: issue.id }).pipe(Effect.provide(Mocks)),
    );
    expect(changes[0]).toEqual({ _tag: "Delete", target: Board(TRK), key: "TRK-1" });
  });
});

describe("CreateIssue", () => {
  /** The new-issue form as a browser posts it. */
  const posted = (entries: ReadonlyArray<readonly [string, string]>) => {
    const formData = new FormData();
    for (const [name, value] of [
      ...StartAction.form(CreateIssue, { input: { projectKey: TRK } }).hiddenFields.map(
        (field) => [field.name, field.value] as const,
      ),
      ["title", "Ship it"] as const,
      ["description", ""] as const,
      ["status", "todo"] as const,
      ["priority", "high"] as const,
      ...entries,
    ]) {
      formData.append(name, value);
    }
    return Effect.runSync(StartAction.decodeFormData(CreateIssue, formData));
  };

  it("decodes the posted form as the domain input", () => {
    // "Unassigned" posts an empty value; unchecked labels post nothing.
    expect(posted([["assigneeId", ""]])).toEqual({
      projectKey: TRK,
      title: "Ship it",
      description: "",
      status: "todo",
      priority: "high",
      assigneeId: null,
      labelIds: [],
    });
    expect(
      posted([
        ["assigneeId", "u_mara0001"],
        ["labelIds", "l_trk-bug"],
        ["labelIds", "l_trk-feature"],
      ]),
    ).toMatchObject({ assigneeId: "u_mara0001", labelIds: ["l_trk-bug", "l_trk-feature"] });
  });
});

describe("undo toast", () => {
  const deleted = (id: string, title: string) =>
    ToastMessage.DeletedIssue({ issue: { id: id as IssueId, title } });

  it("shows the latest delete and hides on undo, dismiss, or expiry", () => {
    const replay = (messages: ReadonlyArray<typeof ToastMessage.Type>) =>
      Effect.runSync(Machine.replay(UndoToast.machine, messages));
    expect(replay([deleted("TRK-1", "One"), deleted("TRK-2", "Two")])).toMatchObject({
      _tag: "Showing",
      issue: { id: "TRK-2" },
    });
    expect(replay([deleted("TRK-1", "One"), ToastMessage.RestoredIssue])._tag).toBe("Hidden");
    expect(replay([deleted("TRK-1", "One"), ToastMessage.ToastExpired])._tag).toBe("Hidden");
    // Nothing to dismiss while hidden: the message changes nothing.
    expect(replay([ToastMessage.ClickedDismiss])._tag).toBe("Hidden");
  });

  it("gives a newer delete its own eight seconds", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const toast = yield* Machine.spawn(UndoToast.machine);
        yield* toast.start;
        yield* toast.call(deleted("TRK-1", "One"));
        yield* TestClock.adjust("5 seconds");
        yield* toast.call(deleted("TRK-2", "Two"));
        // TRK-1's eight seconds are up, but they left with its toast.
        yield* TestClock.adjust("5 seconds");
        expect(yield* toast.snapshot).toMatchObject({ _tag: "Showing", issue: { id: "TRK-2" } });
        yield* TestClock.adjust("3 seconds");
        expect((yield* toast.snapshot)._tag).toBe("Hidden");
        yield* toast.stop;
      }).pipe(Effect.provide(TestClock.layer())),
    ));
});

describe("markdown", () => {
  it("parses blocks and inline marks without HTML", () => {
    expect(
      parseBlocks("# Title\n\nSome *text*\nwraps\n\n- one\n- two\n\n```\n<b>x</b>\n```"),
    ).toEqual([
      { _tag: "Heading", level: 1, text: "Title" },
      { _tag: "Paragraph", text: "Some *text* wraps" },
      { _tag: "List", ordered: false, items: ["one", "two"] },
      { _tag: "Code", text: "<b>x</b>" },
    ]);
    expect(parseInline("a **b** `c` _d_ [e](https://e.test) [f](javascript:x)")).toEqual([
      { _tag: "Text", text: "a " },
      { _tag: "Strong", text: "b" },
      { _tag: "Text", text: " " },
      { _tag: "Code", text: "c" },
      { _tag: "Text", text: " " },
      { _tag: "Emphasis", text: "d" },
      { _tag: "Text", text: " " },
      { _tag: "Link", text: "e", href: "https://e.test" },
      { _tag: "Text", text: " [f](javascript:x)" },
    ]);
  });
});
