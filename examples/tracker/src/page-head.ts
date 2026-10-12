import type { Route } from "@sunfall/arc-core";
import { ProjectsRef } from "./resources.js";

type Read = Route.HeadContext<Route.Definition<string, unknown, unknown, any>>["read"];

/** A project's name for a page head, from the preloaded project navigation. */
export const projectName = (read: Read, key: string): string =>
  read(ProjectsRef)?.find((project) => project.key === key)?.name ?? key;

const pageTitle = (page: Route.Head, status: Route.HeadStatus): string | undefined =>
  status === "NotFound" ? "Not found" : status === "Failure" ? "Something went wrong" : page.title;

/**
 * Every page's head: the route's title (or the not-found and failure titles)
 * with the app's suffix, or the app's name alone, plus the tags every page
 * carries.
 */
export const trackerHead = (page: Route.Head, status: Route.HeadStatus): Route.Head => {
  const title = pageTitle(page, status);
  return {
    ...page,
    title: title === undefined ? "Tracker" : `${title} · Tracker`,
    meta: [{ name: "color-scheme", content: "light dark" }, ...(page.meta ?? [])],
  };
};
