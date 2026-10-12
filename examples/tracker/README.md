# Tracker

A small team issue tracker built on Arc, as a real app rather than a demo:
projects, a board, a searchable list, issues with markdown descriptions,
comments, and history, on a SQLite database. Building it found the gaps
recorded in [FRICTION.md](FRICTION.md).

## Run it

From the repository root:

```sh
pnpm install
pnpm build            # the framework packages the dev server's plugin loads
pnpm tracker:dev      # http://127.0.0.1:5173
```

Sign in with any name and email (there is no password); `mara@tracker.test`
already has issues assigned. The database lives in `.data/tracker.db` (set
`TRACKER_DB` to move it, or `:memory:` for a throwaway one) and is migrated
and seeded on first start.

```sh
pnpm tracker:test     # domain, Action, and SSR tests (in-memory SQLite)
pnpm tracker:verify   # typecheck, tests, client build, server-only leak scan
```

## What it uses

| Concern           | Where                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Database          | `src/db.server.ts`: `@effect/sql-sqlite-node` (Effect SQL over `node:sqlite`), migrations, seed                               |
| Session           | `src/api.server.ts`: HttpOnly `tracker_session` cookie via `ResponseContext`; `src/session.ts`: `Route.redirect` to sign-in   |
| Server boundary   | `src/contracts.ts` (contracts and browser clients), `src/api.server.ts` (implementations)                                     |
| Reads             | `src/resources.ts`: Resources with `rows`; the board's `rows.changes` polls the change log                                    |
| Writes            | `src/actions.ts`: served Actions; moves are optimistic and durable, comments optimistic, delete with undo                     |
| Routes            | `src/routes/**`: file routes with lazy `*.component.tsx` pages; unknown issues and projects end with `Route.notFound()` (404) |
| URL state         | `/projects/:key/issues?q=&status=&priority=&assignee=&label=&sort=&page=`, lenient search schemas in `src/model.ts`           |
| Client state      | `State`s for the filter drawer, search draft, editor, board filter, shortcuts, and undo toast                                 |
| Progressive forms | sign-in, new issue, and sign-out post their Actions without JavaScript                                                        |
| Timeline          | the "Timeline" button in development (`src/timeline-panel.tsx`)                                                               |

Keyboard: `c` new issue, `/` search, `g b` board, `g l` list, `g h` home,
`?` help.
