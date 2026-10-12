import {
  Action,
  ActionResult,
  RequestContext,
  Resource,
  ResponseContext,
  Server,
} from "@sunfall/arc-core";
import { DateTime, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { SqlError } from "effect/sql/SqlError";
import {
  AddComment,
  CreateIssue,
  DeleteIssue,
  MoveIssue,
  RestoreIssue,
  SignIn,
  SignOut,
  UpdateIssue,
  createIssueInputOf,
  type AddCommentInput,
  type CreateIssueInput,
  type SignInInput,
  type UpdateIssueInput,
} from "./actions.js";
import {
  ActivityLog,
  Board,
  Comments,
  CurrentUser,
  IssueById,
  IssueChangesContract,
  IssueSearch,
  Labels,
  MyIssues,
  Projects,
  Team,
} from "./resources.js";
import { issueHref, safeRedirect } from "./hrefs.js";
import {
  InvalidIssue,
  IssueNotFound,
  ProjectNotFound,
  Unauthenticated,
  issuePageSize,
  priorityLabel,
  statusLabel,
  type Activity,
  type ActivityKind,
  type Comment,
  type Issue,
  type IssueId,
  type IssuePriority,
  type IssueQuery,
  type IssueRow,
  type IssueStatus,
  type Label,
  type LabelId,
  type Project,
  type ProjectKey,
  type User,
  type UserId,
} from "./model.js";

/*
 * Server-only: the session, the queries, and the implementations of the
 * served Resources (reads) and Actions (writes). Every read and write
 * runs on the request runtime, so the session cookie comes from
 * `RequestContext` and sign-in sets it through `ResponseContext`.
 */

export const sessionCookieName = "tracker_session";

const now = Effect.map(DateTime.now, DateTime.formatIso);

const randomToken = (bytes: number): Effect.Effect<string> =>
  Effect.sync(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  );

// --- Rows --------------------------------------------------------------------

interface IssueRecord {
  readonly id: string;
  readonly project_key: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee_id: string | null;
  readonly reporter_id: string;
  readonly position: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly seq: number;
  readonly comment_count: number;
  readonly label_ids: string | null;
}

const toIssueRow = (record: IssueRecord): IssueRow => ({
  id: record.id as IssueId,
  projectKey: record.project_key as ProjectKey,
  number: record.number,
  title: record.title,
  status: record.status as IssueStatus,
  priority: record.priority as IssuePriority,
  assigneeId: record.assignee_id as UserId | null,
  labelIds: (record.label_ids === null ? [] : record.label_ids.split(",")).sort() as LabelId[],
  commentCount: record.comment_count,
  position: record.position,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
  seq: record.seq,
});

const toIssue = (record: IssueRecord): Issue => ({
  ...toIssueRow(record),
  description: record.description,
  reporterId: record.reporter_id as UserId,
});

const toUser = (record: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}): User => ({ id: record.id as UserId, name: record.name, email: record.email });

const issueColumns = (sql: SqlClient.SqlClient) => sql`
  i.*,
  (SELECT count(*) FROM comments c WHERE c.issue_id = i.id) AS comment_count,
  (SELECT group_concat(label_id, ',') FROM issue_labels il WHERE il.issue_id = i.id) AS label_ids
`;

const issueRecord = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<IssueRecord>`
      SELECT ${issueColumns(sql)} FROM issues i WHERE i.id = ${id} AND i.deleted_at IS NULL`;
    const record = rows[0];
    return record === undefined ? yield* new IssueNotFound({ id }) : record;
  });

// --- Session -----------------------------------------------------------------

/** The signed-in user, from the session cookie; `None` without a valid session. */
const sessionUser = Effect.gen(function* () {
  const request = yield* RequestContext;
  const token = request.cookies.get(sessionCookieName);
  if (token === undefined) {
    return Option.none<User>();
  }
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly id: string; readonly name: string; readonly email: string }>`
    SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}`;
  return Option.map(Option.fromNullishOr(rows[0]), toUser);
});

const requireUser = Effect.flatMap(sessionUser, (user) =>
  Option.isSome(user) ? Effect.succeed(user.value) : Effect.fail(new Unauthenticated()),
);

