import { Server } from "@sunfall/arc-core";
import { Effect } from "effect";
import { GetProject } from "./project.contract.js";

export const getProject = Server.implement(GetProject, (id) => Effect.succeed(id));
