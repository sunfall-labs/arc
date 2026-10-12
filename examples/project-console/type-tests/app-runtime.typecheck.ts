import { makeRuntime } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { makeActionTransportLayer, makeRpcClientLayer } from "@sunfall/arc-start";
import { Layer } from "effect";
import ProjectConsole from "../src/App.js";
import { ProjectApiLive, projectConsoleActions } from "../src/domain.js";
import { ProjectDemoStoreLive } from "../src/domain.server.js";

const browserRuntime = makeRuntime(
  Layer.mergeAll(
    makeRpcClientLayer(),
    makeActionTransportLayer({ actions: projectConsoleActions }),
    ProjectApiLive,
  ),
);
const serverRuntime = makeRuntime(Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive));
const projectRuntime = makeRuntime(ProjectApiLive);
const emptyRuntime = makeRuntime(Layer.empty);
declare const root: HTMLElement;

// The console's routes, route Components, Resources, and Actions need ProjectApi:
// every runtime that provides it can launch or embed the same tree.
Component.launch(ProjectConsole, root, { runtime: projectRuntime });
Component.launch(ProjectConsole, root, { runtime: browserRuntime, hydrate: true });
Component.embed(ProjectConsole, serverRuntime)({ initialHref: "/projects/atlas" });

// @ts-expect-error Project Console runtime must provide ProjectApi.
Component.launch(ProjectConsole, root, { runtime: emptyRuntime });
// @ts-expect-error A runtime-less launch provides no services either.
Component.launch(ProjectConsole, root);
