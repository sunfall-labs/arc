import { Effect, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { Collection, QueryEvaluationError } from "@sunfall/arc-db";
import {
  useCollection,
  useLiveQuery,
  type CollectionHandle,
  type LiveQueryHandle,
  type UseCollectionOptions,
  type UseLiveQueryOptions,
} from "@sunfall/arc-solid-db";

interface SolidDbProject {
  readonly id: string;
  readonly name: string;
}

interface SolidDbRuntimeError {
  readonly _tag: "SolidDbRuntimeError";
}

declare const solidDbProjects: CollectionHandle<
  SolidDbProject,
  string,
  "load",
  SolidDbRuntimeError
>;
declare const solidDbLiveProjects: LiveQueryHandle<SolidDbProject, "query", SolidDbRuntimeError>;
declare const solidDbPreloadObserverPromise: Promise<void>;

const solidDbExports: Array<unknown> = [useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Options =
  | UseCollectionOptions<"load", SolidDbRuntimeError>
  | UseLiveQueryOptions<"query", SolidDbRuntimeError>;
const solidDbCollectionOptions: UseCollectionOptions<"load", SolidDbRuntimeError> = {
  onPreloadFailure: () => Effect.void,
};
const solidDbLiveQueryOptions: UseLiveQueryOptions<"query", SolidDbRuntimeError> = {
  onPreloadFailure: () => Effect.void,
};
const solidDbDepsLiveQueryOptions: UseLiveQueryOptions<"query", SolidDbRuntimeError> = {
  // @ts-expect-error the query factory is tracked; signal/prop reads in it rebuild the query.
  deps: () => "status",
};
const solidDbBadCollectionOptions: UseCollectionOptions<"load", SolidDbRuntimeError> = {
  // @ts-expect-error Solid DB preload observers must return void or Effect, not Promise
  onPreloadFailure: () => solidDbPreloadObserverPromise,
};
const solidDbBadLiveQueryOptions: UseLiveQueryOptions<"query", SolidDbRuntimeError> = {
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
const solidDbPreloadFailure: Collection.RuntimeError<"load"> | SolidDbRuntimeError | undefined =
  solidDbProjects.preloadFailure();
const solidDbCollectionResult: () => AsyncResult.AsyncResult<
  void,
  Collection.RuntimeError<"load">
> = solidDbProjects.result;
// @ts-expect-error writes run `collection.updateEffect(...)` through the runtime runner.
solidDbProjects.updateEffect;
// @ts-expect-error loads run `collection.refetchEffect()` through the runtime runner.
solidDbProjects.refetchEffect;
// @ts-expect-error handles expose one `result()` accessor instead of state/waiting/error.
void solidDbProjects.state;

const solidDbLivePreload: Effect.Effect<
  void,
  "query" | QueryEvaluationError | SolidDbRuntimeError
> = solidDbLiveProjects.preloadEffect();
const solidDbLiveRefetch: Effect.Effect<
  void,
  "query" | QueryEvaluationError | SolidDbRuntimeError
> = solidDbLiveProjects.refetchEffect();
const solidDbLiveData: () => ReadonlyArray<SolidDbProject> = solidDbLiveProjects.data;
const solidDbLiveState: () => AsyncResult.AsyncResult<
  ReadonlyArray<SolidDbProject>,
  "query" | QueryEvaluationError
> = solidDbLiveProjects.result;
const solidDbLiveWaiting: boolean = solidDbLiveProjects.result().waiting;
const solidDbLiveError: Option.Option<"query" | QueryEvaluationError> = AsyncResult.error(
  solidDbLiveProjects.result(),
);
const solidDbLivePreloadFailure: () =>
  | "query"
  | QueryEvaluationError
  | SolidDbRuntimeError
  | undefined = solidDbLiveProjects.preloadFailure;
void solidDbExports;
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
