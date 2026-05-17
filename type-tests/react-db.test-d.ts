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
  type LiveQueryHandle
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

const reactDbExports: Array<unknown> = [Collection, Query, useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Namespaces = Collection.Key | Query.Builder<any, any>;
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
type _Handles = Handles;
type _Namespaces = Namespaces;
