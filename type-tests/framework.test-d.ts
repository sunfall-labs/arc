import { Effect, Schema } from "effect";
import { Action, ActionResult, Capability, Form, Resource, Route, Server, Signal, defineApp, makeRuntime, route } from "@effect-ui/core";
import {
  Collection,
  Query,
  createLiveQueryCollection,
  eq,
  flushCollectionsPendingMutationsEffect,
  makeSQLitePersistenceStorage,
  serverCollectionOptions
} from "@effect-ui/db";
import { useCollection, useLiveQuery } from "@effect-ui/solid-db";
import {
  describeDevtoolsPanels,
  makeDevtoolsStore,
  mountDevtoolsPanelsEffect,
  renderDevtoolsPanelsHtml,
  renderDevtoolsPanelsHtmlEffect,
  type DevtoolsInvalidationPlan,
  type DevtoolsPanelMount,
  type DevtoolsPanelUiInput,
  type DevtoolsPanels,
  type DevtoolsRequestTrace,
  type DevtoolsRequestTraceTeardown
} from "@effect-ui/devtools";
import {
  createRequestHandler,
  createRequestHandlerEffect,
  defineFileRoute,
  hydrateFromDocument,
  hydrateFromDocumentEffect,
  hydrateStartHydrationChunksFromDocument,
  hydrateStartHydrationChunksFromDocumentEffect,
  preloadRequestEffect,
  readStartHydrationChunks,
  StartAction,
  type StartActionInvalidationPlan,
  type StartRequestHandler,
  type StartRequestTrace,
  type StartRequestTraceTeardown,
  streamHydrationConsumedAttribute,
  submitStartActionEffect
} from "@effect-ui/start";
import type { StartSsrRequestHandler } from "@effect-ui/start/vite";
import {
  createNodeHandlerEffect,
  nodeRequestToWebRequestEffect,
  toFetchHandlerEffect
} from "@effect-ui/start/adapters";
import {
  toFetchHandlerEffect as toPackagedFetchHandlerEffect,
  type StartFetchHandlerEffect as PackagedStartFetchHandlerEffect
} from "@effect-ui/start-fetch";
import {
  createNodeHandlerEffect as createPackagedNodeHandlerEffect,
  type StartNodeHandlerEffect as PackagedStartNodeHandlerEffect
} from "@effect-ui/start-node";
import {
  makeProjectId as makeProjectConsoleProjectId
} from "../examples/project-console/src/domain.contract.js";
import type {
  FileRouteHrefOptionsById as ProjectConsoleFileRouteHrefOptionsById,
  FileRouteHrefOptionsByPath as ProjectConsoleFileRouteHrefOptionsByPath,
  FileRouteId as ProjectConsoleFileRouteId,
  FileRouteParamsById as ProjectConsoleFileRouteParamsById,
  FileRoutePath as ProjectConsoleFileRoutePath,
  FileRouteSearchByPath as ProjectConsoleFileRouteSearchByPath
} from "../examples/project-console/src/routeTree.gen.js";
import { routeByPath as projectConsoleRouteByPath } from "../examples/project-console/src/routeTree.gen.js";

const ProjectTab = Schema.Literals(["overview", "activity"]);
const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
type ProjectId = typeof ProjectId.Type;
const atlasProjectId = Schema.decodeUnknownSync(ProjectId)("atlas");

const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String
});

interface Project {
  readonly id: string;
  readonly name: string;
}

type ProjectError = {
  readonly _tag: "ProjectError";
  readonly message: string;
};

const ProjectRoute = route("/projects/:id", {
  params: Schema.Struct({ id: Schema.String }),
  search: Schema.Struct({ tab: Schema.optional(ProjectTab) })
});

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  search: { tab: "activity" }
});

// @ts-expect-error missing route param
Route.href(ProjectRoute, { params: {} });

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error invalid search literal
  search: { tab: "settings" }
});

Route.href(ProjectRoute, {
  params: { id: "atlas" },
  // @ts-expect-error unknown search key
  search: { sort: "name" }
});

const BrandedProjectRoute = route("/branded-projects/:id", {
  params: Schema.Struct({ id: ProjectId })
});

Route.href(BrandedProjectRoute, {
  params: { id: atlasProjectId }
});

// @ts-expect-error branded route params reject accidental plain strings
Route.href(BrandedProjectRoute, { params: { id: "atlas" } });

const OptionalProjectRoute = route("/optional-projects/:id?", {});

Route.href(OptionalProjectRoute, { params: {} });
Route.href(OptionalProjectRoute, { params: { id: "atlas" } });

// @ts-expect-error optional route params still reject unknown keys
Route.href(OptionalProjectRoute, { params: { slug: "atlas" } });

const generatedRouteTree = [
  defineFileRoute("/")({}),
  defineFileRoute("/generated-projects/:id")({})
] as const;
const generatedRouteById = {
  route_root: generatedRouteTree[0],
  route_generated_projects_$id: generatedRouteTree[1]
} as const;

