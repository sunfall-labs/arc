import type { Effect } from "effect";
import { Collection } from "@sunfall/arc-db";
import {
  buildQuery,
  collectCollectionsEffect,
  defaultCollectionDefinitionRegistry,
  forgetFailedCollectionLoadsEffect,
  isCollection,
  type CollectionDefinitionDiagnostics,
} from "@sunfall/arc-db/internal";

interface Project {
  readonly id: string;
}

// Adapter plumbing shared by Solid DB, Start, and devtools; not application API.
declare const projects: Collection.Definition<Project, string>;
const isProjects: boolean = isCollection(projects);
const collected: Effect.Effect<{ readonly definitions: ReadonlyArray<Collection.Any> }, never> =
  collectCollectionsEffect(projects.preload());
const diagnostics: ReadonlyArray<CollectionDefinitionDiagnostics> =
  defaultCollectionDefinitionRegistry.diagnostics().collections;
const rows: ReadonlyArray<Project> = buildQuery((query) =>
  query.from({ project: projects }).select(({ project }) => project),
).execute();
// Start's server render forgets failed first loads; it cannot fail.
const forgotten: Effect.Effect<void> = forgetFailedCollectionLoadsEffect([projects]);
void forgotten;
void isProjects;
void collected;
void diagnostics;
void rows;
