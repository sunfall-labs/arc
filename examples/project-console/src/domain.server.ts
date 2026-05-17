import { ActionResult, RequestContext, Server } from "@sunfall/arc-core";
import { Context, Effect, Layer, Option, Ref } from "effect";
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
  type ProjectSummary,
  type SubmitProjectNameInput,
} from "./domain.contract.js";

const cloneProject = (project: Project): Project => ({
  ...project,
  risks: [...project.risks],
});

const nowLabel = (): string =>
  new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

const requestNowLabelEffect: Effect.Effect<string> = Effect.gen(function* () {
  const context = yield* Effect.serviceOption(RequestContext);
  if (Option.isSome(context)) {
    const label = context.value.headers.get("x-sunfall-arc-now-label")?.trim();
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
    risks: ["ACH retry copy needs legal review", "Webhook replay still manual"],
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
    risks: ["Synonym cache warms slowly", "Keyboard nav still uneven"],
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
    risks: ["Legacy queue has missing owner data", "SLA export is not deterministic"],
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
    risks: ["Report CSV shape changed twice this week"],
  },
];

const projectSummary = (project: Project): ProjectSummary => {
  const {
    goal: _goal,
    nextMilestone: _nextMilestone,
    updatedAt: _updatedAt,
    risks: _risks,
    ...summary
  } = project;
  return summary;
};

export interface ProjectDemoStore {
  readonly list: () => Effect.Effect<ProjectSummary[]>;
  readonly get: (id: ProjectId) => Effect.Effect<Project, ProjectError>;
  readonly rename: (input: {
    readonly id: ProjectId;
    readonly name: string;
    readonly updatedAt: string;
  }) => Effect.Effect<Project, ProjectError>;
  readonly advance: (input: {
    readonly id: ProjectId;
    readonly updatedAt: string;
  }) => Effect.Effect<Project, ProjectError>;
}

export const ProjectDemoStore = Context.Service<ProjectDemoStore>(
  "@sunfall/arc-example-project-console/ProjectDemoStore",
);

export const makeProjectDemoStore = (
  initialProjects: ReadonlyArray<Project> = seedProjects,
): Effect.Effect<ProjectDemoStore> =>
  Effect.gen(function* () {
    const projects = yield* Ref.make(
      new Map<ProjectId, Project>(
        initialProjects.map((project): [ProjectId, Project] => [project.id, cloneProject(project)]),
      ),
    );

    const requireProject = (id: ProjectId): Effect.Effect<Project, ProjectError> =>
      Ref.get(projects).pipe(
        Effect.flatMap((current) => {
          const project = current.get(id);
          return project === undefined
            ? Effect.fail(new ProjectNotFound({ id }))
            : Effect.succeed(cloneProject(project));
        }),
      );

    return {
      list: () =>
        Ref.get(projects).pipe(
          Effect.map((current) =>
            Array.from(current.values())
              .map(projectSummary)
              .sort((left, right) => left.name.localeCompare(right.name)),
          ),
        ),
      get: requireProject,
      rename: (input) =>
        Effect.gen(function* () {
          const name = input.name.trim();
          if (name.length < 3) {
            return yield* new InvalidProjectName({ name: input.name });
          }

          const result = yield* Ref.modify(projects, (current) => {
            const project = current.get(input.id);
            if (project === undefined) {
              return [Option.none<Project>(), current] as const;
            }

            const updated = {
              ...project,
              name,
              updatedAt: input.updatedAt,
            };
            return [
              Option.some(cloneProject(updated)),
              new Map(current).set(project.id, cloneProject(updated)),
            ] as const;
          });

          if (Option.isNone(result)) {
            return yield* new ProjectNotFound({ id: input.id });
          }

          return result.value;
        }),
      advance: (input) =>
        Effect.gen(function* () {
          const result = yield* Ref.modify(projects, (current) => {
            const project = current.get(input.id);
            if (project === undefined) {
              return [Option.none<Project>(), current] as const;
            }

            const progress = Math.min(100, project.progress + 8);
            const updated = {
              ...project,
              progress,
              health: progress > 70 ? "green" : project.health,
              status: progress >= 100 ? "tracking" : project.status,
              updatedAt: input.updatedAt,
            };
            return [
              Option.some(cloneProject(updated)),
              new Map(current).set(project.id, cloneProject(updated)),
            ] as const;
          });

          if (Option.isNone(result)) {
            return yield* new ProjectNotFound({ id: input.id });
          }

          return result.value;
        }),
    };
  });

export const ProjectDemoStoreLive = Layer.effect(ProjectDemoStore)(makeProjectDemoStore());

const withLatency = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* Effect.sleep("180 millis");
    return yield* effect;
  });

const listProjectsEffect: Effect.Effect<ProjectSummary[], never, ProjectDemoStore> = withLatency(
  ProjectDemoStore.use((store) => store.list()),
);

const getProjectEffect = (id: ProjectId): Effect.Effect<Project, ProjectError, ProjectDemoStore> =>
  withLatency(ProjectDemoStore.use((store) => store.get(id)));

const renameProjectEffect = (input: {
  readonly id: ProjectId;
  readonly name: string;
}): Effect.Effect<Project, ProjectError, ProjectDemoStore> =>
  withLatency(
    Effect.gen(function* () {
      const name = input.name.trim();
      const updatedAt = yield* requestNowLabelEffect;
      return yield* ProjectDemoStore.use((store) =>
        store.rename({ id: input.id, name, updatedAt }),
      );
    }),
  );

const submitProjectNameEffect = (
  input: SubmitProjectNameInput,
): Effect.Effect<ProjectNameSubmissionResult, never, ProjectDemoStore> => {
  const name = input.name.trim();

  if (name.length < 3) {
    return ActionResult.validationEffect<SubmitProjectNameInput, string>({
      fieldErrors: {
        name: ["Use at least three meaningful characters."],
      },
      formErrors: [],
    });
  }

  return renameProjectEffect({ id: input.id, name }).pipe(
    Effect.map((project) =>
      input.redirectTo
        ? ActionResult.redirect(input.redirectTo, { status: 303, replace: true })
        : ActionResult.success(project),
    ),
    Effect.catch((error) => ActionResult.failureEffect(error)),
  );
};

const advanceProjectEffect = (
  id: ProjectId,
): Effect.Effect<Project, ProjectError, ProjectDemoStore> =>
  withLatency(
    Effect.gen(function* () {
      const updatedAt = yield* requestNowLabelEffect;
      return yield* ProjectDemoStore.use((store) => store.advance({ id, updatedAt }));
    }),
  );

export const listProjects = Server.implement(ListProjectsContract, () => listProjectsEffect);

export const getProject = Server.implement(GetProjectContract, ({ id }) => getProjectEffect(id));

export const renameProject = Server.implement(RenameProjectContract, renameProjectEffect);

export const submitProjectName = Server.implement(
  SubmitProjectNameContract,
  submitProjectNameEffect,
);

export const advanceProject = Server.implement(AdvanceProjectContract, ({ id }) =>
  advanceProjectEffect(id),
);

export const serverFunctions = [
  listProjects,
  getProject,
  renameProject,
  submitProjectName,
  advanceProject,
] as const;
