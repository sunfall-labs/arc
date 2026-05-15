import {
  useCollection,
  useLiveQuery,
  type CollectionHandle,
  type LiveQueryHandle
} from "@effect-ui/solid-db";

const solidDbExports: Array<unknown> = [useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
void solidDbExports;
type _Handles = Handles;
