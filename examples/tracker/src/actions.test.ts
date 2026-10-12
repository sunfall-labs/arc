import { Action, Resource, Server, State } from "@sunfall/arc-core";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DeleteIssue, MoveIssue, UpdateIssue, createIssueInputOf } from "./actions.js";
import { parseBlocks, parseInline } from "./markdown.js";
import { type Issue, type IssueId, type IssueRow, type ProjectKey, type UserId } from "./model.js";
import { Board, IssueById } from "./resources.js";
import { UndoToast } from "./shell.js";

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
  const form = {
    projectKey: TRK,
    title: "Ship it",
    status: "todo",
    priority: "high",
  } as const;

  it("turns the posted form into the domain input", () => {
    expect(
      createIssueInputOf({ ...form, assignee: "", labels: "l_trk-bug", description: undefined }),
    ).toMatchObject({ assigneeId: null, labelIds: ["l_trk-bug"], description: "" });
    expect(
      createIssueInputOf({ ...form, assignee: "u_mara0001", labels: ["l_trk-bug", "bogus"] }),
    ).toMatchObject({ assigneeId: "u_mara0001", labelIds: ["l_trk-bug"] });
  });
});

describe("undo toast", () => {
  it("expires only the delete it was scheduled for", () => {
    const first = State.step(UndoToast, UndoToast.initial, {
      _tag: "Deleted",
      issue: { id: "TRK-1" as IssueId, title: "One" },
    });
    expect(first.commands).toHaveLength(1);
    const second = State.step(UndoToast, first.model, {
      _tag: "Deleted",
      issue: { id: "TRK-2" as IssueId, title: "Two" },
    });
    const staleExpiry = State.step(UndoToast, second.model, {
      _tag: "Expire",
      id: "TRK-1" as IssueId,
    });
    expect(staleExpiry.model.deleted?.id).toBe("TRK-2");
    expect(
      State.step(UndoToast, second.model, { _tag: "Expire", id: "TRK-2" as IssueId }).model,
    ).toEqual({ deleted: null });
  });
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
