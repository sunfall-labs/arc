import {
  Collection,
  Query,
  useCollection,
  useLiveQuery,
  type CollectionHandle,
  type LiveQueryHandle
} from "@effect-ui/solid-db";

const solidDbExports: Array<unknown> = [Collection, Query, useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
type Namespaces = Collection.Key | Query.Builder<any, any>;
void solidDbExports;
type _Handles = Handles;
type _Namespaces = Namespaces;