Route.href(generatedRouteById.route_generated_projects_$id, {
  params: { id: "atlas" }
});

// @ts-expect-error generated route values use the canonical href param checks
Route.href(generatedRouteById.route_generated_projects_$id, { params: {} });

const projectConsoleRouteId: ProjectConsoleFileRouteId = "route_projects_$id";
const projectConsoleRoutePath: ProjectConsoleFileRoutePath = "/projects/:id";
const projectConsoleRouteParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = {
  id: makeProjectConsoleProjectId("atlas")
};
const projectConsoleRouteSearch: ProjectConsoleFileRouteSearchByPath["/projects/:id"] = {
  tab: "activity"
};
const projectConsoleHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  params: projectConsoleRouteParams,
  search: projectConsoleRouteSearch
};
const projectConsoleHrefOptionsByPath: ProjectConsoleFileRouteHrefOptionsByPath["/projects/:id"] = {
  params: projectConsoleRouteParams,
  search: projectConsoleRouteSearch
};

Route.href(projectConsoleRouteByPath["/projects/:id"], projectConsoleHrefOptionsByPath);

// @ts-expect-error generated routeByPath keeps canonical href param checks
Route.href(projectConsoleRouteByPath["/projects/:id"], { params: {} });

// @ts-expect-error generated route id union rejects unknown ids
const projectConsoleUnknownRouteId: ProjectConsoleFileRouteId = "route_missing";

// @ts-expect-error generated route path union rejects unknown paths
const projectConsoleUnknownRoutePath: ProjectConsoleFileRoutePath = "/missing";

// @ts-expect-error generated params preserve branded project ids
const projectConsolePlainParams: ProjectConsoleFileRouteParamsById["route_projects_$id"] = { id: "atlas" };

const projectConsoleBadHrefOptions: ProjectConsoleFileRouteHrefOptionsById["route_projects_$id"] = {
  // @ts-expect-error generated href options reject missing route params
  params: {},
  search: { tab: "activity" }
};

const projectConsoleBadSearch: ProjectConsoleFileRouteSearchByPath["/projects/:id"] = {
  // @ts-expect-error generated search options preserve schema literals
  tab: "timeline"
};

const GetProject = Server.contract<{ readonly id: string }, Project, ProjectError>("Project.get", {
  input: Schema.Struct({ id: Schema.String }),
  output: ProjectSchema
});

const getProject = Server.client(GetProject);

getProject.effect({ id: "atlas" });

// @ts-expect-error missing server function input field
getProject.effect({});

// @ts-expect-error incorrect server function input field
getProject.effect({ slug: "atlas" });

Server.mock(GetProject, ({ id }) => Effect.succeed({ id, name: "Mock Project" }));

// @ts-expect-error plain mock output must satisfy the contract output type
Server.mock(GetProject, ({ id }) => ({ id }));

// @ts-expect-error mock input comes from the contract
Server.mock(GetProject, (input: { readonly slug: string }) =>
  Effect.succeed({ id: input.slug, name: "Mock Project" })
);

Server.implement(GetProject, ({ id }) => Effect.succeed({ id, name: "Server Project" }));

// @ts-expect-error implementation output must satisfy the contract output type
Server.implement(GetProject, ({ id }) => ({ id }));

// @ts-expect-error server implementations must return Effect or a pure value, not Promise
Server.implement(GetProject, async ({ id }) => ({ id, name: "Server Project" }));

const ProjectTag = Resource.tag<{ readonly id: string }>("Project", {
  key: ({ id }) => id
});
const ProjectsTag = Resource.tag("Projects");

// @ts-expect-error keyed resource tags require key options
Resource.tag<{ readonly id: string }>("Project.missingOptions");

ProjectTag({ id: "atlas" });

// @ts-expect-error resource tag input must match the tag definition
ProjectTag({ slug: "atlas" });

const ProjectById = Resource.family<string, Project, ProjectError | Server.ClientError>({
  name: "Project.byId",
  input: Schema.String,
  output: ProjectSchema,
  load: (id) => getProject.effect({ id }),
  provides: (project) => [ProjectTag({ id: project.id })]
});

Resource.prefetchEffect(ProjectById("atlas"));

Resource.family<string, Project>({
  name: "Project.asyncResource",
  // @ts-expect-error resource loaders must return Effect or a pure value, not Promise
  load: async (id) => ({ id, name: "Async" })
});

const BrandedProjectById = Resource.family<ProjectId, Project, ProjectError>({
  name: "Project.byBrandedId",
  input: ProjectId,
  output: ProjectSchema,
  load: (id) => Effect.succeed({ id, name: "Branded" })
});

Resource.prefetchEffect(BrandedProjectById(atlasProjectId));

// @ts-expect-error branded resource inputs reject accidental plain strings
Resource.prefetchEffect(BrandedProjectById("atlas"));

