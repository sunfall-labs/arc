// Shared by the server render test (Solid's server build) and the client
// hydration test (Solid's browser build): one tree whose Resource reads fail
// in the server render, one family with an `error` schema and one without.
import { Resource } from "@sunfall/arc-core";
import { createComponent, type JSX } from "@solidjs/web";
import { Data, Effect, Schema } from "effect";
import { Component } from "../src/index.js";

/** Server-only data a failure carries; it must never reach the page. */
export const secret = "server-only-secret-7f3a";

export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  id: Schema.String,
}) {}

/** A failure of a family without an `error` schema: only its `_tag` may cross. */
export class DatabaseDown extends Data.TaggedError("DatabaseDown")<{ readonly secret: string }> {}

/** Markup both sides render: each boundary's typed fallback. */
export const failureMarkup = "missing atlas<!--!$-->|untyped DatabaseDown";

/**
 * What the server render serializes for the two boundaries, exactly: the
 * schema-encoded `ProjectNotFound` (its declared `id`, not `secret`) and the
 * schema-less failure's `_tag`. The server test pins it; the client test
 * replays it, as the browser would run the inline script.
 */
export const serializedBoundaries =
  '(self.$R=self.$R||{})[""]=[];' +
  '_$HY.r["000"]=($R=>$R[0]={"~@sunfall/arc-solid/RenderFailure":$R[1]={_tag:"Resource",snapshot:$R[2]={resource:"ResourceFailureSsr.ProjectById",failure:$R[3]={_tag:"Encoded",value:$R[4]={_tag:"ProjectNotFound",id:"atlas"}}}},name:"RenderFailure",message:"Resource \\"ResourceFailureSsr.ProjectById\\" failed to load"})($R[""]);' +
  '_$HY.r["000"]=($R=>$R[0])($R[""]);' +
  '_$HY.r["010"]=($R=>$R[5]={"~@sunfall/arc-solid/RenderFailure":$R[6]={_tag:"Resource",snapshot:$R[7]={resource:"ResourceFailureSsr.Stats",failure:$R[8]={_tag:"Untyped",tag:"DatabaseDown"}}},name:"RenderFailure",message:"Resource \\"ResourceFailureSsr.Stats\\" failed to load"})($R[""]);' +
  '_$HY.r["010"]=($R=>$R[5])($R[""]);';

/** A reactive text child, as JSX compiles `{read()}`. */
const reactive = (read: () => string): JSX.Element => read as unknown as JSX.Element;

export const resourceFailureApp = () => {
  const events = {
    loads: 0,
    typed: [] as Array<unknown>,
    untyped: [] as Array<unknown>,
  };
  const ProjectById = Resource.define({
    name: "ResourceFailureSsr.ProjectById",
    error: ProjectNotFound,
    load: (id: string) =>
      Effect.suspend(() => {
        events.loads++;
        // Fields outside the schema stay on the server.
        return Effect.fail(Object.assign(new ProjectNotFound({ id }), { secret }));
      }),
  });
  const Stats = Resource.define({
    name: "ResourceFailureSsr.Stats",
    load: (_: "all") =>
      Effect.suspend(() => {
        events.loads++;
        return Effect.fail(new DatabaseDown({ secret }));
      }),
  });
  const ProjectCard = Component.define("ProjectCard", function* () {
    const project = yield* Component.resource(ProjectById);
    return () => reactive(() => project("atlas"));
  }).pipe(
    Component.catchTags({
      ProjectNotFound: (error) => {
        events.typed.push(error);
        return `missing ${error.id}`;
      },
    }),
  );
  const StatsCard = Component.define("StatsCard", function* () {
    const stats = yield* Component.resource(Stats);
    return () => reactive(() => stats("all"));
  }).pipe(
    Component.catchTags({
      ResourceUntypedFailure: (error) => {
        events.untyped.push(error);
        return `untyped ${error.tag}`;
      },
    }),
  );
  const Root = Component.define("Root", function* () {
    const Project = yield* ProjectCard;
    const StatsView = yield* StatsCard;
    return () => [createComponent(Project, {}), "|", createComponent(StatsView, {})];
  });
  return { ProjectById, Stats, Root, events };
};
