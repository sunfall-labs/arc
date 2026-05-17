import { Effect } from "effect";
import {
  CollectionRowKeyChanged,
  CollectionRowNotFound
} from "@effect-ui/db";
import {
  Collection,
  Query,
  useCollection,
  useLiveQuery,
  type CollectionHandle,
  type LiveQueryHandle,
  type UseCollectionOptions,
  type UseLiveQueryOptions
} from "@effect-ui/react-db";

interface ReactDbProject {
  readonly id: string;
  readonly name: string;
}

interface ReactDbRuntimeError {
  readonly _tag: "ReactDbRuntimeError";
}

declare const reactDbProjects: CollectionHandle<
  ReactDbProject,
  string,
  "load",
  ReactDbRuntimeError
>;
declare const reactDbPreloadObserverPromise: Promise<void>;

const reactDbExports: Array<unknown> = [Collection, Query, useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Options = UseCollectionOptions<"load", ReactDbRuntimeError> | UseLiveQueryOptions<"query", ReactDbRuntimeError>;
type Namespaces = Collection.Key | Query.Builder<any, any>;
const reactDbCollectionOptions: UseCollectionOptions<"load", ReactDbRuntimeError> = {
  onPreloadFailure: () => Effect.void
};
const reactDbLiveQueryOptions: UseLiveQueryOptions<"query", ReactDbRuntimeError> = {
  deps: ["status"],
  onPreloadFailure: () => Effect.void
};
const reactDbBadCollectionOptions: UseCollectionOptions<"load", ReactDbRuntimeError> = {
  // @ts-expect-error React DB preload observers must return void or Effect, not Promise
  onPreloadFailure: () => reactDbPreloadObserverPromise
};
const reactDbBadLiveQueryOptions: UseLiveQueryOptions<"query", ReactDbRuntimeError> = {
  // @ts-expect-error React DB live-query preload observers must return void or Effect, not Promise
  onPreloadFailure: () => reactDbPreloadObserverPromise
};
const reactDbPendingMutations: ReadonlyArray<Collection.PendingMutation<ReactDbProject, string>> =
  reactDbProjects.pendingMutations;
const reactDbWriteInsert: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | ReactDbRuntimeError
> = reactDbProjects.writeInsertEffect({ id: "atlas", name: "Atlas" });
const reactDbWriteUpdate: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | CollectionRowNotFound | CollectionRowKeyChanged | ReactDbRuntimeError
> = reactDbProjects.writeUpdateEffect("atlas", { name: "Atlas Prime" });
const reactDbWriteDelete: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | ReactDbRuntimeError
> = reactDbProjects.writeDeleteEffect("atlas");
const reactDbFlushPending: Effect.Effect<
  ReadonlyArray<Collection.Transaction<ReactDbProject, string>>,
  Collection.RuntimeError<"load"> | ReactDbRuntimeError
> = reactDbProjects.flushPendingMutationsEffect();
void reactDbExports;
void reactDbPendingMutations;
void reactDbWriteInsert;
void reactDbWriteUpdate;
void reactDbWriteDelete;
void reactDbFlushPending;
void reactDbCollectionOptions;
void reactDbLiveQueryOptions;
void reactDbBadCollectionOptions;
void reactDbBadLiveQueryOptions;
type _Handles = Handles;
type _Options = Options;
type _Namespaces = Namespaces;