const ProjectsCollection = Collection.define<Project, string, ProjectError | Server.ClientError, ProjectApi>({
  name: "Projects.collection",
  output: Schema.Array(ProjectSchema),
  getKey: (project) => project.id,
  indexes: {
    byName: {
      key: (project) => project.name,
      unique: true
    }
  },
  load: () => ProjectApi.use((api) => Effect.map(api.get("atlas"), (project) => [project])),
  onUpdate: (updates, context) =>
    ProjectApi.use((api) => {
      context.transaction.mutations.map((mutation) => mutation.key);
      return api.rename({
        id: updates[0]!.key,
        name: updates[0]!.value.name
      }).pipe(Effect.asVoid);
    })
});

Collection.rows(ProjectsCollection).map((project) => {
  project.name;
  project.$synced;
  // @ts-expect-error live collection rows preserve row shape
  project.slug;
});
ProjectsCollection.index("byName", "Atlas").map((project) => project.name.toUpperCase());
Collection.firstByIndex(ProjectsCollection, "byName", "Atlas")?.name.toUpperCase();

const projectsSnapshot = ProjectsCollection.snapshot();
projectsSnapshot.rows.map((row) => {
  row.key.toUpperCase();
  row.value.name.toUpperCase();
  // @ts-expect-error collection snapshots preserve row value shape
  row.value.slug;
});
projectsSnapshot.pendingMutations.map((pending) =>
  pending.transaction.mutations.map((mutation) => mutation.key.toUpperCase())
);

Effect.map(ProjectsCollection.snapshotEffect(), (snapshot) =>
  snapshot.rows.map((row) => row.value.name)
);
Effect.map(ProjectsCollection.pendingMutationsEffect(), (pending) =>
  pending.map((entry) => entry.transaction.id)
);
ProjectsCollection.pendingMutations().map((pending) => pending.attempts.toFixed());
Effect.map(ProjectsCollection.flushPendingMutationsEffect(), (transactions) =>
  transactions.map((transaction) => transaction.mutations.map((mutation) => mutation.key.toUpperCase()))
);
Collection.flushPendingMutationsEffect(ProjectsCollection);
ProjectsCollection.flushPendingMutations().then((transactions) =>
  transactions.map((transaction) => transaction.collection.toUpperCase())
);

const projectMemoryStorage = Collection.memoryStorage();
ProjectsCollection.persistEffect(projectMemoryStorage, { key: "projects" });
ProjectsCollection.restoreEffect(projectMemoryStorage, { key: "projects", replace: false });
Collection.persistEffect(ProjectsCollection, projectMemoryStorage);
Collection.restoreEffect(ProjectsCollection, projectMemoryStorage);

const ListProjectsForCollection = Server.fn<void, readonly Project[], ProjectError>("Projects.collection.list", {
  handler: () => Effect.succeed([{ id: "atlas", name: "Atlas" }])
});

const ServerProjectsCollection = Collection.define(serverCollectionOptions<Project>({
  id: "Projects.serverCollection",
  getKey: (project) => project.id,
  load: ListProjectsForCollection,
  update: (payload) => {
    payload.updates[0]!.key.toUpperCase();
    payload.transaction.mutations.map((mutation) => mutation.key.toUpperCase());
    return Effect.void;
  }
}));

Collection.define(Collection.serverOptions<Project>({
  name: "Projects.serverNamespaceCollection",
  getKey: (project) => project.id,
  load: () => Promise.resolve([{ id: "atlas", name: "Atlas" }])
}));
const syncAdapter: Collection.SyncAdapter<Project> = {
  name: "projects-sync",
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
  update: (payload) => {
    payload.updates.map((update) => update.key.toUpperCase());
    payload.transaction.id.toUpperCase();
  }
};
Collection.define(Collection.syncOptions<Project>({
  name: "Projects.syncCollection",
  getKey: (project) => project.id,
  sync: syncAdapter
}));
Collection.define(Collection.syncOptions<Project>({
  name: "Projects.serverSyncCollection",
  getKey: (project) => project.id,
  sync: Collection.serverSyncAdapter<Project>({
    name: "Projects.serverSyncCollection",
    getKey: (project) => project.id,
    load: () => Promise.resolve([{ id: "atlas", name: "Atlas" }])
  })
}));
const ProjectRowsResource = Resource.family<void, ReadonlyArray<Project>, ProjectError>({
  name: "Project.rows",
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }])
});
Collection.define(Collection.syncOptions<Project>({
  name: "Projects.resourceSyncCollection",
  getKey: (project) => project.id,
  sync: Collection.resourceSyncAdapter({
    ref: ProjectRowsResource(undefined),
    update: (payload) => {
      payload.updates.map((update) => update.value.name.toUpperCase());
    }
  })
}));
const querySyncClient: Collection.QuerySyncClient<Project> = {
  fetchQuery: ({ queryKey, queryFn }) => {
    queryKey.map((part) => String(part));
    return queryFn();
  },
  invalidateQueries: ({ queryKey }) => {
    queryKey.map((part) => String(part));
  }
};
Collection.define(Collection.syncOptions<Project>({
  name: "Projects.querySyncCollection",
  getKey: (project) => project.id,
  sync: Collection.querySyncAdapter({
    queryKey: ["projects"],
    queryFn: () => [{ id: "atlas", name: "Atlas" }],
    queryClient: querySyncClient,
    invalidateOnMutation: false,
    update: (payload) => {
      payload.updates.map((update) => update.value.name.toUpperCase());
    }
  })
}));

