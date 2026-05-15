import {
  useCollection,
  useLiveQuery,
  type CollectionHandle,
  type LiveQueryHandle
} from "@effect-ui/react-db";

const reactDbExports: Array<unknown> = [useCollection, useLiveQuery];
type Handles = CollectionHandle<any, any> | LiveQueryHandle<any, any>;
void reactDbExports;
type _Handles = Handles;
