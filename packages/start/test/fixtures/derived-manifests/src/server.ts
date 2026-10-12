// A minimal Start server entry: the Vite plugin derives the server-function
// and Action manifests from what this handler serves.
import { Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { App, createRequestHandler } from "@sunfall/arc-start";
import { Effect } from "effect";
import { RenameProject } from "./project/project.actions.js";
import { getProject } from "./project/project.server.js";

const Root = Component.define("DerivedManifestsRoot", function* () {
  yield* Effect.void;
  return () => "root";
});

export default createRequestHandler(
  App.define({ root: Root, routes: [Route.define("/", {})] as const, actions: [RenameProject] }),
  { serverFunctions: [getProject] },
);