Collection.define(serverCollectionOptions<Project>({
  name: "Projects.badServerCollection",
  getKey: (project) => project.id,
  // @ts-expect-error server collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
}));

Effect.map(Collection.flushAllPendingMutationsEffect([ProjectsCollection, ServerProjectsCollection]), (results) =>
  results.map((result) => result.transactions.map((transaction) => transaction.collection))
);
const backgroundSyncAdapter: Collection.BackgroundSyncAdapter = {
  name: "online",
  shouldFlush: (context) => {
    context.trigger.toUpperCase();
    context.collections.map((collection) => collection.toUpperCase());
    context.pending.map((pending) =>
      pending.transactions.map((transaction) => transaction.collection)
    );
    return true;
  }
};
Effect.map(Collection.backgroundSyncPendingMutationsEffect([ProjectsCollection], {
  trigger: "online",
  adapter: backgroundSyncAdapter
}), (result) => {
  result.trigger.toUpperCase();
  result.pending.map((pending) => pending.collection.toUpperCase());
  return result.results.map((flushResult) => flushResult._tag);
});
const collectionChanges: ReadonlyArray<Collection.Change<Project, string>> = [
  { _tag: "Upsert", value: { id: "atlas", name: "Atlas" } },
  { _tag: "Delete", key: "lumen" }
];
Collection.applyChangesEffect(ProjectsCollection, collectionChanges, {
  origin: "remote",
  synced: true
});
const changeFeedAdapter: Collection.ChangeFeedAdapter<Project> = {
  name: "projects-feed",
  subscribe: (context) => {
    context.collection.toUpperCase();
    context.emit([{ _tag: "Upsert", value: { id: "atlas", name: "Atlas" } }]);
    return {
      unsubscribe: () => undefined
    };
  }
};
Collection.subscribeChangesEffect(ProjectsCollection, changeFeedAdapter);
Effect.map(flushCollectionsPendingMutationsEffect([ProjectsCollection], {
  skip: ({ collection }) => collection.name === "Projects.collection"
}), (results) => results.map((result) => result._tag));

const sqliteStorage = Collection.sqliteStorage({
  table: () => ({
    get: (key) => {
      key.namespace.toUpperCase();
      return null;
    },
    upsert: (row) => {
      row.schemaVersion.toFixed();
      row.updatedAt.toFixed();
    },
    delete: (key) => {
      key.key.toUpperCase();
    }
  })
}, { namespace: "workspace:a", schemaVersion: 1 });
const sqliteStorageTopLevel = makeSQLitePersistenceStorage({
  table: () => ({
    get: () => null,
    upsert: () => undefined
  })
});
const sqliteStatementStorage = Collection.sqliteStorage(Collection.sqliteStatementDriver({
  execute: (_sql, params) => {
    params?.map((param) => param?.valueOf());
  },
  select: (_sql, params) => {
    params?.map((param) => param?.valueOf());
    return [];
  }
}));
const sqlitePreparedStatementDatabase = Collection.sqlitePreparedStatementDatabase({
  prepare: (sql) => {
    sql.toUpperCase();
    return {
      run: (...params) => {
        params.map((param) => param?.valueOf());
      },
      all: (...params) => {
        params.map((param) => param?.valueOf());
        return [];
      }
    };
  }
});
const sqlitePreparedStatementStorage = Collection.sqliteStorage(
  Collection.sqliteStatementDriver(sqlitePreparedStatementDatabase)
);
const sqliteMemoryStatementDatabase = Collection.sqliteMemoryStatementDatabase();
const sqliteMemoryStatementStorage = Collection.sqliteStorage(Collection.sqliteStatementDriver(sqliteMemoryStatementDatabase));
sqliteMemoryStatementDatabase.tableRows("collection_snapshots").map((row) => row.schemaVersion.toFixed());
ProjectsCollection.persistEffect(sqliteStorage);
ProjectsCollection.restoreEffect(sqliteStorageTopLevel);
ProjectsCollection.restoreEffect(sqliteStatementStorage);
ProjectsCollection.restoreEffect(sqlitePreparedStatementStorage);
ProjectsCollection.restoreEffect(sqliteMemoryStatementStorage);

