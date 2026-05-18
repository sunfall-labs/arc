import { ActionResult, RequestContext, Server } from "@sunfall/arc-core";
import { Context, Effect, Layer, Option, Ref } from "effect";
import {
  AdvanceProjectContract,
  GetProjectContract,
  InvalidProjectName,
  ListProjectWorkItemsContract,
  ListProjectsContract,
  makeProjectId,
  makeWorkItemId,
  SubmitProjectNameContract,
  ProjectNotFound,
  RenameProjectContract,
  UpdateWorkItemStatusContract,
  WorkItemNotFound,
  type Project,
  type ProjectError,
  type ProjectId,
  type ProjectNameSubmissionResult,
  type ProjectSummary,
  type ProjectWorkItem,
  type SubmitProjectNameInput,
  type WorkItemId,
  type WorkItemStatus,
} from "./domain.contract.js";

const cloneProject = (project: Project): Project => ({
  ...project,
  risks: [...project.risks],
});

const cloneWorkItem = (workItem: ProjectWorkItem): ProjectWorkItem => ({ ...workItem });

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

const seedWorkItems: ReadonlyArray<ProjectWorkItem> = [
  {
    id: makeWorkItemId("atlas-retry"),
    projectId: makeProjectId("atlas"),
    title: "Wire retry telemetry into the payment timeline",
    owner: "Mara",
    status: "running",
    priority: "high",
    impact: 9,
    updatedAt: "9:31 AM",
  },
  {
    id: makeWorkItemId("atlas-webhook"),
    projectId: makeProjectId("atlas"),
    title: "Replace manual webhook replay with typed action recovery",
    owner: "Theo",
    status: "queued",
    priority: "medium",
    impact: 6,
    updatedAt: "8:52 AM",
  },
  {
    id: makeWorkItemId("kepler-filters"),
    projectId: makeProjectId("kepler"),
    title: "Persist saved filters through route-owned hydration",
    owner: "Ilya",
    status: "blocked",
    priority: "high",
    impact: 8,
    updatedAt: "10:11 AM",
  },
  {
    id: makeWorkItemId("lumen-sla"),
    projectId: makeProjectId("lumen"),
    title: "Backfill SLA owner data before migration freeze",
    owner: "Noor",
    status: "running",
    priority: "high",
    impact: 10,
    updatedAt: "8:49 AM",
  },
  {
    id: makeWorkItemId("meridian-hydration"),
    projectId: makeProjectId("meridian"),
    title: "Verify report cache dehydration in streamed SSR",
    owner: "Theo",
    status: "done",
    priority: "medium",
    impact: 7,
    updatedAt: "9:59 AM",
  },
  {
    id: makeWorkItemId("meridian-diagnostics"),
    projectId: makeProjectId("meridian"),
    title: "Expose dashboard preload facts in the diagnostics panel",
    owner: "Mara",
    status: "queued",
    priority: "low",
    impact: 4,
    updatedAt: "9:44 AM",
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
  readonly listWorkItems: () => Effect.Effect<ProjectWorkItem[]>;
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
  readonly updateWorkItemStatus: (input: {
    readonly id: WorkItemId;
    readonly status: WorkItemStatus;
    readonly updatedAt: string;
  }) => Effect.Effect<ProjectWorkItem, ProjectError>;
}

export const ProjectDemoStore = Context.Service<ProjectDemoStore>(
  "@sunfall/arc-example-project-console/ProjectDemoStore",
);

export const makeProjectDemoStore = (
  initialProjects: ReadonlyArray<Project> = seedProjects,
  initialWorkItems: ReadonlyArray<ProjectWorkItem> = seedWorkItems,
): Effect.Effect<ProjectDemoStore> =>
  Effect.gen(function* () {
    const projects = yield* Ref.make(
      new Map<ProjectId, Project>(
        initialProjects.map((project): [ProjectId, Project] => [project.id, cloneProject(project)]),
      ),
    );
    const workItems = yield* Ref.make(
      new Map<WorkItemId, ProjectWorkItem>(
        initialWorkItems.map((workItem): [WorkItemId, ProjectWorkItem] => [
          workItem.id,
          cloneWorkItem(workItem),
        ]),
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
      listWorkItems: () =>
        Ref.get(workItems).pipe(
          Effect.map((current) =>
            Array.from(current.values())
              .map(cloneWorkItem)
              .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
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
      updateWorkItemStatus: (input) =>
        Effect.gen(function* () {
          const result = yield* Ref.modify(workItems, (current) => {
            const workItem = current.get(input.id);
            if (workItem === undefined) {
              return [Option.none<ProjectWorkItem>(), current] as const;
            }

            const updated = {
              ...workItem,
              status: input.status,
              updatedAt: input.updatedAt,
            };

            return [
              Option.some(cloneWorkItem(updated)),
              new Map(current).set(workItem.id, cloneWorkItem(updated)),
            ] as const;
          });

          if (Option.isNone(result)) {
            return yield* new WorkItemNotFound({ id: input.id });
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

const listProjectWorkItemsEffect: Effect.Effect<ProjectWorkItem[], never, ProjectDemoStore> =
  withLatency(ProjectDemoStore.use((store) => store.listWorkItems()));

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

const updateWorkItemStatusEffect = (input: {
  readonly id: WorkItemId;
  readonly status: WorkItemStatus;
}): Effect.Effect<ProjectWorkItem, ProjectError, ProjectDemoStore> =>
  withLatency(
    Effect.gen(function* () {
      const updatedAt = yield* requestNowLabelEffect;
      return yield* ProjectDemoStore.use((store) =>
        store.updateWorkItemStatus({ ...input, updatedAt }),
      );
    }),
  );

export const listProjects = Server.implement(ListProjectsContract, () => listProjectsEffect);

export const listProjectWorkItems = Server.implement(
  ListProjectWorkItemsContract,
  () => listProjectWorkItemsEffect,
);

export const getProject = Server.implement(GetProjectContract, ({ id }) => getProjectEffect(id));

export const renameProject = Server.implement(RenameProjectContract, renameProjectEffect);

export const submitProjectName = Server.implement(
  SubmitProjectNameContract,
  submitProjectNameEffect,
);

export const advanceProject = Server.implement(AdvanceProjectContract, ({ id }) =>
  advanceProjectEffect(id),
);

export const updateWorkItemStatus = Server.implement(UpdateWorkItemStatusContract, (input) =>
  updateWorkItemStatusEffect(input),
);

export const serverFunctions = [
  listProjects,
  listProjectWorkItems,
  getProject,
  renameProject,
  submitProjectName,
  advanceProject,
  updateWorkItemStatus,
] as const;
