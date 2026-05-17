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

const solidDbExports: Array<unknown> = [Collection, Query, useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Namespaces = Collection.Key | Query.Builder<any, any>;
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
type _Handles = Handles;
type _Namespaces = Namespaces;
