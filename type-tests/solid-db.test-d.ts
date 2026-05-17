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
} from "@effect-ui/solid-db";

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
declare const solidDbPreloadObserverPromise: Promise<void>;

const solidDbExports: Array<unknown> = [Collection, Query, useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Options = UseCollectionOptions<"load", SolidDbRuntimeError> | UseLiveQueryOptions<"query", SolidDbRuntimeError>;
type Namespaces = Collection.Key | Query.Builder<any, any>;
const solidDbCollectionOptions: UseCollectionOptions<"load", SolidDbRuntimeError> = {
  onPreloadFailure: () => Effect.void
};
const solidDbLiveQueryOptions: UseLiveQueryOptions<"query", SolidDbRuntimeError> = {
  deps: () => "status",
  onPreloadFailure: () => Effect.void
};
const solidDbBadCollectionOptions: UseCollectionOptions<"load", SolidDbRuntimeError> = {
  // @ts-expect-error Solid DB preload observers must return void or Effect, not Promise
  onPreloadFailure: () => solidDbPreloadObserverPromise
};
const solidDbBadLiveQueryOptions: UseLiveQueryOptions<"query", SolidDbRuntimeError> = {
  // @ts-expect-error Solid DB live-query preload observers must return void or Effect, not Promise
  onPreloadFailure: () => solidDbPreloadObserverPromise
};
const solidDbPendingMutations: ReadonlyArray<Collection.PendingMutation<SolidDbProject, string>> =
  solidDbProjects.pendingMutations();
const solidDbWriteInsert: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | SolidDbRuntimeError
> = solidDbProjects.writeInsertEffect({ id: "atlas", name: "Atlas" });
const solidDbWriteUpdate: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | CollectionRowNotFound | CollectionRowKeyChanged | SolidDbRuntimeError
> = solidDbProjects.writeUpdateEffect("atlas", { name: "Atlas Prime" });
const solidDbWriteDelete: Effect.Effect<
  void,
  Collection.RuntimeError<"load"> | SolidDbRuntimeError
> = solidDbProjects.writeDeleteEffect("atlas");
const solidDbFlushPending: Effect.Effect<
  ReadonlyArray<Collection.Transaction<SolidDbProject, string>>,
  Collection.RuntimeError<"load"> | SolidDbRuntimeError
> = solidDbProjects.flushPendingMutationsEffect();
void solidDbExports;
void solidDbPendingMutations;
void solidDbWriteInsert;
void solidDbWriteUpdate;
void solidDbWriteDelete;
void solidDbFlushPending;
void solidDbCollectionOptions;
void solidDbLiveQueryOptions;
void solidDbBadCollectionOptions;
void solidDbBadLiveQueryOptions;
type _Handles = Handles;
type _Options = Options;
type _Namespaces = Namespaces;