/** Runs a handler for a signed-in user; database failures are defects. */
const authed = <A, E, R>(
  f: (user: User) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  Exclude<E, SqlError> | Unauthenticated,
  R | SqlClient.SqlClient | RequestContext
> =>
  requireUser.pipe(
    Effect.flatMap(f),
    Effect.catchIf((error): error is SqlError => error instanceof SqlError, Effect.die),
  ) as Effect.Effect<
    A,
    Exclude<E, SqlError> | Unauthenticated,
    R | SqlClient.SqlClient | RequestContext
  >;

// --- Writes' bookkeeping ------------------------------------------------------

const recordChange = (projectKey: string, issueId: string, op: "upsert" | "delete") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly seq: number }>`
      INSERT INTO changes ${sql.insert({ project_key: projectKey, issue_id: issueId, op })}
      RETURNING seq`;
    yield* sql`UPDATE issues SET seq = ${row!.seq} WHERE id = ${issueId}`;
  });

const recordActivity = (issueId: string, actor: User, kind: ActivityKind, detail: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO activity ${sql.insert({
      issue_id: issueId,
      actor_id: actor.id,
      kind,
      detail,
      created_at: yield* now,
    })}`;
  });

const validTitle = (title: string): Effect.Effect<string, InvalidIssue> => {
  const trimmed = title.trim();
  return trimmed.length < 3
    ? Effect.fail(new InvalidIssue({ field: "title", message: "Give the issue a title." }))
    : trimmed.length > 140
      ? Effect.fail(
          new InvalidIssue({ field: "title", message: "Keep the title under 140 characters." }),
        )
      : Effect.succeed(trimmed);
};

const requireProject = (key: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly key: string }>`SELECT key FROM projects WHERE key = ${key}`;
    return rows.length === 0 ? yield* new ProjectNotFound({ key }) : key;
  });

const userName = (id: string | null) =>
  Effect.gen(function* () {
    if (id === null) {
      return "nobody";
    }
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly name: string }>`SELECT name FROM users WHERE id = ${id}`;
    return rows[0]?.name ?? "someone";
  });

const setLabels = (issueId: string, projectKey: string, labelIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM issue_labels WHERE issue_id = ${issueId}`;
    const known = yield* sql<{ readonly id: string }>`
      SELECT id FROM labels WHERE project_key = ${projectKey}`;
    const allowed = new Set(known.map((label) => label.id));
    for (const labelId of new Set(labelIds)) {
      if (allowed.has(labelId)) {
        yield* sql`INSERT INTO issue_labels ${sql.insert({ issue_id: issueId, label_id: labelId })}`;
      }
    }
  });

// --- Reads -------------------------------------------------------------------

const listIssueRows = (projectKey: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<IssueRecord>`
      SELECT ${issueColumns(sql)} FROM issues i
      WHERE i.project_key = ${projectKey} AND i.deleted_at IS NULL
      ORDER BY i.position`;
    return rows.map(toIssueRow);
  });

const sortClause = (sql: SqlClient.SqlClient, sort: IssueQuery["sort"]) => {
  switch (sort) {
    case "created":
      return sql`i.created_at DESC, i.number DESC`;
    case "title":
      return sql`i.title COLLATE NOCASE ASC, i.number ASC`;
    case "priority":
      return sql`CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, i.updated_at DESC`;
    case "updated":
      return sql`i.updated_at DESC, i.number DESC`;
  }
};