const PersistedProjectsCollection = Collection.define(Collection.persistedOptions<Project>({
  name: "Projects.persistedCollection",
  getKey: (project) => project.id,
  load: () => Effect.succeed([{ id: "atlas", name: "Atlas" }]),
  persistence: {
    storage: sqliteStorage,
    key: "projects",
    loadAfterRestore: true
  }
}));
PersistedProjectsCollection.preloadEffect();
PersistedProjectsCollection.writeInsertEffect({ id: "atlas", name: "Atlas" });

Collection.define(Collection.persistedOptions<Project>({
  name: "Projects.badPersistedCollection",
  getKey: (project) => project.id,
  persistence: {
    storage: sqliteStorage
  },
  // @ts-expect-error persisted collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
}));

const collectionPayload = Collection.dehydrate([ProjectsCollection]);
Collection.hydratePayloadEffect([ProjectsCollection], collectionPayload);
Effect.map(Collection.collectEffect(ProjectsCollection.preloadEffect()), (collected) => {
  collected.value;
  collected.definitions.map((definition) => definition.name);
});

const StartApp = defineApp({
  routes: [ProjectRoute] as const,
  client: {}
});
const requestTraceHandler = (trace: StartRequestTrace) => {
  const devtoolsTrace: DevtoolsRequestTrace = trace;
  const teardownStartedAt: number | undefined = trace.teardown?.startedAt;
  const teardownCompletedAt: number | undefined = trace.teardown?.completedAt;
  const teardownDurationMillis: number | undefined = trace.teardown?.durationMillis;
  const beforeDisposeFiberCount: number | undefined = trace.teardown?.beforeDispose?.fiberCount;
  const afterDisposeModuleCount: number | undefined = trace.teardown?.afterDispose?.moduleCount;
  void teardownStartedAt;
  void teardownCompletedAt;
  void teardownDurationMillis;
  void beforeDisposeFiberCount;
  void afterDisposeModuleCount;
  void devtoolsTrace;
  return Effect.void.pipe(Effect.asVoid);
};
const startRequestTraceTeardown: StartRequestTraceTeardown = {
  runtimeDisposed: true,
  reason: "response-end",
  startedAt: 10,
  completedAt: 17,
  durationMillis: 7,
  beforeDispose: {
    fiberCount: 2,
    familyCount: 1,
    moduleCount: 1,
    tagCount: 1
  },
  afterDispose: {
    fiberCount: 0,
    familyCount: 1,
    moduleCount: 0,
    tagCount: 1
  }
};
const devtoolsRequestTraceTeardown: DevtoolsRequestTraceTeardown = startRequestTraceTeardown;
void devtoolsRequestTraceTeardown;
createRequestHandler(StartApp, {
  collections: [ProjectsCollection],
  onRequestTrace: requestTraceHandler,
  render: ({ collections, collectionPreload, hydration }) => {
    collections.collections.map((snapshot) => snapshot.name);
    collectionPreload.routeTouchedCollections.map((collection) => collection.name);
    collectionPreload.routeDeclaredCollections.map((collection) => collection.name);
    collectionPreload.registeredCollections.map((collection) => collection.name);
    collectionPreload.dehydratedCollections.map((collection) => collection.name);
    collectionPreload.hydration.collections.map((snapshot) => snapshot.rows.length);
    hydration.collections?.map((snapshot) => snapshot.rows.length);
    return "";
  }
});
createRequestHandler(StartApp, {
  // @ts-expect-error Start render callbacks must return Effect or a pure value, not Promise
  render: async () => ""
});
createRequestHandler(StartApp, {
  // @ts-expect-error request trace handlers must return Effect or a pure value, not Promise
  onRequestTrace: async () => {}
});
const startRequestHandler: StartRequestHandler = () => Promise.resolve(new Response("ok"));
// @ts-expect-error root Start request handlers are Promise host boundaries
const syncStartRequestHandler: StartRequestHandler = () => new Response("ok");
const viteStartSsrRequestHandler: StartSsrRequestHandler = () => new Response("ok");
void startRequestHandler;
void syncStartRequestHandler;
void viteStartSsrRequestHandler;
preloadRequestEffect(StartApp, new Request("https://example.com/projects/atlas"), {
  collections: [ProjectsCollection]
});
toFetchHandlerEffect(createRequestHandlerEffect(StartApp));
createNodeHandlerEffect(createRequestHandlerEffect(StartApp));
nodeRequestToWebRequestEffect({ method: "GET", url: "/", headers: {} } as import("node:http").IncomingMessage);
const packagedFetchHandlerEffect: PackagedStartFetchHandlerEffect = toPackagedFetchHandlerEffect(
  createRequestHandlerEffect(StartApp)
);
packagedFetchHandlerEffect(new Request("https://example.com/projects/atlas")).pipe(
  Effect.map((response) => response.status)
);
const packagedNodeHandlerEffect: PackagedStartNodeHandlerEffect = createPackagedNodeHandlerEffect(
  createRequestHandlerEffect(StartApp)
);
packagedNodeHandlerEffect(
  { method: "GET", url: "/", headers: {} } as import("node:http").IncomingMessage,
  {} as import("node:http").ServerResponse
).pipe(Effect.map((response) => response.status));
Effect.map(preloadRequestEffect(StartApp, new Request("https://example.com/projects/atlas")), (result) =>
  result.collectionPreload.routeDeclaredCollections.map((collection) => collection.name)
);
const hydrationDocument: Pick<Document, "getElementById"> = {
  getElementById: () => null
};
hydrateFromDocument(hydrationDocument, undefined, {
  collections: [ProjectsCollection]
});
const hydrationRuntime = makeRuntime();
hydrateFromDocument(hydrationDocument, undefined, {
  collections: [ProjectsCollection],
  runtime: hydrationRuntime
});
hydrationRuntime.runSync(hydrateFromDocumentEffect(hydrationDocument, undefined, {
  collections: [ProjectsCollection]
}));
const streamHydrationDocument = {
  querySelectorAll: () => [
    {
      textContent: "{\"resources\":[]}",
      getAttribute: (name: string) =>
        name === streamHydrationConsumedAttribute ? null : "0",
      setAttribute: (_name: string, _value: string) => {}
    }
  ]
};
readStartHydrationChunks(streamHydrationDocument, { includeConsumed: true });
hydrateStartHydrationChunksFromDocument(streamHydrationDocument, {
  collections: [ProjectsCollection],
  runtime: hydrationRuntime
});
hydrationRuntime.runSync(
  hydrateStartHydrationChunksFromDocumentEffect(streamHydrationDocument, {
    collections: [ProjectsCollection],
    markConsumed: false
  })
);

