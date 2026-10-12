import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Config, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import type { IssuePriority, IssueStatus } from "./model.js";

/*
 * The Tracker's database: SQLite through Effect SQL (`@effect/sql-sqlite-node`
 * over `node:sqlite`). Migrations run once when the server Layer is built;
 * the seed migration gives a fresh database a team, two projects, and a
 * board worth of issues.
 */

const init = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE projects (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1
  )`;
  yield* sql`CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL REFERENCES projects(key),
    name TEXT NOT NULL,
    color TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_key TEXT NOT NULL REFERENCES projects(key),
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    assignee_id TEXT REFERENCES users(id),
    reporter_id TEXT NOT NULL REFERENCES users(id),
    position REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    seq INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE INDEX issues_project ON issues(project_key, deleted_at, status, position)`;
  yield* sql`CREATE TABLE issue_labels (
    issue_id TEXT NOT NULL REFERENCES issues(id),
    label_id TEXT NOT NULL REFERENCES labels(id),
    PRIMARY KEY (issue_id, label_id)
  )`;
  yield* sql`CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX comments_issue ON comments(issue_id, created_at)`;
  yield* sql`CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL REFERENCES issues(id),
    actor_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX activity_issue ON activity(issue_id, id)`;
  // The change log behind the board's live feed: one row per issue write.
  yield* sql`CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    project_key TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    op TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX changes_project ON changes(project_key, seq)`;
});

const seedUsers = [
  { id: "u_mara0001", name: "Mara Chen", email: "mara@tracker.test" },
  { id: "u_ilya0002", name: "Ilya Novak", email: "ilya@tracker.test" },
  { id: "u_noor0003", name: "Noor Haddad", email: "noor@tracker.test" },
  { id: "u_theo0004", name: "Theo Brandt", email: "theo@tracker.test" },
] as const;

const seedProjects = [
  {
    key: "TRK",
    name: "Tracker",
    description: "The issue tracker itself: board, list, and the sync engine underneath.",
  },
  {
    key: "WEB",
    name: "Website",
    description: "Marketing site and docs: copy, layout, and the launch checklist.",
  },
] as const;

const seedLabels = [
  { id: "l_trk-bug", project: "TRK", name: "bug", color: "#dc2626" },
  { id: "l_trk-feature", project: "TRK", name: "feature", color: "#2563eb" },
  { id: "l_trk-design", project: "TRK", name: "design", color: "#9333ea" },
  { id: "l_trk-infra", project: "TRK", name: "infra", color: "#0d9488" },
  { id: "l_trk-docs", project: "TRK", name: "docs", color: "#ca8a04" },
  { id: "l_web-copy", project: "WEB", name: "copy", color: "#ca8a04" },
  { id: "l_web-layout", project: "WEB", name: "layout", color: "#9333ea" },
  { id: "l_web-bug", project: "WEB", name: "bug", color: "#dc2626" },
] as const;

interface SeedIssue {
  readonly project: "TRK" | "WEB";
  readonly title: string;
  readonly description: string;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
  readonly assignee: number | null;
  readonly labels: ReadonlyArray<string>;
}

const seedIssues: ReadonlyArray<SeedIssue> = [
  {
    project: "TRK",
    title: "Draft the onboarding checklist",
    description:
      "New teammates should be able to file their first issue in **five minutes**.\n\n- Sign in\n- Pick a project\n- File an issue from the board",
    status: "in_progress",
    priority: "high",
    assignee: 0,
    labels: ["l_trk-docs"],
  },
  {
    project: "TRK",
    title: "Board columns jump when a card moves",
    description:
      "Moving a card between columns re-renders the whole board. Keep cards keyed by id so only the moved card changes.",
    status: "todo",
    priority: "urgent",
    assignee: 1,
    labels: ["l_trk-bug"],
  },
  {
    project: "TRK",
    title: "Search issues by title and description",
    description: "Debounced search in the list view; the query lives in the URL.",
    status: "done",
    priority: "medium",
    assignee: 2,
    labels: ["l_trk-feature"],
  },
  {
    project: "TRK",
    title: "Keyboard shortcuts for the board",
    description: "`c` to create, `/` to search, `g b` / `g l` to switch views.",
    status: "backlog",
    priority: "low",
    assignee: null,
    labels: ["l_trk-feature", "l_trk-design"],
  },
  {
    project: "TRK",
    title: "Comments should render markdown",
    description: "Support `code`, **bold**, _emphasis_, links, and lists. No raw HTML.",
    status: "in_review",
    priority: "medium",
    assignee: 3,
    labels: ["l_trk-feature"],
  },
  {
    project: "TRK",
    title: "Back up the database nightly",
    description: "Use the SQLite backup API; keep seven days.",
    status: "todo",
    priority: "high",
    assignee: 3,
    labels: ["l_trk-infra"],
  },
  {
    project: "WEB",
    title: "Rewrite the pricing page copy",
    description: "Shorter, calmer, and no exclamation marks.",
    status: "todo",
    priority: "medium",
    assignee: 0,
    labels: ["l_web-copy"],
  },
  {
    project: "WEB",
    title: "Footer overlaps the content on small screens",
    description: "Reproduces at 360px wide.",
    status: "in_progress",
    priority: "high",
    assignee: 2,
    labels: ["l_web-bug", "l_web-layout"],
  },
];

const fillerTopics = [
  "Audit empty states",
  "Tidy the settings page",
  "Trim unused CSS",
  "Polish focus rings",
  "Write the changelog entry",
  "Measure board render time",
  "Check color contrast",
  "Review error copy",
  "Add loading skeletons",
  "Profile the search query",
  "Document the sync protocol",
  "Retire the legacy importer",
] as const;

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const at = (minutesAgo: number): string =>
    new Date(Date.UTC(2026, 9, 1, 9, 0) - minutesAgo * 60_000).toISOString();
  for (const user of seedUsers) {
    yield* sql`INSERT INTO users ${sql.insert({ ...user, created_at: at(100_000) })}`;
  }
  for (const project of seedProjects) {
    yield* sql`INSERT INTO projects ${sql.insert({ ...project, next_number: 1 })}`;
  }
  for (const label of seedLabels) {
    yield* sql`INSERT INTO labels ${sql.insert({
      id: label.id,
      project_key: label.project,
      name: label.name,
      color: label.color,
    })}`;
  }
  // Enough TRK issues that the list view has a second page.
  const filler: ReadonlyArray<SeedIssue> = Array.from({ length: 24 }, (_, index) => ({
    project: "TRK",
    title: `${fillerTopics[index % fillerTopics.length]} (${Math.floor(index / fillerTopics.length) + 1})`,
    description: "",
    status: (["backlog", "todo", "done", "backlog"] as const)[index % 4]!,
    priority: (["low", "none", "medium", "low", "high"] as const)[index % 5]!,
    assignee: index % 3 === 0 ? null : index % 4,
    labels: index % 5 === 0 ? ["l_trk-design"] : [],
  }));
  let seq = 0;
  for (const [index, issue] of [...seedIssues, ...filler].entries()) {
    const [{ next_number } = { next_number: 0 }] = yield* sql<{
      readonly next_number: number;
    }>`UPDATE projects SET next_number = next_number + 1 WHERE key = ${issue.project} RETURNING next_number - 1 AS next_number`;
    const id = `${issue.project}-${next_number}`;
    const createdAt = at(5_000 - index * 90);
    seq++;
    yield* sql`INSERT INTO issues ${sql.insert({
      id,
      project_key: issue.project,
      number: next_number,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      assignee_id: issue.assignee === null ? null : seedUsers[issue.assignee]!.id,
      reporter_id: seedUsers[index % seedUsers.length]!.id,
      position: index + 1,
      created_at: createdAt,
      updated_at: createdAt,
      seq,
    })}`;
    yield* sql`INSERT INTO changes ${sql.insert({ seq, project_key: issue.project, issue_id: id, op: "upsert" })}`;
    yield* sql`INSERT INTO activity ${sql.insert({
      issue_id: id,
      actor_id: seedUsers[index % seedUsers.length]!.id,
      kind: "created",
      detail: "created the issue",
      created_at: createdAt,
    })}`;
    for (const label of issue.labels) {
      yield* sql`INSERT INTO issue_labels ${sql.insert({ issue_id: id, label_id: label })}`;
    }
  }
  yield* sql`INSERT INTO comments ${sql.insert({
    id: "c_seed00000001",
    issue_id: "TRK-1",
    author_id: seedUsers[1].id,
    body: "Let's keep the checklist to one screen. `c` should open the composer from anywhere.",
    created_at: at(1_000),
  })}`;
});

/** The migrations, in order. A fresh database also gets the seed data. */
export const TrackerMigrations = SqliteMigrator.fromRecord({
  "1_init": init,
  "2_seed": seed,
});

/** Runs pending migrations when built. */
export const TrackerMigratorLive = SqliteMigrator.layer({ loader: TrackerMigrations });

/**
 * The database client for a file (or `":memory:"`), migrated and seeded.
 * Tests use `TrackerDatabase(":memory:")` for an isolated database each.
 */
export const TrackerDatabase = (filename: string) =>
  TrackerMigratorLive.pipe(Layer.provideMerge(SqliteClient.layer({ filename })));

/** The server's database: `TRACKER_DB` or `.data/tracker.db` under the working directory. */
export const TrackerDatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const filename = yield* Config.String("TRACKER_DB").pipe(
      Config.withDefault(".data/tracker.db"),
    );
    if (filename !== ":memory:") {
      yield* Effect.sync(() => mkdirSync(dirname(filename), { recursive: true }));
    }
    return TrackerDatabase(filename);
  }),
);