const searchIssueRows = (query: IssueQuery, user: User) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* requireProject(query.projectKey);
    const text = query.q.trim();
    const conditions = [
      sql`i.project_key = ${query.projectKey}`,
      sql`i.deleted_at IS NULL`,
      ...(text.length === 0
        ? []
        : [
            sql`(i.title LIKE ${`%${text}%`} OR i.description LIKE ${`%${text}%`} OR i.id = ${text.toUpperCase()})`,
          ]),
      ...(query.status === null ? [] : [sql`i.status = ${query.status}`]),
      ...(query.priority === null ? [] : [sql`i.priority = ${query.priority}`]),
      ...(query.assignee === null
        ? []
        : query.assignee === "none"
          ? [sql`i.assignee_id IS NULL`]
          : [sql`i.assignee_id = ${query.assignee === "me" ? user.id : query.assignee}`]),
      ...(query.label === null
        ? []
        : [
            sql`EXISTS (SELECT 1 FROM issue_labels il WHERE il.issue_id = i.id AND il.label_id = ${query.label})`,
          ]),
    ];
    const where = sql.and(conditions);
    const [{ total } = { total: 0 }] = yield* sql<{
      readonly total: number;
    }>`SELECT count(*) AS total FROM issues i WHERE ${where}`;
    const pageCount = Math.max(1, Math.ceil(total / issuePageSize));
    const page = Math.min(Math.max(1, Math.floor(query.page)), pageCount);
    const rows = yield* sql<IssueRecord>`
      SELECT ${issueColumns(sql)} FROM issues i WHERE ${where}
      ORDER BY ${sortClause(sql, query.sort)}
      LIMIT ${issuePageSize} OFFSET ${(page - 1) * issuePageSize}`;
    return { rows: rows.map(toIssueRow), total: total, page, pageCount };
  });

const changesSince = (projectKey: string, cursor: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const log = yield* sql<{
      readonly seq: number;
      readonly issue_id: string;
      readonly op: string;
    }>`
      SELECT seq, issue_id, op FROM changes
      WHERE project_key = ${projectKey} AND seq > ${cursor} ORDER BY seq`;
    if (log.length === 0) {
      return { upserts: [], deletes: [], cursor };
    }
    const latest = new Map<string, string>();
    for (const entry of log) {
      latest.set(entry.issue_id, entry.op);
    }
    const upsertIds = [...latest].filter(([, op]) => op === "upsert").map(([id]) => id);
    const rows =
      upsertIds.length === 0
        ? []
        : yield* sql<IssueRecord>`
            SELECT ${issueColumns(sql)} FROM issues i
            WHERE ${sql.in("i.id", upsertIds)} AND i.deleted_at IS NULL`;
    return {
      upserts: rows.map(toIssueRow),
      deletes: [...latest].filter(([, op]) => op === "delete").map(([id]) => id as IssueId),
      cursor: log[log.length - 1]!.seq,
    };
  });

// --- Writes ------------------------------------------------------------------

const createIssueRecord = (input: CreateIssueInput, user: User) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const title = yield* validTitle(input.title);
    yield* requireProject(input.projectKey);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const [{ number } = { number: 0 }] = yield* sql<{ readonly number: number }>`
          UPDATE projects SET next_number = next_number + 1 WHERE key = ${input.projectKey}
          RETURNING next_number - 1 AS number`;
        const [{ position } = { position: 1 }] = yield* sql<{ readonly position: number }>`
          SELECT coalesce(max(position), 0) + 1 AS position FROM issues
          WHERE project_key = ${input.projectKey}`;
        const id = `${input.projectKey}-${number}`;
        const createdAt = yield* now;
        yield* sql`INSERT INTO issues ${sql.insert({
          id,
          project_key: input.projectKey,
          number,
          title,
          description: input.description.trim(),
          status: input.status,
          priority: input.priority,
          assignee_id: input.assigneeId,
          reporter_id: user.id,
          position,
          created_at: createdAt,
          updated_at: createdAt,
        })}`;
        yield* setLabels(id, input.projectKey, input.labelIds);
        yield* recordActivity(id, user, "created", "created the issue");
        yield* recordChange(input.projectKey, id, "upsert");
        return toIssue(yield* issueRecord(id));
      }),
    );
  });

