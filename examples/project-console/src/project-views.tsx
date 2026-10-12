import { formatProjectError, type ProjectStatus } from "./domain.js";

export const statusLabel = (status: ProjectStatus): string => {
  switch (status) {
    case "tracking":
      return "Tracking";
    case "watch":
      return "Watch";
    case "blocked":
      return "Blocked";
  }
};

export function FailureView(props: { readonly error: unknown }) {
  return (
    <section class="failureView">
      <h2>Could not load project</h2>
      <p>{formatProjectError(props.error)}</p>
    </section>
  );
}

export function InlineFailure(props: { readonly error: unknown }) {
  return <p class="inlineFailure">{formatProjectError(props.error)}</p>;
}

export function ProjectSkeleton() {
  return (
    <article class="projectDetail skeletonDetail" aria-label="Loading project">
      <div class="skeletonBlock tall" />
      <div class="metricGrid">
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
        <div class="skeletonBlock" />
      </div>
      <div class="skeletonBlock body" />
    </article>
  );
}
