import { Effect, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Context } from "effect";
import { Collection, type QueryEvaluationError } from "@sunfall/arc-db";
import {
  SolidDb,
  type CollectionBindingOptions,
  type CollectionHandle,
  type LiveQueryBindingOptions,
  type LiveQueryHandle,
} from "@sunfall/arc-solid-db";

interface SolidDbProject {
  readonly id: string;
  readonly name: string;
}

declare const solidDbProjects: CollectionHandle<SolidDbProject, string, "load">;
declare const solidDbLiveProjects: LiveQueryHandle<SolidDbProject, "query">;
declare const solidDbPreloadObserverPromise: Promise<void>;

// Bindings: a collection's services join the binding's (and so the Component's) R.
interface ProjectFeed {
  readonly list: () => Effect.Effect<ReadonlyArray<SolidDbProject>, "load">;
}
const ProjectFeed = Context.Service<ProjectFeed>("type-tests/solid-db/ProjectFeed");
declare const ServicefulProjects: Collection.Definition<
  SolidDbProject,
  string,
  "load",
  ProjectFeed
>;
const solidDbCollectionBinding: Effect.Effect<
  CollectionHandle<SolidDbProject, string, "load">,
  never,
  ProjectFeed
> = SolidDb.collection(ServicefulProjects);
declare const ServiceFreeProjects: Collection.Definition<SolidDbProject, string>;
const solidDbLiveQueryBinding: Effect.Effect<LiveQueryHandle<string, unknown>> = SolidDb.liveQuery(
  (query) => query.from({ project: ServiceFreeProjects }).select(({ project }) => project.name),
);

const solidDbExports: Array<unknown> = [SolidDb.collection, SolidDb.liveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Options = CollectionBindingOptions<"load"> | LiveQueryBindingOptions<"query">;
const solidDbCollectionOptions: CollectionBindingOptions<"load"> = {
  onPreloadFailure: () => Effect.void,
};
const solidDbLiveQueryOptions: LiveQueryBindingOptions<"query"> = {
  onPreloadFailure: () => Effect.void,
};
const solidDbDepsLiveQueryOptions: LiveQueryBindingOptions<"query"> = {
  // @ts-expect-error the query factory is tracked; signal/prop reads in it rebuild the query.
  deps: () => "status",
};
const solidDbBadCollectionOptions: CollectionBindingOptions<"load"> = {
  // @ts-expect-error Solid DB preload observers must return void or Effect, not Promise
  onPreloadFailure: () => solidDbPreloadObserverPromise,
};
const solidDbBadLiveQueryOptions: LiveQueryBindingOptions<"query"> = {
  // @ts-expect-error Solid DB live-query preload observers must return void or Effect, not Promise
  onPreloadFailure: () => solidDbPreloadObserverPromise,
};

// The collection handle is reactive reads only.
const solidDbRows: ReadonlyArray<Collection.Row<SolidDbProject, string>> = solidDbProjects.rows();
const solidDbRow: Collection.Row<SolidDbProject, string> | undefined = solidDbProjects.get("atlas");
const solidDbIndex: ReadonlyArray<Collection.Row<SolidDbProject, string>> = solidDbProjects.index(
  "byName",
  "Atlas",
);
const solidDbPendingMutations: ReadonlyArray<Collection.PendingMutation<SolidDbProject, string>> =
  solidDbProjects.pendingMutations();
const solidDbPreloadFailure: Collection.RuntimeError<"load"> | undefined =
  solidDbProjects.preloadFailure();
const solidDbCollectionResult: () => AsyncResult.AsyncResult<
  void,
  Collection.RuntimeError<"load">
> = solidDbProjects.result;
// @ts-expect-error writes run `collection.updateEffect(...)` through `Component.callback`.
solidDbProjects.updateEffect;
// @ts-expect-error loads run `collection.refetchEffect()` through `Component.callback`.
solidDbProjects.refetchEffect;
// @ts-expect-error handles expose one `result()` accessor instead of state/waiting/error.
void solidDbProjects.state;

const solidDbLivePreload: Effect.Effect<void, "query" | QueryEvaluationError> =
  solidDbLiveProjects.preloadEffect();
const solidDbLiveRefetch: Effect.Effect<void, "query" | QueryEvaluationError> =
  solidDbLiveProjects.refetchEffect();
const solidDbLiveData: () => ReadonlyArray<SolidDbProject> = solidDbLiveProjects.data;
const solidDbLiveState: () => AsyncResult.AsyncResult<
  ReadonlyArray<SolidDbProject>,
  "query" | QueryEvaluationError
> = solidDbLiveProjects.result;
const solidDbLiveWaiting: boolean = solidDbLiveProjects.result().waiting;
const solidDbLiveError: Option.Option<"query" | QueryEvaluationError> = AsyncResult.error(
  solidDbLiveProjects.result(),
);
const solidDbLivePreloadFailure: () => "query" | QueryEvaluationError | undefined =
  solidDbLiveProjects.preloadFailure;
void solidDbExports;
void solidDbCollectionBinding;
void solidDbLiveQueryBinding;
void solidDbRows;
void solidDbRow;
void solidDbIndex;
void solidDbPendingMutations;
void solidDbPreloadFailure;
void solidDbCollectionResult;
void solidDbLivePreload;
void solidDbLiveRefetch;
void solidDbLiveData;
void solidDbLiveState;
void solidDbLiveWaiting;
void solidDbLiveError;
void solidDbLivePreloadFailure;
void solidDbCollectionOptions;
void solidDbLiveQueryOptions;
void solidDbDepsLiveQueryOptions;
void solidDbBadCollectionOptions;
void solidDbBadLiveQueryOptions;
type _Handles = Handles;
type _Options = Options;