const updateIssueRecord = (input: UpdateIssueInput, user: User) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const title = input.title === undefined ? undefined : yield* validTitle(input.title);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const before = toIssue(yield* issueRecord(input.id));
        const updatedAt = yield* now;
        if (title !== undefined && title !== before.title) {
          yield* sql`UPDATE issues SET title = ${title} WHERE id = ${input.id}`;
          yield* recordActivity(input.id, user, "title", `renamed it to “${title}”`);
        }
        if (input.description !== undefined && input.description.trim() !== before.description) {
          yield* sql`UPDATE issues SET description = ${input.description.trim()} WHERE id = ${input.id}`;
          yield* recordActivity(input.id, user, "description", "edited the description");
        }
        if (input.priority !== undefined && input.priority !== before.priority) {
          yield* sql`UPDATE issues SET priority = ${input.priority} WHERE id = ${input.id}`;
          yield* recordActivity(
            input.id,
            user,
            "priority",
            `${priorityLabel(before.priority)} → ${priorityLabel(input.priority)}`,
          );
        }
        if (input.assigneeId !== undefined && input.assigneeId !== before.assigneeId) {
          yield* sql`UPDATE issues SET assignee_id = ${input.assigneeId} WHERE id = ${input.id}`;
          yield* recordActivity(
            input.id,
            user,
            "assignee",
            input.assigneeId === null
              ? "unassigned it"
              : `assigned it to ${yield* userName(input.assigneeId)}`,
          );
        }
        if (input.labelIds !== undefined) {
          yield* setLabels(input.id, before.projectKey, input.labelIds);
          yield* recordActivity(input.id, user, "labels", "changed the labels");
        }
        yield* sql`UPDATE issues SET updated_at = ${updatedAt} WHERE id = ${input.id}`;
        yield* recordChange(before.projectKey, input.id, "upsert");
        return toIssue(yield* issueRecord(input.id));
      }),
    );
  });

const moveIssueRecord = (
  input: { readonly id: IssueId; readonly status: IssueStatus; readonly position: number },
  user: User,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const before = toIssueRow(yield* issueRecord(input.id));
        yield* sql`UPDATE issues SET status = ${input.status}, position = ${input.position},
          updated_at = ${yield* now} WHERE id = ${input.id}`;
        if (before.status !== input.status) {
          yield* recordActivity(
            input.id,
            user,
            "status",
            `${statusLabel(before.status)} → ${statusLabel(input.status)}`,
          );
        }
        yield* recordChange(before.projectKey, input.id, "upsert");
        return toIssueRow(yield* issueRecord(input.id));
      }),
    );
  });

const addCommentRecord = (input: AddCommentInput, user: User) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const body = input.body.trim();
    if (body.length === 0) {
      return yield* new InvalidIssue({ field: "body", message: "Write something first." });
    }
    const issue = toIssueRow(yield* issueRecord(input.issueId));
    // The id is the client's, so a replayed submission does not comment twice.
    const existing = yield* sql<{
      readonly id: string;
    }>`SELECT id FROM comments WHERE id = ${input.id}`;
    const createdAt = yield* now;
    if (existing.length === 0) {
      yield* sql`INSERT INTO comments ${sql.insert({
        id: input.id,
        issue_id: input.issueId,
        author_id: user.id,
        body,
        created_at: createdAt,
      })}`;
      yield* recordActivity(input.issueId, user, "commented", "commented");
      yield* sql`UPDATE issues SET updated_at = ${createdAt} WHERE id = ${input.issueId}`;
      yield* recordChange(issue.projectKey, input.issueId, "upsert");
    }
    const [row] = yield* sql<{
      readonly id: string;
      readonly issue_id: string;
      readonly author_id: string;
      readonly body: string;
      readonly created_at: string;
    }>`SELECT * FROM comments WHERE id = ${input.id}`;
    return {
      id: row!.id as Comment["id"],
      issueId: row!.issue_id as IssueId,
      authorId: row!.author_id as UserId,
      body: row!.body,
      createdAt: row!.created_at,
    } satisfies Comment;
  });

// --- Reads: the served Resources' implementations -----------------------------

export const currentUser = Resource.implement(CurrentUser, () =>
  sessionUser.pipe(Effect.map(Option.getOrNull), Effect.catchTag("SqlError", Effect.die)),
);