ProjectsCollection.updateEffect("atlas", { name: "Atlas Revenue" });

// @ts-expect-error collection key type is preserved
ProjectsCollection.updateEffect(123, { name: "Atlas Revenue" });

Collection.define<Project>({
  name: "Projects.badCollection",
  getKey: (project) => project.id,
  // @ts-expect-error collection loader output must satisfy the row type
  load: () => Effect.succeed([{ id: "atlas" }])
});

Collection.define<Project>({
  name: "Projects.asyncCollection",
  getKey: (project) => project.id,
  // @ts-expect-error collection loaders must return Effect or a pure value, not Promise
  load: async () => [{ id: "atlas", name: "Atlas" }]
});

const ProjectNames = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .where(({ project }) => eq(project.id, "atlas"))
    .select(({ project }) => project.name)
);

ProjectNames.data.get().map((name) => name.toUpperCase());

// @ts-expect-error live query select result is string
ProjectNames.data.get().map((name) => name.toFixed());

const ProjectNameCards = Collection.liveQuery<{ readonly id: string; readonly name: string }, string>({
  name: "ProjectNameCards.collection",
  getKey: (project) => project.id,
  query: (query) =>
    query
      .from({ project: ProjectsCollection })
      .select(({ project }) => ({
        id: project.id,
        name: project.name
      }))
});

ProjectNameCards.rows().map((project) => {
  project.name.toUpperCase();
  project.$synced.valueOf();
});
Effect.map(ProjectNameCards.updateEffect("atlas", { name: "Atlas Prime" }), () => undefined);

const TopLevelProjectNameCards = createLiveQueryCollection({
  name: "ProjectNameCards.topLevel",
  getKey: (project: { readonly id: string; readonly name: string }) => project.id,
  query: (query) =>
    query
      .from({ project: ProjectsCollection })
      .select(({ project }) => ({
        id: project.id,
        name: project.name
      }))
});

TopLevelProjectNameCards.rows().map((project) => project.name.toUpperCase());

interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
}

const TasksCollection = Collection.define<Task>({
  name: "Tasks.collection",
  getKey: (task) => task.id,
  indexes: {
    byProject: (task) => task.projectId
  }
});

const ProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.projectId)
    .select(({ project, task }) => `${project.name}:${task.title}`)
);

ProjectTaskTitles.data.get().map((title) => title.toUpperCase());

const IndexedProjectTaskTitles = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .joinIndexed("task", TasksCollection, ({ project }) => project.id, "byProject")
    .select(({ project, task }) => `${project.name}:${task.title}`)
);

IndexedProjectTaskTitles.data.get().map((title) => title.toUpperCase());

const ProjectTaskRows = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.projectId)
);

ProjectTaskRows.data.get().map(({ project, task }) => `${project.name}:${task.title}`);

Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    // @ts-expect-error joined row fields are type checked
    .join("task", TasksCollection, ({ project }) => project.id, (task) => task.missing)
);

const ProjectCounts = Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .groupBy(
      ({ project }) => ({ name: project.name }),
      {
        count: Query.count(),
        nameLength: Query.sum(({ project }) => project.name.length)
      }
    )
    .where((group) => group.count > 0)
    .select((group) => ({
      name: group.name,
      count: group.count,
      nameLength: group.nameLength
    }))
);

