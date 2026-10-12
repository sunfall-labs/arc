import { createRequestHandler } from "@sunfall/arc-start";
import { app, TodosMemory } from "./app.js";

// Server rendering: runs the route's preload, renders, and streams the hydration payload.
export const handleRequest = createRequestHandler(app, { server: TodosMemory });
