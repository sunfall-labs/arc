import { makeRuntime } from "@sunfall/arc-core";
import { BrowserRpcLive } from "@sunfall/arc-start";
import { Layer } from "effect";
import App from "../src/App.js";
import { ProjectApiLive } from "../src/domain.js";
import { ProjectDemoStoreLive } from "../src/domain.server.js";

const browserRuntime = makeRuntime(Layer.mergeAll(BrowserRpcLive, ProjectApiLive));
const serverRuntime = makeRuntime(Layer.mergeAll(ProjectApiLive, ProjectDemoStoreLive));
const projectRuntime = makeRuntime(ProjectApiLive);
const emptyRuntime = makeRuntime(Layer.empty);

App({});
App({ runtime: projectRuntime });
App({ runtime: browserRuntime });
App({ runtime: serverRuntime });

// @ts-expect-error Project Console runtime must provide ProjectApi.
App({ runtime: emptyRuntime });
