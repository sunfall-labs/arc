import { ActionResult, RequestContext, Server } from "@effect-ui/core";
import { Effect, Option } from "effect";
import {
  AdvanceProjectContract,
  GetProjectContract,
  InvalidProjectName,
  ListProjectsContract,
  makeProjectId,
  SubmitProjectNameContract,
  ProjectNotFound,
  RenameProjectContract,
  type Project,
  type ProjectError,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type SubmitProjectNameInput
} from "./domain.contract.js";

const cloneProject = (project: Project): Project => ({
  ...project,
  risks: [...project.risks]
});

const nowLabel = (): string =>
  new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

const requestNowLabelEffect: Effect.Effect<string> =
  Effect.gen(function* () {
    const context = yield* Effect.serviceOption(RequestContext);
    if (Option.isSome(context)) {
      const label = context.value.headers.get("x-effect-ui-now-label")?.trim();
      if (label) {
        return label;
      }
    }

    return nowLabel();
  });

const seedProjects: ReadonlyArray<Project> = [
  {
    id: makeProjectId("atlas"),
    name: "Atlas Billing",
    owner: "Mara",
    status: "tracking",
    health: "green",
    progress: 72,
    spend: 68,
    goal: "Move invoice preview and payment retries onto typed server functions.",
    nextMilestone: "Run retry workflow against the staging payment gateway.",
    updatedAt: "9:24 AM",
    risks: ["ACH retry copy needs legal review", "Webhook replay still manual"]
  },
  {
    id: makeProjectId("kepler"),
    name: "Kepler Search",
    owner: "Ilya",
    status: "watch",
    health: "amber",
    progress: 51,
    spend: 59,
    goal: "Replace ad hoc search state with resource families and route preload.",
    nextMilestone: "Ship saved-filter hydration without duplicate client fetches.",
    updatedAt: "10:08 AM",
    risks: ["Synonym cache warms slowly", "Keyboard nav still uneven"]
  },
  {
    id: makeProjectId("lumen"),
    name: "Lumen Support",
    owner: "Noor",
    status: "blocked",
    health: "red",
    progress: 34,
    spend: 81,
    goal: "Unify ticket assignment, SLA timers, and audit logs around Effect services.",
    nextMilestone: "Resolve queue ownership before the migration freeze.",
    updatedAt: "8:41 AM",
    risks: ["Legacy queue has missing owner data", "SLA export is not deterministic"]
  },
  {
    id: makeProjectId("meridian"),
    name: "Meridian Analytics",
    owner: "Theo",
    status: "tracking",
    health: "green",
    progress: 84,
    spend: 73,
    goal: "Move dashboard loaders to typed resources with stale-while-revalidate.",
    nextMilestone: "Dehydrate report cache into the first SSR payload.",
    updatedAt: "9:57 AM",
    risks: ["Report CSV shape changed twice this week"]
  }
];

const projects = new Map<ProjectId, Project>(
  seedProjects.map((project): [ProjectId, Project] => [project.id, project])
);

const withLatency = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    yield* Effect.sleep("180 millis");
    return yield* effect;
  });

const listProjectsEffect = withLatency(
  Effect.sync(() =>
    Array.from(projects.values())
      .map(({ goal: _goal, nextMilestone: _nextMilestone, updatedAt: _updatedAt, risks: _risks, ...summary }) => summary)
      .sort((left, right) => left.name.localeCompare(right.name))
  )
);

const getProjectEffect = (id: ProjectId): Effect.Effect<Project, ProjectError> =>
  withLatency(
    Effect.gen(function* () {
      const project = projects.get(id);
      if (!project) {
        return yield* new ProjectNotFound({ id });
      }

      return cloneProject(project);
    })
  );

const renameProjectEffect = (input: {
  readonly id: ProjectId;
  readonly name: string;
}): Effect.Effect<Project, ProjectError> =>
  withLatency(
    Effect.gen(function* () {
      const name = input.name.trim();
      if (name.length < 3) {
        return yield* new InvalidProjectName({ name: input.name });
      }

      const project = yield* getProjectEffect(input.id);
      const updatedAt = yield* requestNowLabelEffect;
      const updated = {
        ...project,
        name,
        updatedAt
      };

      projects.set(project.id, updated);
      return cloneProject(updated);
    })
  );

const submitProjectNameEffect = (
  input: SubmitProjectNameInput
): Effect.Effect<ProjectNameSubmissionResult> => {
  const name = input.name.trim();

  if (name.length < 3) {
    return ActionResult.validationEffect<SubmitProjectNameInput, string>({
      fieldErrors: {
        name: ["Use at least three meaningful characters."]
      },
      formErrors: []
    });
  }

  return renameProjectEffect({ id: input.id, name }).pipe(
    Effect.map((project) =>
      input.redirectTo
        ? ActionResult.redirect(input.redirectTo, { status: 303, replace: true })
        : ActionResult.success(project)
    ),
    Effect.catch((error) => ActionResult.failureEffect(error))
  );
};

const advanceProjectEffect = (id: ProjectId): Effect.Effect<Project, ProjectError> =>
  withLatency(
    Effect.gen(function* () {
      const project = yield* getProjectEffect(id);
      const updatedAt = yield* requestNowLabelEffect;
      const progress = Math.min(100, project.progress + 8);
      const updated = {
        ...project,
        progress,
        health: progress > 70 ? "green" : project.health,
        status: progress >= 100 ? "tracking" : project.status,
        updatedAt
      };

      projects.set(project.id, updated);
      return cloneProject(updated);
    })
  );

export const listProjects = Server.implement(ListProjectsContract, () => listProjectsEffect);

export const getProject = Server.implement(GetProjectContract, ({ id }) => getProjectEffect(id));

export const renameProject = Server.implement(RenameProjectContract, renameProjectEffect);

export const submitProjectName = Server.implement(SubmitProjectNameContract, submitProjectNameEffect);

export const advanceProject = Server.implement(AdvanceProjectContract, ({ id }) =>
  advanceProjectEffect(id)
);

export const serverFunctions = [
  listProjects,
  getProject,
  renameProject,
  submitProjectName,
  advanceProject
] as const;