/** Signs in (creating the account for a new email) and sets the session cookie. */
const signInUser = (input: SignInInput) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (name.length < 2) {
      return yield* new InvalidIssue({ field: "name", message: "Tell us your name." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return yield* new InvalidIssue({ field: "email", message: "Use a valid email address." });
    }
    const existing = yield* sql<{
      readonly id: string;
      readonly name: string;
      readonly email: string;
    }>`
      SELECT id, name, email FROM users WHERE email = ${email}`;
    const user =
      existing[0] === undefined
        ? yield* Effect.gen(function* () {
            const created = {
              id: `u_${(yield* randomToken(8)).slice(0, 12)}`,
              name,
              email,
              created_at: yield* now,
            };
            yield* sql`INSERT INTO users ${sql.insert(created)}`;
            return toUser(created);
          })
        : toUser(existing[0]);
    const token = yield* randomToken(24);
    yield* sql`INSERT INTO sessions ${sql.insert({ token, user_id: user.id, created_at: yield* now })}`;
    const request = yield* RequestContext;
    yield* ResponseContext.use((response) =>
      response.setCookie(sessionCookieName, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: request.url.protocol === "https:",
        maxAge: 60 * 60 * 24 * 30,
      }),
    ).pipe(Effect.orDie);
    return user;
  }).pipe(Effect.catchTag("SqlError", Effect.die));

