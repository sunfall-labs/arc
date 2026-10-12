import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { ProjectKey, TrackerError } from "../../../model.js";
import { Board, Labels } from "../../../resources.js";
import { projectName } from "../../../page-head.js";
import { preloadShell, routeVerdicts } from "../../../session.js";

/** A project's board: one column per status. An unknown project is a 404. */
export const route = Route.define("/projects/:key", {
  params: Schema.Struct({ key: ProjectKey }),
  error: TrackerError,
  preload: ({ params, href }) =>
    preloadShell(href).pipe(
      Effect.andThen(Resource.preload([Board(params.key), Labels(params.key)])),
      routeVerdicts(href),
    ),
  head: ({ params, read }) => ({ title: `${projectName(read, params.key)} board` }),
});
