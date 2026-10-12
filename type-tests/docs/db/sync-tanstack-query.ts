import { Collection } from "@sunfall/arc-db";
import { Effect } from "effect";
import { ProjectSchema, type Project } from "./model.js";

// The host library's surface, as the recipe uses it. Its Promises enter the
// adapter only through `Effect.tryPromise`.
type HostPromise<A> = Promise<A>;
interface QueryOptions<A> {
  readonly queryKey: ReadonlyArray<string>;
  readonly queryFn: () => HostPromise<A>;
}
declare const queryClient: {
  readonly fetchQuery: <A>(options: QueryOptions<A>) => HostPromise<A>;
  readonly invalidateQueries: (filters: {
    readonly queryKey: ReadonlyArray<string>;
  }) => HostPromise<void>;
};
declare const projectsQuery: QueryOptions<ReadonlyArray<Project>>;

// #region tanstack-query
const Projects = Collection.define({
  name: "Projects",
  output: ProjectSchema,
  getKey: (project) => project.id,
  sync: {
    name: "tanstack-query:projects",
    load: () => Effect.tryPromise(() => queryClient.fetchQuery(projectsQuery)),
    refresh: () =>
      Effect.tryPromise(() => queryClient.invalidateQueries({ queryKey: ["projects"] })).pipe(
        Effect.andThen(Effect.tryPromise(() => queryClient.fetchQuery(projectsQuery))),
      ),
  },
});
// #endregion

export { Projects };
