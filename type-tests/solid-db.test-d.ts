import { Cause, Effect } from "effect";
import { Context } from "effect";
import {
  Collection,
  type CollectionSnapshotCodecError,
  type QueryEvaluationError,
} from "@sunfall/arc-db";
import type { EffectInputCallbackError } from "@sunfall/arc-core";
import { SolidDb } from "@sunfall/arc-solid-db";

interface SolidDbProject {
  readonly id: string;
  readonly name: string;
}

declare const solidDbProjects: SolidDb.CollectionHandle<SolidDbProject, string, "load">;
declare const solidDbLiveProjects: SolidDb.LiveQueryHandle<SolidDbProject, "query">;

// Bindings: a collection's declared load error joins the binding's (and so the
// Component's) E, like a Resource reader's; its services join R.
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
  SolidDb.CollectionHandle<SolidDbProject, string, "load">,
  "load",
  ProjectFeed
> = SolidDb.collection(ServicefulProjects);
// Contract violations (callback throws, rows the schema rejects) are defects, not E.
declare const ContractErrorProjects: Collection.Definition<
  SolidDbProject,
  string,
  "load" | EffectInputCallbackError | CollectionSnapshotCodecError
>;
const solidDbContractBinding: Effect.Effect<unknown, "load"> =
  SolidDb.collection(ContractErrorProjects);
declare const ServiceFreeProjects: Collection.Definition<SolidDbProject, string>;
// Sources that cannot fail add nothing to E (their codec failures are defects).
const solidDbLiveQueryBinding: Effect.Effect<unknown> = SolidDb.liveQuery((query) =>
  query.from({ project: ServiceFreeProjects }).select(({ project }) => project.name),
);

const solidDbExports: Array<unknown> = [SolidDb.collection, SolidDb.liveQuery];
type Handles = SolidDb.CollectionHandle<any, any> | SolidDb.LiveQueryHandle<any, any>;
type Options = SolidDb.CollectionBindingOptions | SolidDb.LiveQueryBindingOptions;
const solidDbCollectionOptions: SolidDb.CollectionBindingOptions = { preload: false };
const solidDbDepsLiveQueryOptions: SolidDb.LiveQueryBindingOptions = {
  // @ts-expect-error the query factory is tracked; signal/prop reads in it rebuild the query.
  deps: () => "status",
};
const solidDbObserverOptions: SolidDb.CollectionBindingOptions = {
  // @ts-expect-error failures surface through `failure()` and `<Errored>`, not an observer.
  onPreloadFailure: () => Effect.void,
};

// The collection handle is reactive reads plus the shared status vocabulary.
const solidDbRows: ReadonlyArray<Collection.Row<SolidDbProject, string>> = solidDbProjects.rows();
const solidDbRow: Collection.Row<SolidDbProject, string> | undefined = solidDbProjects.get("atlas");
const solidDbIndex: ReadonlyArray<Collection.Row<SolidDbProject, string>> = solidDbProjects.index(
  "byName",
  "Atlas",
);
const solidDbWaiting: boolean = solidDbProjects.waiting();
const solidDbFailure: Cause.Cause<"load"> | undefined = solidDbProjects.failure();
// @ts-expect-error Actions change rows: a collection handle has no writes.
solidDbProjects.update;
// @ts-expect-error status is `waiting()` / `failure()`, one vocabulary across handles.
void solidDbProjects.result;
// @ts-expect-error the failed first load throws to `<Errored>`; there is no separate accessor.
void solidDbProjects.preloadFailure;

const solidDbLivePreload: Effect.Effect<void, "query" | QueryEvaluationError> =
  solidDbLiveProjects.preload();
const solidDbLiveRefetch: Effect.Effect<void, "query" | QueryEvaluationError> =
  solidDbLiveProjects.refresh();
const solidDbLiveData: () => ReadonlyArray<SolidDbProject> = solidDbLiveProjects.rows;
const solidDbLiveWaiting: boolean = solidDbLiveProjects.waiting();
const solidDbLiveFailure: Cause.Cause<"query"> | undefined = solidDbLiveProjects.failure();
// @ts-expect-error status is `waiting()` / `failure()`, one vocabulary across handles.
void solidDbLiveProjects.result;
void solidDbExports;
void solidDbCollectionBinding;
void solidDbContractBinding;
void solidDbLiveQueryBinding;
void solidDbRows;
void solidDbRow;
void solidDbIndex;
void solidDbWaiting;
void solidDbFailure;
void solidDbLivePreload;
void solidDbLiveRefetch;
void solidDbLiveData;
void solidDbLiveWaiting;
void solidDbLiveFailure;
void solidDbCollectionOptions;
void solidDbDepsLiveQueryOptions;
void solidDbObserverOptions;
type _Handles = Handles;
type _Options = Options;