ProjectCounts.data.get().map((group) => group.count.toFixed());

Query.live((query) =>
  query
    .from({ project: ProjectsCollection })
    .groupBy(
      ({ project }) => ({ name: project.name }),
      {
        // @ts-expect-error aggregate selectors are type checked
        total: Query.sum(({ project }) => project.missing)
      }
    )
);

const projectsHandle = useCollection(ProjectsCollection);
projectsHandle.rows().map((project) => project.name);
projectsHandle.get("atlas")?.name.toUpperCase();
projectsHandle.index("byName", "Atlas").map((project) => project.name.toUpperCase());
projectsHandle.firstByIndex("byName", "Atlas")?.name.toUpperCase();

const projectNamesHandle = useLiveQuery((query) =>
  query
    .from({ project: ProjectsCollection })
    .select(({ project }) => project.name)
);
projectNamesHandle.data().map((name) => name.toUpperCase());

const ProjectRoutePlan = Route.planNavigationEffect([ProjectRoute] as const, "/projects/atlas");
Effect.map(ProjectRoutePlan, (plan) => {
  if (plan._tag === "Matched") {
    plan.match.params.id;
    plan.refs.map((ref) => ref.key);
    plan.resources.resources.map((snapshot) => snapshot.name);
  }
});

interface ProjectApi {
  readonly get: (id: string) => Effect.Effect<Project, ProjectError | Server.ClientError>;
  readonly rename: (input: { readonly id: string; readonly name: string }) => Effect.Effect<Project, ProjectError | Server.ClientError>;
}

const ProjectApi = Capability.define<ProjectApi>("ProjectApi");

ProjectApi.layer({
  get: (id) => getProject.effect({ id }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name })
});

ProjectApi.mock({
  get: (id) => Effect.succeed({ id, name: "Mock Project" }),
  rename: (input) => Effect.succeed({ id: input.id, name: input.name })
});

// @ts-expect-error capability implementation must include all service methods
ProjectApi.layer({
  get: (id) => Effect.succeed({ id, name: "Incomplete" })
});

ProjectApi.use((api) => api.get("atlas"));
ProjectApi.useEffect((api) => api.get("atlas"));
ProjectApi.useEffect(() => ({ id: "atlas", name: "Pure Project" }));

// @ts-expect-error service method input remains typed
ProjectApi.use((api) => api.rename({ id: "atlas" }));

// @ts-expect-error capability callbacks must return Effect or a pure value, not Promise
ProjectApi.useEffect(async (api) => ({ id: "atlas", name: "Async Project" }));

Resource.family<string, Project>({
  name: "Project.bad",
  // @ts-expect-error resource loader output must satisfy the resource value type
  load: (id) => ({ id })
});

route("/async-preload", {
  // @ts-expect-error route preload must return Effect or a pure value, not Promise
  preload: async () => undefined
});

defineFileRoute("/async-file-preload")({
  // @ts-expect-error file route preload must return Effect or a pure value, not Promise
  preload: async () => undefined
});

const TouchProject = Action.define<{ readonly id: string }, Project>({
  name: "Project.touch",
  optimistic: ({ id }, transaction) =>
    Effect.gen(function* () {
      const label = Signal.make("idle");
      yield* transaction.signal(label, id);
      return Effect.void;
    }),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" }),
  invalidates: (project) => [ProjectsTag, ProjectTag({ id: project.id })]
});

Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" });
const touch = Action.use(TouchProject);
touch.invalidationPlan.get()?.entries.map((entry) => entry.ref.key);

const TouchProjectWithResultInvalidation = Action.define<{ readonly id: string }, ActionResult<Project>>({
  name: "Project.touchResult",
  run: ({ id }) =>
    Effect.succeed(
      ActionResult.success(
        { id, name: "Touched" },
        { invalidates: [ProjectsTag, ProjectTag({ id })] }
      )
    )
});

Action.planInvalidation(
  TouchProjectWithResultInvalidation,
  ActionResult.success(
    { id: "atlas", name: "Atlas" },
    { invalidates: [ProjectTag({ id: "atlas" })] }
  ),
  { id: "atlas" }
);

submitStartActionEffect(TouchProject, { id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
    result.hydration?.resources.map((resource) => resource.key.toUpperCase());
    result.invalidation?.entries.map((entry) => entry.ref.family.toUpperCase());
  })
);

submitStartActionEffect(TouchProjectWithResultInvalidation, { id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
  })
);

const touchStart = StartAction.use(TouchProject);
touchStart.state.get()._tag;
touchStart.invalidation.get()?.entries.map((entry) => entry.ref.key.toUpperCase());
touchStart.hydration.get()?.resources.map((resource) => resource.key.toUpperCase());
touchStart.submitEffect({ id: "atlas" }).pipe(
  Effect.map((result) => {
    if (result._tag === "Success") {
      result.value.name.toUpperCase();
    }
  })
);

