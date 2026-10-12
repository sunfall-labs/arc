import { Resource, Route } from "@sunfall/arc-core";
import { Effect } from "effect";
import { TrackerError } from "../model.js";
import { MyIssuesRef } from "../resources.js";
import { preloadShell, routeVerdicts } from "../session.js";

/** Home: the projects and the issues assigned to you. */
export const route = Route.define("/", {
  error: TrackerError,
  preload: ({ href }) =>
    preloadShell(href).pipe(Effect.andThen(Resource.preload(MyIssuesRef)), routeVerdicts(href)),
});
