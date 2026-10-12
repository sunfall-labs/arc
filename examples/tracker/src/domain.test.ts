import { makeResponseContext, provideRequest, provideResponse } from "@sunfall/arc-core";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { describe, expect, it } from "vitest";
import {
  activityFn,
  addCommentFn,
  boardFn,
  changesFn,
  createIssueFn,
  deleteIssueFn,
  issueFn,
  moveIssueFn,
  myIssuesFn,
  restoreIssueFn,
  searchFn,
  sessionCookieName,
  signInFn,
  updateIssueFn,
} from "./api.server.js";
import { TrackerDatabase } from "./db.server.js";
import {
  IssueListSearch,
  issueQueryOf,
  type CommentId,
  type LabelId,
  type ProjectKey,
} from "./model.js";

/*
 * The server functions against a real, fresh in-memory SQLite database per
 * test: migrations and seed data included, the session read from a cookie.
 */

const TRK = "TRK" as ProjectKey;

/** Runs `effect` as a request carrying `cookie`, on `database`. */
const asRequest =
  (cookie: string | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      provideRequest(
        new Request("https://tracker.test/", cookie === undefined ? {} : { headers: { cookie } }),
      ),
      provideResponse(makeResponseContext()),
    );

/** Signs in and returns the session cookie for later requests. */
const signedIn = (email: string) =>
  Effect.gen(function* () {
    const response = makeResponseContext();
    yield* signInFn
      .local({ name: "Test User", email })
      .pipe(provideRequest(new Request("https://tracker.test/")), provideResponse(response));
    const cookie = response.cookies.find((header) => header.startsWith(`${sessionCookieName}=`));
    return cookie!.split(";")[0]!;
  });

const runDb = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.fresh(TrackerDatabase(":memory:")))));

