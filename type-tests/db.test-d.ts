import { Context, Effect, Schema } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { Resource } from "@sunfall/arc-core";
import { Query, QueryEvaluationError, UnsupportedLiveQuery } from "@sunfall/arc-db";
import { Component } from "@sunfall/arc-solid";
// @ts-expect-error QueryBuilder construction is internal; use query.from(...) and Query.Builder.
import { QueryBuilder } from "@sunfall/arc-db";
// @ts-expect-error Collections were folded into Resources: declare `rows` on Resource.define.
import { Collection } from "@sunfall/arc-db";
void QueryBuilder;
void Collection;

type Assert<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const ProjectSchema = Schema.Struct({ id: Schema.String, name: Schema.String });
type Project = typeof ProjectSchema.Type;
const TaskSchema = Schema.Struct({
  id: Schema.Number,
  projectId: Schema.String,
  title: Schema.String,
});

interface ProjectFeed {
  readonly list: () => Effect.Effect<ReadonlyArray<Project>, "load">;
}
const ProjectFeed = Context.Service<ProjectFeed>("type-tests/db/ProjectFeed");

// Query sources are refs of Resources that declare `rows`.
const Projects = Resource.define({
  name: "type-tests/db/projects",
  input: Schema.Literal("all"),
  output: Schema.Array(ProjectSchema),
  rows: { key: (project) => project.id, indexes: { byName: (project) => project.name } },
  load: () => ProjectFeed.use((feed) => feed.list()),
});
const ProjectsRef = Projects("all");
const Tasks = Resource.define({
  name: "type-tests/db/tasks",
  input: Schema.Literal("all"),
  output: Schema.Array(TaskSchema),
  rows: { key: (task) => task.id, indexes: { byProject: (task) => task.projectId } },
  load: () => Effect.succeed([] as ReadonlyArray<typeof TaskSchema.Type>),
});
const TasksRef = Tasks("all");
// A Resource without `rows` is not a query source.
const ProjectCount = Resource.define({
  name: "type-tests/db/project-count",
  input: Schema.Literal("all"),
  output: Schema.Number,
  load: () => Effect.succeed(0),
});

// --- Row, error, and service inference ---

const projectNames = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .where(({ project }) => project.name !== "")
    .select(({ project }) => project.name),
);
type _liveRows = Assert<Eq<typeof projectNames, Query.Live<string, "load", ProjectFeed>>>;
const liveState: AsyncResult.AsyncResult<
  ReadonlyArray<string>,
  "load" | QueryEvaluationError
> = projectNames.state.get();
const livePreload: Effect.Effect<void, "load" | QueryEvaluationError, ProjectFeed> =
  projectNames.preload();
const onceRows: Effect.Effect<
  ReadonlyArray<Project>,
  "load" | QueryEvaluationError,
  ProjectFeed
> = Query.once((query) => query.from({ project: ProjectsRef }).select(({ project }) => project));

// Joins carry both sources' rows; indexed joins name the source's `rows.indexes`.
const projectTasks = Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}:${task.title}`),
);
const projectTaskRows: ReadonlyArray<string> = projectTasks.rows.get();
Query.live((query) =>
  query
    .from({ project: ProjectsRef })
    // @ts-expect-error indexed joins name an index the joined source declares
    .joinIndexed("task", TasksRef, ({ project }) => project.id, "byOwner"),
);
Query.live((query) =>
  query.from({ project: ProjectsRef }).join(
    "task",
    TasksRef,
    ({ project }) => project.id,
    // @ts-expect-error joined row fields are type checked
    (task) => task.missing,
  ),
);
Query.live((query) =>
  // @ts-expect-error a Resource without `rows` is not a query source
  query.from({ count: ProjectCount("all") }),
);

// --- Component.liveQuery: source errors join E, services join R ---

const liveQueryBinding: Effect.Effect<
  Component.LiveQueryHandle<string, "load">,
  "load",
  ProjectFeed
> = Component.liveQuery((query) =>
  query.from({ project: ProjectsRef }).select(({ project }) => project.name),
);
declare const liveQueryHandle: Component.LiveQueryHandle<string, "load">;
const liveQueryRows: ReadonlyArray<string> = liveQueryHandle.rows();
const liveQueryWaiting: boolean = liveQueryHandle.waiting();
const liveQueryRefresh: Effect.Effect<void, "load" | QueryEvaluationError> =
  liveQueryHandle.refresh();
const liveQueryOptions: Component.LiveQueryOptions = {
  preload: false,
  // @ts-expect-error the query factory is tracked; signal/prop reads in it rebuild the query.
  deps: () => "status",
};

// --- Query namespace types ---

declare const publicQueryRoot: Query.Root;
// @ts-expect-error Query.from was removed; start queries from the factory root with query.from(...).
Query.from;
const publicQueryFactory: Query.Factory<Project, "load", ProjectFeed> = (query) =>
  query.from({ project: ProjectsRef }).select(({ project }) => project);
const publicQueryBuilder: Query.Builder<any, Project, "load", ProjectFeed> = publicQueryRoot
  .from({ project: ProjectsRef })
  .select(({ project }) => project);
const publicQueryRows: ReadonlyArray<Project> = publicQueryBuilder.execute();
// @ts-expect-error public Query.Builder does not expose execution-plan internals.
publicQueryBuilder.sources;
// @ts-expect-error Query.build is internal; use Query.once or Query.live.
Query.build;
const queryEvaluationError = new QueryEvaluationError({
  operation: "evaluate",
  message: "invalid query",
  cause: "invalid query",
});
const queryEvaluationOperation: Query.EvaluationOperation = queryEvaluationError.operation;
const unsupportedLiveQuery = new UnsupportedLiveQuery({ reason: "no sources" });
const publicQueryPlanDiagnostics: Query.PlanDiagnostics = Query.diagnostics(publicQueryFactory);
const publicQueryPlanSource: Query.PlanSourceDiagnostics = publicQueryPlanDiagnostics.sources[0]!;
const publicQueryPlanSourceResource: string = publicQueryPlanSource.resource;
declare const publicQueryPlanJoin: Query.PlanJoinDiagnostics;
const publicQueryJoinStrategy: "scan" | "index" = publicQueryPlanJoin.strategy;
const publicQueryAggregate: Query.Aggregate<{ readonly project: Project }, number, number> =
  Query.sum(({ project }) => project.id.length);

const dbExports: Array<unknown> = [
  liveState,
  livePreload,
  onceRows,
  projectTaskRows,
  liveQueryBinding,
  liveQueryRows,
  liveQueryWaiting,
  liveQueryRefresh,
  liveQueryOptions,
  publicQueryRows,
  queryEvaluationOperation,
  unsupportedLiveQuery,
  publicQueryPlanSourceResource,
  publicQueryJoinStrategy,
  publicQueryAggregate,
];
void dbExports;

// Query's scalar vocabulary types.
const joinKey: Query.JoinKey = "atlas";
const sortValue: Query.SortValue = new Date(0);
const sortDirection: Query.SortDirection = "desc";
const groupKey: Query.GroupKey<{ readonly status: string }> = { status: "active" };
void [joinKey, sortValue, sortDirection, groupKey];