const devtoolsStore = makeDevtoolsStore();
const devtoolsPanels: DevtoolsPanels = devtoolsStore.getPanels();
const devtoolsPanelUiInput: DevtoolsPanelUiInput = {
  panels: devtoolsPanels,
  selectedPanelId: "requests",
  maxItemsPerPanel: 4
};
devtoolsPanels.panels.map((panel) => {
  panel.id;
  panel.severity;
  panel.metrics.map((metric) => metric.label);
  panel.items.map((item) => item.severity);
});
describeDevtoolsPanels({ summary: devtoolsStore.getSummary() }).panels.map((panel) => panel.title);
renderDevtoolsPanelsHtml(devtoolsPanelUiInput).toUpperCase();
renderDevtoolsPanelsHtmlEffect(devtoolsPanelUiInput).pipe(
  Effect.map((html) => html.toUpperCase())
);
devtoolsStore.getPanelsEffect().pipe(
  Effect.map((panels) => panels.panels.map((panel) => panel.id))
);
declare const devtoolsPanelRoot: HTMLElement;
mountDevtoolsPanelsEffect({ root: devtoolsPanelRoot, panels: devtoolsPanels }).pipe(
  Effect.map((mount: DevtoolsPanelMount) => {
    mount.update({ selectedPanelId: "diagnostics" });
    mount.unmount();
  })
);
const serializedInvalidationPlan: DevtoolsInvalidationPlan = {
  targets: [
    {
      _tag: "Tag",
      key: "Project:atlas",
      name: "Project"
    }
  ],
  entries: [
    {
      ref: {
        key: "Project.byId:atlas",
        family: "Project.byId",
        input: "atlas"
      },
      causes: [
        {
          _tag: "Tag",
          key: "Project:atlas",
          name: "Project"
        }
      ]
    }
  ]
};
const startInvalidationPlan: StartActionInvalidationPlan = serializedInvalidationPlan;
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan: startInvalidationPlan
});
devtoolsStore.recordActionState("Project.touch", "Success", {
  serializedInvalidationPlan: touchStart.invalidation.get()
});
devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" })
});
devtoolsStore.recordSerializedInvalidation(serializedInvalidationPlan);
devtoolsStore.recordSerializedInvalidationEffect(startInvalidationPlan);
devtoolsStore.recordActionStateEffect("Project.touch", "Success", {
  serializedInvalidationPlan
});
devtoolsStore.recordStartAction(touchStart);
devtoolsStore.recordStartActionEffect(touchStart);
devtoolsStore.trackStartActionEffect(touchStart);

devtoolsStore.recordActionState("Project.touch", "Success", {
  invalidationPlan: Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { id: "atlas" }),
  // @ts-expect-error devtools action state accepts either live or serialized invalidation plans, not both
  serializedInvalidationPlan
});

// @ts-expect-error invalidation planning value must match the action output type
Action.planInvalidation(TouchProject, { id: "atlas" }, { id: "atlas" });

// @ts-expect-error invalidation planning input must match the action input type
Action.planInvalidation(TouchProject, { id: "atlas", name: "Atlas" }, { slug: "atlas" });

Action.define<{ readonly id: string }, Project>({
  name: "Project.badAction",
  // @ts-expect-error action output must satisfy the action success type
  run: ({ id }) => ({ id })
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.asyncAction",
  // @ts-expect-error actions must return Effect or a pure value, not Promise
  run: async ({ id }) => ({ id, name: "Touched" })
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticInput",
  // @ts-expect-error optimistic input comes from the action input type
  optimistic: (input: { readonly slug: string }) => Effect.succeed(Effect.void),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" })
});

Action.define<{ readonly id: string }, Project>({
  name: "Project.badOptimisticRollback",
  // @ts-expect-error optimistic must return a rollback Effect
  optimistic: ({ id }) => Effect.succeed(id),
  run: ({ id }) => Effect.succeed({ id, name: "Touched" })
});

const ProjectFormSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  spend: Schema.Number
});

const projectForm = Form.make({
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 }
});

Form.make({
  schema: ProjectFormSchema,
  // @ts-expect-error initial values must satisfy the schema type
  initial: { id: "atlas", name: "Atlas Billing", spend: "1200" }
});

Form.make({
  schema: ProjectFormSchema,
  initial: { id: "atlas", name: "Atlas Billing", spend: 1200 },
  // @ts-expect-error form validation must return Effect or a pure value, not Promise
  validate: async () => undefined
});

projectForm.setField("name", "Atlas Revenue");
projectForm.setField("spend", 1400);

// @ts-expect-error form fields must exist on the schema type
projectForm.setField("missing", "value");

// @ts-expect-error form field values must match the schema type
projectForm.setField("spend", "1400");
