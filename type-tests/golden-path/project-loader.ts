import { Machine, Message, Model, Resource, State } from "@sunfall/arc-core";
import { Schema } from "effect";
import { Project, ProjectsRef } from "./projects.js";

export const LoaderModel = Model({
  Idle: {},
  Loading: {},
  Ready: { projects: Schema.Array(Project) },
});
export const LoaderMessage = Message({
  ClickedLoad: {},
  ReceivedProjects: { projects: Schema.Array(Project) },
});

// The load is work the Loading state owns: it starts on entry, stops if the
// state is left, and its outcome comes back as a message.
export const ProjectLoader = State.define({
  name: "ProjectLoader",
  machine: Machine.make({ state: LoaderModel, event: LoaderMessage, initial: LoaderModel.Idle })
    .on(LoaderModel.Idle, LoaderMessage.ClickedLoad, () => LoaderModel.Loading)
    .task(LoaderModel.Loading, () => Resource.preload(ProjectsRef), {
      onSuccess: (projects) => LoaderMessage.ReceivedProjects({ projects }),
    })
    .on(LoaderModel.Loading, LoaderMessage.ReceivedProjects, ({ event }) =>
      LoaderModel.Ready({ projects: event.projects }),
    ),
});
