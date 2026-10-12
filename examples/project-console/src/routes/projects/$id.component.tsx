import type { Route } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { ProjectPage } from "../../project-page.js";
import type { route } from "./$id.js";

/**
 * The `/projects/:id` route component. As the route's sibling `*.component`
 * module, the generated route tree attaches it lazily, so the project page
 * loads as its own chunk.
 */
export default Component.define("ProjectRoutePage", function* (props: Route.Props<typeof route>) {
  const Page = yield* ProjectPage;
  return () => <Page id={props.params.id} tab={props.search.tab ?? "overview"} />;
});