const signOutSession = Effect.gen(function* () {
  const request = yield* RequestContext;
  const token = request.cookies.get(sessionCookieName);
  if (token !== undefined) {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM sessions WHERE token = ${token}`;
  }
  yield* ResponseContext.use((response) =>
    response.deleteCookie(sessionCookieName, { path: "/" }),
  ).pipe(Effect.orDie);
}).pipe(Effect.catchTag("SqlError", Effect.die));

export const team = Resource.implement(Team, () =>
  authed(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly id: string;
        readonly name: string;
        readonly email: string;
      }>`
        SELECT id, name, email FROM users ORDER BY name`;
      return rows.map(toUser);
    }),
  ),
);

export const projects = Resource.implement(Projects, () =>
  authed(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly key: string;
        readonly name: string;
        readonly description: string;
        readonly open_count: number;
      }>`
        SELECT p.key, p.name, p.description,
          (SELECT count(*) FROM issues i WHERE i.project_key = p.key AND i.deleted_at IS NULL
            AND i.status != 'done') AS open_count
        FROM projects p ORDER BY p.name`;
      return rows.map(
        (row): Project => ({
          key: row.key as ProjectKey,
          name: row.name,
          description: row.description,
          openCount: row.open_count,
        }),
      );
    }),
  ),
);

export const labels = Resource.implement(Labels, (projectKey) =>
  authed(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* requireProject(projectKey);
      const rows = yield* sql<{
        readonly id: string;
        readonly project_key: string;
        readonly name: string;
        readonly color: string;
      }>`SELECT * FROM labels WHERE project_key = ${projectKey} ORDER BY name`;
      return rows.map(
        (row): Label => ({
          id: row.id as LabelId,
          projectKey: row.project_key as ProjectKey,
          name: row.name,
          color: row.color,
        }),
      );
    }),
  ),
);

export const board = Resource.implement(Board, (projectKey) =>
  authed(() =>
    Effect.gen(function* () {
      yield* requireProject(projectKey);
      return yield* listIssueRows(projectKey);
    }),
  ),
);

export const issueChanges = Server.implement(IssueChangesContract, ({ projectKey, cursor }) =>
  authed(() => changesSince(projectKey, cursor)),
);

export const issueSearch = Resource.implement(IssueSearch, (query) =>
  authed((user) => searchIssueRows(query, user)),
);

export const myIssues = Resource.implement(MyIssues, () =>
  authed((user) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<IssueRecord>`
        SELECT ${issueColumns(sql)} FROM issues i
        WHERE i.assignee_id = ${user.id} AND i.deleted_at IS NULL AND i.status != 'done'
        ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
          WHEN 'low' THEN 3 ELSE 4 END, i.updated_at DESC`;
      return rows.map(toIssueRow);
    }),
  ),
);

export const issueById = Resource.implement(IssueById, (id) =>
  authed(() => Effect.map(issueRecord(id), toIssue)),
);

export const comments = Resource.implement(Comments, (issueId) =>
  authed(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* issueRecord(issueId);
      const rows = yield* sql<{
        readonly id: string;
        readonly issue_id: string;
        readonly author_id: string;
        readonly body: string;
        readonly created_at: string;
      }>`SELECT * FROM comments WHERE issue_id = ${issueId} ORDER BY created_at, id`;
      return rows.map(
        (row): Comment => ({
          id: row.id as Comment["id"],
          issueId: row.issue_id as IssueId,
          authorId: row.author_id as UserId,
          body: row.body,
          createdAt: row.created_at,
        }),
      );
    }),
  ),
);

export const activityLog = Resource.implement(ActivityLog, (issueId) =>
  authed(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* issueRecord(issueId);
      const rows = yield* sql<{
        readonly id: number;
        readonly issue_id: string;
        readonly actor_id: string;
        readonly kind: string;
        readonly detail: string;
        readonly created_at: string;
      }>`SELECT * FROM activity WHERE issue_id = ${issueId} ORDER BY id`;
      return rows.map(
        (row): Activity => ({
          id: row.id,
          issueId: row.issue_id as IssueId,
          actorId: row.actor_id as UserId,
          kind: row.kind as ActivityKind,
          detail: row.detail,
          createdAt: row.created_at,
        }),
      );
    }),
  ),
);

// --- Writes: the served Actions' implementations -------------------------------

/** A field-level validation failure becomes a form result instead of an error. */
const asValidation = (error: InvalidIssue) =>
  ActionResult.validation<Record<string, unknown>, string>({
    fieldErrors: { [error.field]: [error.message] },
  });

export const signIn = Action.implement(SignIn, (input) =>
  signInUser(input).pipe(
    Effect.as(ActionResult.redirect(safeRedirect(input.redirectTo), { replace: true })),
    Effect.catchTag("InvalidIssue", (error) => Effect.succeed(asValidation(error))),
  ),
);

export const signOut = Action.implement(SignOut, () =>
  signOutSession.pipe(Effect.as(ActionResult.redirect("/signin", { replace: true }))),
);

export const createIssue = Action.implement(CreateIssue, (form) =>
  authed((user) => createIssueRecord(createIssueInputOf(form), user)).pipe(
    Effect.map((issue) => ActionResult.redirect(issueHref(issue.id))),
    Effect.catchTag("InvalidIssue", (error) => Effect.succeed(asValidation(error))),
  ),
);

export const updateIssue = Action.implement(UpdateIssue, (input) =>
  authed((user) => updateIssueRecord(input, user)),
);

export const moveIssue = Action.implement(MoveIssue, (input) =>
  authed((user) => moveIssueRecord(input, user)),
);

export const addComment = Action.implement(AddComment, (input) =>
  authed((user) => addCommentRecord(input, user)),
);

export const deleteIssue = Action.implement(DeleteIssue, ({ id }) =>
  authed((user) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const row = toIssueRow(yield* issueRecord(id));
      yield* sql`UPDATE issues SET deleted_at = ${yield* now} WHERE id = ${id}`;
      yield* recordActivity(id, user, "deleted", "deleted the issue");
      yield* recordChange(row.projectKey, id, "delete");
      return row;
    }),
  ),
);

export const restoreIssue = Action.implement(RestoreIssue, ({ id }) =>
  authed((user) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly project_key: string }>`
        SELECT project_key FROM issues WHERE id = ${id} AND deleted_at IS NOT NULL`;
      if (rows[0] === undefined) {
        return yield* new IssueNotFound({ id });
      }
      yield* sql`UPDATE issues SET deleted_at = NULL, updated_at = ${yield* now} WHERE id = ${id}`;
      yield* recordActivity(id, user, "restored", "restored the issue");
      yield* recordChange(rows[0].project_key, id, "upsert");
      return toIssueRow(yield* issueRecord(id));
    }),
  ),
);

/** Everything the Start handler serves: the reads, the change feed's poll, and the writes. */
export const implementations = [
  currentUser,
  team,
  projects,
  labels,
  board,
  issueChanges,
  issueSearch,
  myIssues,
  issueById,
  comments,
  activityLog,
  signIn,
  signOut,
  createIssue,
  updateIssue,
  moveIssue,
  addComment,
  deleteIssue,
  restoreIssue,
] as const;