describe("tracker server functions", () => {
  it("sets an HttpOnly session cookie on sign-in and rejects requests without one", async () => {
    await runDb(
      Effect.gen(function* () {
        const response = makeResponseContext();
        const user = yield* signInFn
          .local({ name: "Mara Chen", email: "MARA@tracker.test " })
          .pipe(provideRequest(new Request("https://tracker.test/")), provideResponse(response));
        expect(user.id).toBe("u_mara0001");
        expect(response.cookies[0]).toMatch(
          /^tracker_session=[0-9a-f]{48}; .*HttpOnly; Secure; SameSite=Lax$/,
        );

        const anonymous = yield* Effect.flip(boardFn.local(TRK).pipe(asRequest(undefined)));
        expect(anonymous._tag).toBe("Unauthenticated");
        const forged = yield* Effect.flip(
          boardFn.local(TRK).pipe(asRequest(`${sessionCookieName}=forged`)),
        );
        expect(forged._tag).toBe("Unauthenticated");
      }),
    );
  });

  it("validates sign-in input", async () => {
    await runDb(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          signInFn.local({ name: "Al", email: "not an email" }).pipe(asRequest(undefined)),
        );
        expect(failure).toMatchObject({ _tag: "InvalidIssue", field: "email" });
      }),
    );
  });

  it("creates, moves, comments on, deletes, and restores an issue, logging each change", async () => {
    await runDb(
      Effect.gen(function* () {
        const cookie = yield* signedIn("noor@tracker.test");
        const as = asRequest(cookie);
        const before = yield* boardFn.local(TRK).pipe(as);
        const cursor = Math.max(...before.map((row) => row.seq));

        const created = yield* createIssueFn
          .local({
            projectKey: TRK,
            title: "  Ship the export  ",
            description: "CSV first.",
            status: "todo",
            priority: "high",
            assigneeId: null,
            // An id from another project is dropped.
            labelIds: ["l_trk-feature", "l_web-copy"] as LabelId[],
          })
          .pipe(as);
        expect(created).toMatchObject({
          id: "TRK-31",
          title: "Ship the export",
          reporterId: "u_noor0003",
          labelIds: ["l_trk-feature"],
        });

        const moved = yield* moveIssueFn
          .local({ id: created.id, status: "in_progress", position: 99 })
          .pipe(as);
        expect(moved).toMatchObject({ status: "in_progress", position: 99 });

        const comment = yield* addCommentFn
          .local({ id: "c_test00000001" as CommentId, issueId: created.id, body: "On it" })
          .pipe(as);
        // A replayed submission (same client id) does not comment twice.
        yield* addCommentFn
          .local({ id: "c_test00000001" as CommentId, issueId: created.id, body: "On it" })
          .pipe(as);
        expect(comment.authorId).toBe("u_noor0003");
        expect((yield* issueFn.local(created.id).pipe(as)).commentCount).toBe(1);

        const updated = yield* updateIssueFn
          .local({ id: created.id, priority: "urgent", assigneeId: "u_ilya0002" as never })
          .pipe(as);
        expect(updated).toMatchObject({ priority: "urgent", assigneeId: "u_ilya0002" });

        const activity = yield* activityFn.local(created.id).pipe(as);
        expect(activity.map((entry) => entry.detail)).toEqual([
          "created the issue",
          "Todo → In progress",
          "commented",
          "High → Urgent",
          "assigned it to Ilya Novak",
        ]);

        const changes = yield* changesFn.local({ projectKey: TRK, cursor }).pipe(as);
        expect(changes.upserts.map((row) => row.id)).toEqual([created.id]);
        expect(changes.deletes).toEqual([]);

        yield* deleteIssueFn.local({ id: created.id }).pipe(as);
        const gone = yield* Effect.flip(issueFn.local(created.id).pipe(as));
        expect(gone).toMatchObject({ _tag: "IssueNotFound", id: created.id });
        const afterDelete = yield* changesFn
          .local({ projectKey: TRK, cursor: changes.cursor })
          .pipe(as);
        expect(afterDelete).toMatchObject({ upserts: [], deletes: [created.id] });

        const restored = yield* restoreIssueFn.local({ id: created.id }).pipe(as);
        expect(restored.status).toBe("in_progress");
        expect((yield* boardFn.local(TRK).pipe(as)).some((row) => row.id === created.id)).toBe(
          true,
        );
      }),
    );
  });

  it("rejects an empty title with a field error", async () => {
    await runDb(
      Effect.gen(function* () {
        const cookie = yield* signedIn("theo@tracker.test");
        const failure = yield* Effect.flip(
          createIssueFn
            .local({
              projectKey: TRK,
              title: " x ",
              description: "",
              status: "todo",
              priority: "none",
              assigneeId: null,
              labelIds: [],
            })
            .pipe(asRequest(cookie)),
        );
        expect(failure).toMatchObject({ _tag: "InvalidIssue", field: "title" });
      }),
    );
  });

  it("searches, filters, sorts, and paginates on the server", async () => {
    await runDb(
      Effect.gen(function* () {
        const cookie = yield* signedIn("mara@tracker.test");
        const as = asRequest(cookie);
        const all = yield* searchFn.local(issueQueryOf(TRK, {})).pipe(as);
        expect(all).toMatchObject({ total: 30, page: 1, pageCount: 2 });
        expect(all.rows).toHaveLength(20);

        const second = yield* searchFn.local(issueQueryOf(TRK, { page: 2 })).pipe(as);
        expect(second.rows).toHaveLength(10);
        // A page past the end shows the last page.
        expect((yield* searchFn.local(issueQueryOf(TRK, { page: 9 })).pipe(as)).page).toBe(2);

        const polish = yield* searchFn.local(issueQueryOf(TRK, { q: "polish" })).pipe(as);
        expect(polish.rows.map((row) => row.title)).toEqual([
          "Polish focus rings (2)",
          "Polish focus rings (1)",
        ]);
        expect((yield* searchFn.local(issueQueryOf(TRK, { q: "trk-2" })).pipe(as)).total).toBe(1);

        const mineUrgent = yield* searchFn
          .local(issueQueryOf(TRK, { assignee: "me", sort: "priority" }))
          .pipe(as);
        expect(mineUrgent.rows.every((row) => row.assigneeId === "u_mara0001")).toBe(true);
        expect(mineUrgent.rows[0]!.priority).toBe("high");

        const byTitle = yield* searchFn
          .local(issueQueryOf(TRK, { status: "done", sort: "title" }))
          .pipe(as);
        const titles = byTitle.rows.map((row) => row.title);
        expect(titles).toEqual([...titles].sort((left, right) => left.localeCompare(right)));

        const labelled = yield* searchFn
          .local(issueQueryOf(TRK, { label: "l_trk-bug" as LabelId }))
          .pipe(as);
        expect(labelled.rows.map((row) => row.id)).toEqual(["TRK-2"]);

        const mine = yield* myIssuesFn.local("open").pipe(as);
        expect(mine.every((row) => row.status !== "done")).toBe(true);
        expect(mine[0]!.priority).toBe("high");
      }),
    );
  });

  it("answers ProjectNotFound for an unknown project", async () => {
    await runDb(
      Effect.gen(function* () {
        const cookie = yield* signedIn("mara@tracker.test");
        const failure = yield* Effect.flip(
          boardFn.local("NOPE" as ProjectKey).pipe(asRequest(cookie)),
        );
        expect(failure).toMatchObject({ _tag: "ProjectNotFound", key: "NOPE" });
      }),
    );
  });
});

describe("list URLs", () => {
  const decode = Schema.decodeUnknownSync(IssueListSearch);

  it("decodes every value the list view writes", () => {
    expect(
      decode({
        q: "board",
        status: "todo",
        priority: "high",
        assignee: "me",
        label: "l_trk-bug",
        sort: "title",
        page: "2",
      }),
    ).toEqual({
      q: "board",
      status: "todo",
      priority: "high",
      assignee: "me",
      label: "l_trk-bug",
      sort: "title",
      page: 2,
    });
  });

  it("ignores values it cannot decode instead of failing the page", () => {
    expect(decode({ status: "bogus", page: "abc", sort: "random", q: "ok" })).toEqual({ q: "ok" });
    expect(issueQueryOf(TRK, decode({ page: "0" }))).toMatchObject({ page: 1, sort: "updated" });
  });
});
