import {
  Collection,
  Query,
  eq,
  flushCollectionsPendingMutationsEffect,
  type CollectionStorageError,
  type QueryEvaluationError
} from "@effect-ui/db";

const dbExports: Array<unknown> = [Collection, Query, eq, flushCollectionsPendingMutationsEffect];
type DbErrors = CollectionStorageError | QueryEvaluationError;
void dbExports;
type _DbErrors = DbErrors;
