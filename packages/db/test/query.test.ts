import {
  Action,
  EffectInputCallbackError,
  Resource,
  makeRuntime,
  runWithRuntime,
  type SunfallArcRuntime,
} from "@sunfall/arc-core";
import { applyResourceRowChanges, defaultRuntime } from "@sunfall/arc-core/internal";
import { Query, QueryEvaluationError } from "@sunfall/arc-db";
import { buildQuery } from "@sunfall/arc-db/internal";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import { QueryBuilder } from "../src/query-builder.js";

interface Project {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked";
  readonly progress: number;
}

interface Task {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly done: boolean;
}

interface TaggedTask extends Task {
  readonly tags: ReadonlyArray<string>;
}

interface RankedProject {
  readonly id: string;
  readonly name: string;
  readonly status: "active" | "blocked" | "queued";
  readonly progress: number;
}

const runInRuntime = <A, E, Services, RuntimeError>(
  runtime: SunfallArcRuntime<Services, RuntimeError>,
  effect: Effect.Effect<A, E, Services>,
): Promise<A> => Effect.runPromise(runtime.provide(effect));

/** Flattens an `AsyncResult` into matchable facts: tag, waiting, value/timestamp, typed error, defect, and previous success value. */
const asyncResultFacts = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  switch (result._tag) {
    case "Initial":
      return { _tag: result._tag, waiting: result.waiting };
    case "Success":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        value: result.value,
        timestamp: result.timestamp,
      };
    case "Failure":
      return {
        _tag: result._tag,
        waiting: result.waiting,
        error: Option.getOrUndefined(AsyncResult.error(result)),
        defect: result.cause.reasons.find(Cause.isDieReason)?.defect,
        previous: Option.getOrUndefined(AsyncResult.value(result)),
        cause: result.cause,
      };
  }
};

type RowsBrand<A, K extends Resource.RowKey> = Pick<
  Resource.RowsRef<A, K>,
  Exclude<keyof Resource.RowsRef<A, K>, keyof Resource.AnyRef>
>;

/** A query source: a rows Resource ref over server rows, plus a remote change helper. */
type RowsSource<A, K extends Resource.RowKey, E> = Resource.Ref<"all", ReadonlyArray<A>, E> &
  RowsBrand<A, K> & {
    /** Applies changes to the server rows, then refreshes the ref. */
    readonly applyChanges: (
      changes: ReadonlyArray<Resource.RowChange<A, K>>,
    ) => Effect.Effect<void, E>;
    readonly server: { rows: ReadonlyArray<A> };
  };

interface RowsSourceOptions<A, K extends Resource.RowKey, E> {
  readonly name: string;
  readonly getKey: (row: A) => K;
  readonly indexes?: Record<string, (row: A) => Resource.RowIndexResult>;
  /** Rows the server starts with; the source loads them at once. */
  readonly initialData?: ReadonlyArray<A>;
  /** A custom server load instead of the server rows; nothing loads until preloaded. */
  readonly load?: () => Effect.Effect<ReadonlyArray<A>, E>;
}

/**
 * Defines a Resource with `rows` over in-memory server rows. With
 * `initialData` the default runtime loads it at once.
 */
const rowsSource = <A, K extends Resource.RowKey = string, E = never>(
  options: RowsSourceOptions<A, K, E>,
): RowsSource<A, K, E> => {
  const server = { rows: options.initialData ?? [] };
  const family = Resource.define({
    name: options.name,
    input: Schema.Literal("all"),
    output: Schema.Array(Schema.Any),
    rows: {
      key: (row: unknown) => options.getKey(row as A),
      ...(options.indexes === undefined ? {} : { indexes: options.indexes as never }),
    },
    load: () => options.load?.() ?? Effect.sync(() => server.rows),
  } as never) as unknown as (input: "all") => Resource.AnyRef;
  const ref = family("all");
  const rowsOptions = ref.family.options.rows!;
  const source = Object.assign(ref, {
    server,
    applyChanges: (changes: ReadonlyArray<Resource.RowChange<A, K>>) =>
      Effect.suspend(() => {
        server.rows = applyResourceRowChanges(
          ref.family.options.name,
          rowsOptions,
          server.rows,
          changes,
        ) as ReadonlyArray<A>;
        return Effect.asVoid(Resource.refresh(ref));
      }),
  });
  if (options.initialData !== undefined && options.load === undefined) {
    Effect.runSync(Resource.preload(ref) as Effect.Effect<unknown>);
  }
  return source as unknown as RowsSource<A, K, E>;
};

describe("Query", () => {
  const expectUnsupportedLiveQueryPlan = (
    factory: Query.Factory<any, any, any>,
    reason: string,
  ): void => {
    expect(() => buildQuery(factory).execute()).toThrow(QueryEvaluationError);
    try {
      buildQuery(factory).execute();
      expect.fail("Expected query build execution to reject the unsupported live query plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason,
        },
      });
    }

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject the unsupported live query plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason,
        },
      });
    }
  };

  it("normalizes build, live, and diagnostics factory throws to QueryEvaluationError", () => {
    const thrown = new Error("query factory failed");
    const factory: Query.Factory<string> = () => {
      throw thrown;
    };

    for (const evaluate of [
      () => buildQuery(factory).execute(),
      () => Query.live(factory),
      () => Query.diagnostics(factory),
    ]) {
      expect(evaluate).toThrow(QueryEvaluationError);
      try {
        evaluate();
      } catch (error) {
        expect(error).toMatchObject({
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: thrown,
        });
      }
    }
  });

  it("rejects invalid query factory results at the factory boundary", async () => {
    const promised = Effect.runPromise(
      Effect.succeed(
        buildQuery((query) =>
          query.from({
            project: rowsSource<Project>({
              name: "Projects.promise-query-factory",
              getKey: (project) => project.id,
              initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
            }),
          }),
        ),
      ),
    );
    const throwingThenFactoryResult = Object.defineProperty({}, "then", {
      get: () => {
        throw new Error("then getter failed");
      },
    });
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly reason: "promise" | "effect" | "builder";
      readonly factory: Query.Factory<string>;
    }> = [
      {
        label: "promise",
        reason: "promise",
        factory: (() => promised) as never,
      },
      {
        label: "throwing then",
        reason: "promise",
        factory: (() => throwingThenFactoryResult) as never,
      },
      {
        label: "effect",
        reason: "effect",
        factory: (() => Effect.succeed(buildQuery((query) => query.from({})))) as never,
      },
      {
        label: "non-builder",
        reason: "builder",
        factory: (() => ({ execute: () => [] })) as never,
      },
    ];

    for (const testCase of cases) {
      for (const evaluate of [
        () => buildQuery(testCase.factory).execute(),
        () => Query.live(testCase.factory),
        () => Query.diagnostics(testCase.factory),
      ]) {
        expect(evaluate, testCase.label).toThrow(QueryEvaluationError);
        try {
          evaluate();
          expect.fail(`Expected ${testCase.label} query factory result to reject.`);
        } catch (error) {
          expect(error).toMatchObject({
            _tag: "QueryEvaluationError",
            operation: "evaluate",
            cause: {
              _tag: "QueryFactoryResultRejected",
              reason: testCase.reason,
            },
          });
        }
      }

      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "QueryFactoryResultRejected",
            reason: testCase.reason,
          },
        });
      }
    }
  });

  it("keeps a live single-collection query updated through the IVM adapter", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-filter",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.status === "active" && project.progress > 50)
        .select(({ project }) => project.name)
        .orderBy(({ project }) => project.name),
    );

    expect(live.evaluate()).toEqual(["Atlas"]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Update",
          key: "lumen",
          changes: {
            status: "active",
            progress: 56,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual(["Atlas", "Lumen"]);

    await Effect.runPromise(Projects.applyChanges([{ _tag: "Delete", key: "atlas" }]));

    expect(live.evaluate()).toEqual(["Lumen"]);
  });

  it("keeps numeric and string collection keys distinct in live queries", async () => {
    interface NumericKeyProject {
      readonly id: string | number;
      readonly name: string;
      readonly status: "active" | "blocked";
      readonly progress: number;
    }
    const Projects = rowsSource<NumericKeyProject, string | number>({
      name: "Projects.live-key-kind",
      getKey: (project) => project.id,
      initialData: [
        { id: 1, name: "Numeric", status: "active", progress: 10 },
        { id: "1", name: "String", status: "active", progress: 20 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name),
    );

    expect(live.evaluate()).toEqual(["Numeric", "String"]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: 1, changes: { name: "Numeric Updated" } }]),
    );

    expect(live.evaluate()).toEqual(["Numeric Updated", "String"]);
  });

  it("keeps one-shot and live ordering parity for equal sort keys", () => {
    const Projects = rowsSource<Project>({
      name: "Projects.query-order-parity",
      getKey: (project) => project.id,
      initialData: [
        { id: "zeta", name: "Zeta", status: "active", progress: 10 },
        { id: "alpha", name: "Alpha", status: "active", progress: 10 },
      ],
    });
    const factory: Query.Factory<string, never> = (query) =>
      query
        .from({ project: Projects })
        .orderBy(({ project }) => project.progress)
        .select(({ project }) => project.name);

    expect(buildQuery(factory).execute()).toEqual(["Alpha", "Zeta"]);
    expect(Query.live(factory).evaluate()).toEqual(["Alpha", "Zeta"]);
  });

  it("deduplicates live query source ownership for self joins", () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-self-join-sources",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join(
          "right",
          Projects,
          ({ left }) => left.id,
          (right) => right.id,
        )
        .select(({ left, right }) => `${left.name}:${right.name}`),
    );

    expect(live.sources).toEqual([Projects]);
    expect(live.evaluate()).toEqual(["Atlas:Atlas"]);
  });

  it("refreshes self-join source collections once", async () => {
    const refetch = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = rowsSource<Project>({
      name: "Projects.live-self-join-refresh-source",
      getKey: (project) => project.id,
      load: refetch,
    });
    const live = Query.live((query) =>
      query
        .from({ left: Projects })
        .join(
          "right",
          Projects,
          ({ left }) => left.id,
          (right) => right.id,
        )
        .select(({ left, right }) => `${left.name}:${right.name}`),
    );

    await Effect.runPromise(live.refresh());

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(live.sources).toEqual([Projects]);
    expect(live.evaluate()).toEqual(["Atlas:Atlas"]);
  });

  it("rejects zero-source live queries consistently", async () => {
    const malformed = new QueryBuilder<Record<string, never>, string>(
      [],
      [],
      () => "empty",
      [],
      0,
      undefined,
      [],
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(factory, "Queries require at least one source.");

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Queries require at least one source.",
        },
      });
    }

    const live = Query.live(factory);
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: "Queries require at least one source.",
        },
      },
    });
  });

  it("normalizes query factory throws as query evaluation errors", async () => {
    const thrown = new Error("factory failed");

    const onceExit = await Effect.runPromiseExit(
      Query.once(() => {
        throw thrown;
      }),
    );

    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: thrown,
      });
    }
  });

  it("rejects non-finite and fractional query windows consistently", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.invalid-query-window",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const cases = [
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(Number.NaN),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) =>
          query.from({ project: Projects }).offset(Number.POSITIVE_INFINITY),
        reason: "Query offset must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(1.5),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).limit(-1),
        reason: "Query limit must be a finite non-negative safe integer.",
      },
      {
        factory: (query: Query.Root) => query.from({ project: Projects }).offset(-0.5),
        reason: "Query offset must be a finite non-negative safe integer.",
      },
    ];

    for (const { factory, reason } of cases) {
      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        });
      }

      const live = Query.live(factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        },
      });
    }
  });

  it("rejects reserved query source aliases consistently", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.reserved-query-alias",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const aliases = ["__proto__", "constructor", "prototype"] as const;

    for (const alias of aliases) {
      const reason = `Query source alias "${alias}" is reserved. Use a domain alias that can be represented as an own object property.`;
      const factory = (query: Query.Root) =>
        query
          .from({ [alias]: Projects } as Record<string, typeof Projects>)
          .select(() => "unreachable");

      expectUnsupportedLiveQueryPlan(factory, reason);

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit)).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        });
      }

      const live = Query.live(factory);
      expect(live.rows.get()).toEqual([]);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        previous: undefined,
        error: {
          _tag: "QueryEvaluationError",
          operation: "evaluate",
          cause: {
            _tag: "UnsupportedLiveQuery",
            reason,
          },
        },
      });
    }
  });

  it("rejects duplicate query aliases consistently", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const Projects = rowsSource<Project>({
      name: "Projects.duplicate-query-alias",
      getKey: (project) => project.id,
      load: projectLoad,
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.duplicate-query-alias",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join(
          "project",
          Tasks,
          ({ project }) => project.id,
          (task) => task.projectId,
        )
        .select(({ project }) => project.name);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Query source alias "project" is registered more than once.',
    );

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();

    const live = Query.live(factory);
    const livePreloadExit = await Effect.runPromiseExit(live.preload());
    expect(Exit.isFailure(livePreloadExit)).toBe(true);
    if (Exit.isFailure(livePreloadExit)) {
      const error = livePreloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();
    expect(live.rows.get()).toEqual([]);
    const state = live.state.get();
    expect(asyncResultFacts(state)).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Query source alias "project" is registered more than once.',
        },
      },
    });
  });

  it("normalizes invalid join key encoding as join evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = rowsSource<Project>({
      name: "Projects.invalid-join-key",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.invalid-join-key",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .join(
          "task",
          Tasks,
          () => invalidDate,
          (task) => task.projectId,
        )
        .select(({ project }) => project.name);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid join keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "join" });
    }

    const live = Query.live(factory);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "join",
      },
    });
  });

  it("normalizes invalid group key encoding as aggregate evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = rowsSource<Project>({
      name: "Projects.invalid-group-key",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .groupBy(() => ({ createdAt: invalidDate }), { count: Query.count() })
        .select((group) => group.count);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);
    try {
      Query.diagnostics(factory);
      expect.fail("Expected query diagnostics to reject invalid group keys.");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({ operation: "aggregate" });
    }

    const live = Query.live(factory);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "aggregate",
      },
    });
  });

  it("normalizes invalid order values as order evaluation errors", async () => {
    const invalidDate = new Date(Number.NaN);
    const Projects = rowsSource<Project>({
      name: "Projects.invalid-order-value",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const cases = [
      { label: "invalid-date", value: invalidDate },
      { label: "nan", value: Number.NaN },
    ] as const;

    for (const testCase of cases) {
      const factory = (query: Query.Root) =>
        query
          .from({ project: Projects })
          .orderBy(() => testCase.value)
          .select(({ project }) => project.name);

      expect(() => Query.diagnostics(factory), testCase.label).toThrow(QueryEvaluationError);
      try {
        Query.diagnostics(factory);
        expect.fail(`Expected query diagnostics to reject ${testCase.label} order values.`);
      } catch (error) {
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({ operation: "order" });
      }

      const onceExit = await Effect.runPromiseExit(Query.once(factory));
      expect(Exit.isFailure(onceExit), testCase.label).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({ operation: "order" });
      }

      const live = Query.live(factory);
      expect(live.rows.get()).toEqual([]);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: "order",
        },
      });
    }
  });

  it("rejects Promise-shaped query callbacks as typed evaluation errors", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.promise-query-callbacks",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.promise-query-callbacks",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const promised = <A>(value: A): A => Effect.runPromise(Effect.succeed(value)) as never;
    const throwingThen = (): unknown =>
      Object.defineProperty({}, "then", {
        get: () => {
          throw new Error("then getter failed");
        },
      });
    const cases: ReadonlyArray<{
      readonly operation: "filter" | "join" | "order" | "projection" | "aggregate";
      readonly factory: Query.Factory<unknown, never>;
    }> = [
      {
        operation: "filter",
        factory: (query) =>
          query
            .from({ project: Projects })
            .where((() => promised(true)) as never)
            .select(({ project }) => project.name),
      },
      {
        operation: "projection",
        factory: (query) =>
          query.from({ project: Projects }).select((() => promised("Atlas")) as never),
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: promised("Atlas") } })) as never),
      },
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: throwingThen() } })) as never),
      },
      {
        operation: "join",
        factory: (query) =>
          query
            .from({ project: Projects })
            .join("task", Tasks, (() => promised("atlas")) as never, (task) => task.projectId)
            .select(({ project }) => project.name),
      },
      {
        operation: "order",
        factory: (query) =>
          query
            .from({ project: Projects })
            .orderBy((() => promised(1)) as never)
            .select(({ project }) => project.name),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(({ project }) => ({ status: project.status }), {
              count: Query.count((() => promised("present")) as never),
            })
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                asyncKey: promised("active"),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                asyncKey: throwingThen(),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" },
        });
      }

      const live = Query.live(testCase.factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackPromiseRejected" },
        },
      });
    }
  });

  it("rejects Effect-shaped query callback values as typed evaluation errors", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.effect-query-callbacks",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const cases: ReadonlyArray<{
      readonly operation: "projection" | "aggregate";
      readonly factory: Query.Factory<unknown, never>;
    }> = [
      {
        operation: "projection",
        factory: (query) =>
          query
            .from({ project: Projects })
            .select((() => ({ nested: { value: Effect.succeed("Atlas") } })) as never),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(
              (({ project }: { readonly project: Project }) => ({
                status: project.status,
                effectKey: Effect.succeed("active"),
              })) as never,
              { count: Query.count() },
            )
            .select((group) => group.count),
      },
      {
        operation: "aggregate",
        factory: (query) =>
          query
            .from({ project: Projects })
            .groupBy(({ project }) => ({ status: project.status }), {
              count: Query.count((() => Effect.succeed("present")) as never),
            })
            .select((group) => group.count),
      },
    ];

    for (const testCase of cases) {
      const onceExit = await Effect.runPromiseExit(Query.once(testCase.factory));
      expect(Exit.isFailure(onceExit), testCase.operation).toBe(true);
      if (Exit.isFailure(onceExit)) {
        const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
        expect(error).toBeInstanceOf(QueryEvaluationError);
        expect(error).toMatchObject({
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" },
        });
      }

      const live = Query.live(testCase.factory);
      expect(asyncResultFacts(live.state.get())).toMatchObject({
        _tag: "Failure",
        error: {
          _tag: "QueryEvaluationError",
          operation: testCase.operation,
          cause: { _tag: "QueryCallbackEffectRejected" },
        },
      });
    }
  });

  it("rejects query joins without registered source aliases consistently", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.missing-query-join-source",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.missing-query-join-source",
      getKey: (task) => task.id,
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const malformed = new QueryBuilder<{ readonly project: Project }, string>(
      [["project", Projects]],
      [],
      ({ project }) => project.name,
      [],
      0,
      undefined,
      [
        {
          alias: "task",
          source: Tasks,
          leftKey: ({ project }) => project.id,
          rightKeys: () => ["atlas"],
        },
      ],
    );
    const factory = () => malformed;

    expectUnsupportedLiveQueryPlan(factory, 'Join source "task" is not registered.');

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.',
        },
      });
    }

    const live = Query.live(factory);
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      previous: undefined,
      error: {
        _tag: "QueryEvaluationError",
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason: 'Join source "task" is not registered.',
        },
      },
    });
  });

  it("maintains live joins across collections", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.live-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects, task: Tasks })
        .where(({ project, task }) => project.id === task.projectId)
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([
        {
          _tag: "Upsert",
          value: {
            id: "t3",
            projectId: "atlas",
            title: "Webhook replay",
            done: false,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Retry workflow",
      "Atlas:Webhook replay",
      "Lumen:Queue ownership",
    ]);
  });

  it("maintains explicit keyed joins through the IVM join operator", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.explicit-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.explicit-join",
      getKey: (task) => task.id,
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .join(
          "task",
          Tasks,
          ({ project }) => project.id,
          (task) => task.projectId,
        )
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { projectId: "atlas" } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);

    await Effect.runPromise(Projects.applyChanges([{ _tag: "Delete", key: "lumen" }]));

    expect(live.evaluate()).toEqual(["Atlas:Orphan", "Atlas:Retry workflow"]);
  });

  it("uses declared collection indexes for indexed joins", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId,
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { projectId: "atlas" } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);
  });

  it("evaluates indexed join selectors against public row values", async () => {
    const seenTaskKeys: Array<ReadonlyArray<string>> = [];
    const Projects = rowsSource<Project>({
      name: "Projects.indexed-join-public-values",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.indexed-join-public-values",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => {
          seenTaskKeys.push(Object.keys(task));
          return task.projectId;
        },
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
      ],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`);

    expect(Query.diagnostics(factory)).toMatchObject({
      joins: [
        {
          alias: "task",
          strategy: "index",
          index: "byProject",
          outputRows: 2,
        },
      ],
    });
    await expect(Effect.runPromise(Query.once(factory))).resolves.toEqual([
      "Atlas:Retry workflow",
      "Lumen:Queue ownership",
    ]);

    const live = Query.live(factory);
    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);
    expect(seenTaskKeys.length).toBeGreaterThan(0);
    expect(seenTaskKeys.every((keys) => keys.every((key) => !key.startsWith("$")))).toBe(true);
  });

  it("normalizes indexed join index selector throws as join evaluation errors", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.indexed-join-selector-error",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.indexed-join-selector-error",
      getKey: (task) => task.id,
      indexes: {
        byProject: () => {
          throw "index failed";
        },
      },
      initialData: [{ id: "t1", projectId: "atlas", title: "Retry workflow", done: false }],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expect(() => Query.diagnostics(factory)).toThrow(QueryEvaluationError);

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      const indexError = error instanceof QueryEvaluationError ? error.cause : undefined;
      expect(indexError).toBeInstanceOf(EffectInputCallbackError);
      expect(error).toMatchObject({
        operation: "join",
      });
      expect(indexError).toMatchObject({
        cause: "index failed",
      });
    }
  });

  it("reports live-query source fingerprint failures as source evaluation errors", () => {
    interface ProjectWithCallback {
      readonly id: string;
      readonly name: string;
      readonly callback: () => void;
    }

    const Projects = rowsSource<ProjectWithCallback>({
      name: "Projects.live-source-fingerprint-error",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", callback: () => undefined }],
    });
    const live = Query.live((query) =>
      query.from({ project: Projects }).select(({ project }) => project.name),
    );

    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      error: {
        _tag: "QueryEvaluationError",
        operation: "source",
        cause: {
          _tag: "StableStringifyUnsupportedValue",
          path: "$.callback",
        },
      },
    });
  });

  it("rejects indexed joins that name an undeclared collection index before live preload loads sources", async () => {
    const projectLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Project>>([
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
      ]),
    );
    const taskLoad = vi.fn(() =>
      Effect.succeed<ReadonlyArray<Task>>([
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
      ]),
    );
    const Projects = rowsSource<Project>({
      name: "Projects.missing-indexed-join",
      getKey: (project) => project.id,
      load: projectLoad,
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.missing-indexed-join",
      getKey: (task) => task.id,
      load: taskLoad,
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "missing")
        .select(({ project, task }) => `${project.name}:${task.title}`);

    expectUnsupportedLiveQueryPlan(
      factory,
      'Join source "task" uses unknown index "missing" on Resource "Tasks.missing-indexed-join".',
    );

    const onceExit = await Effect.runPromiseExit(Query.once(factory));
    expect(Exit.isFailure(onceExit)).toBe(true);
    if (Exit.isFailure(onceExit)) {
      const error = onceExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason:
            'Join source "task" uses unknown index "missing" on Resource "Tasks.missing-indexed-join".',
        },
      });
    }

    const live = Query.live(factory);
    const preloadExit = await Effect.runPromiseExit(live.preload());
    expect(Exit.isFailure(preloadExit)).toBe(true);
    if (Exit.isFailure(preloadExit)) {
      const error = preloadExit.cause.reasons.find(Cause.isFailReason)?.error;
      expect(error).toBeInstanceOf(QueryEvaluationError);
      expect(error).toMatchObject({
        operation: "evaluate",
        cause: {
          _tag: "UnsupportedLiveQuery",
          reason:
            'Join source "task" uses unknown index "missing" on Resource "Tasks.missing-indexed-join".',
        },
      });
    }
    expect(projectLoad).not.toHaveBeenCalled();
    expect(taskLoad).not.toHaveBeenCalled();
  });

  it("keeps live-query output identities distinct when keys contain old delimiters", () => {
    interface IdentityRow {
      readonly id: string;
      readonly label: string;
    }

    const Left = rowsSource<IdentityRow>({
      name: "Live.identity-left",
      getKey: (row) => row.id,
      initialData: [
        { id: "a", label: "left-a" },
        { id: "a|right:string:b", label: "left-delimited" },
      ],
    });
    const Right = rowsSource<IdentityRow>({
      name: "Live.identity-right",
      getKey: (row) => row.id,
      initialData: [
        { id: "b|right:string:c", label: "right-delimited" },
        { id: "c", label: "right-c" },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ left: Left, right: Right })
        .select(({ left, right }) => `${left.label}:${right.label}`)
        .orderBy(({ left, right }) => `${left.label}:${right.label}`),
    );

    expect(live.evaluate()).toEqual([
      "left-a:right-c",
      "left-a:right-delimited",
      "left-delimited:right-c",
      "left-delimited:right-delimited",
    ]);
  });

  it("describes query plans with indexed join cost diagnostics", () => {
    const Projects = rowsSource<Project>({
      name: "Projects.query-diagnostics",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<Task>({
      name: "Tasks.query-diagnostics",
      getKey: (task) => task.id,
      indexes: {
        byProject: (task) => task.projectId,
      },
      initialData: [
        { id: "t1", projectId: "atlas", title: "Retry workflow", done: false },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false },
        { id: "t3", projectId: "missing", title: "Orphan", done: false },
      ],
    });

    const plan = Query.diagnostics((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.id, "byProject")
        .where(({ project }) => project.status === "active")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`)
        .limit(1),
    );

    expect(plan).toEqual({
      sources: [
        { alias: "project", resource: "Projects.query-diagnostics", rows: 2 },
        { alias: "task", resource: "Tasks.query-diagnostics", rows: 3 },
      ],
      joins: [
        {
          alias: "task",
          resource: "Tasks.query-diagnostics",
          strategy: "index",
          index: "byProject",
          leftRows: 2,
          rightRows: 3,
          outputRows: 2,
          estimatedComparisons: 2,
        },
      ],
      filters: 1,
      orders: 1,
      grouped: false,
      offset: 0,
      limit: 1,
      contextRows: 2,
    });
  });

  it("joins through multi-value collection indexes", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.multi-indexed-join",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const Tasks = rowsSource<TaggedTask>({
      name: "Tasks.multi-indexed-join",
      getKey: (task) => task.id,
      indexes: {
        byTag: (task) => task.tags,
      },
      initialData: [
        {
          id: "t1",
          projectId: "atlas",
          title: "Retry workflow",
          done: false,
          tags: ["active", "urgent"],
        },
        { id: "t2", projectId: "lumen", title: "Queue ownership", done: false, tags: ["blocked"] },
        { id: "t3", projectId: "missing", title: "Orphan", done: false, tags: ["missing"] },
      ],
    });

    await expect(
      Effect.runPromise(
        Query.once((query) =>
          query
            .from({ project: Projects })
            .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
            .select(({ project, task }) => `${project.name}:${task.title}`)
            .orderBy(({ project, task }) => `${project.name}:${task.title}`),
        ),
      ),
    ).resolves.toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .joinIndexed("task", Tasks, ({ project }) => project.status, "byTag")
        .select(({ project, task }) => `${project.name}:${task.title}`)
        .orderBy(({ project, task }) => `${project.name}:${task.title}`),
    );

    expect(live.evaluate()).toEqual(["Atlas:Retry workflow", "Lumen:Queue ownership"]);

    await Effect.runPromise(
      Tasks.applyChanges([{ _tag: "Update", key: "t3", changes: { tags: ["active", "blocked"] } }]),
    );

    expect(live.evaluate()).toEqual([
      "Atlas:Orphan",
      "Atlas:Retry workflow",
      "Lumen:Orphan",
      "Lumen:Queue ownership",
    ]);
  });

  it("maintains ordered live query windows inside the IVM graph", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-window",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 51 },
        { id: "lumen", name: "Lumen", status: "active", progress: 34 },
        { id: "meridian", name: "Meridian", status: "active", progress: 84 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .select(({ project }) => ({
          id: project.id,
          progress: project.progress,
        }))
        .orderBy(({ project }) => project.progress, "desc")
        .limit(2),
    );

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { progress: 95 } }]),
    );

    expect(live.evaluate()).toEqual([
      { id: "lumen", progress: 95 },
      { id: "meridian", progress: 84 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { progress: 40 } }]),
    );

    expect(live.evaluate()).toEqual([
      { id: "meridian", progress: 84 },
      { id: "atlas", progress: 72 },
    ]);
  });

  it("maintains grouped aggregate live queries inside the IVM graph", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-groupBy",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(({ project }) => ({ status: project.status }), {
          count: Query.count(),
          totalProgress: Query.sum(({ project }) => project.progress),
          avgProgress: Query.avg(({ project }) => project.progress),
        })
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress,
          avgProgress: group.avgProgress,
        }))
        .orderBy((group) => group.status),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 2, totalProgress: 124, avgProgress: 62 },
      { status: "blocked", count: 1, totalProgress: 34, avgProgress: 34 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Update",
          key: "lumen",
          changes: {
            status: "active",
            progress: 40,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([
        {
          _tag: "Upsert",
          value: {
            id: "meridian",
            name: "Meridian",
            status: "blocked",
            progress: 80,
          },
        },
      ]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3, totalProgress: 164, avgProgress: 164 / 3 },
      { status: "blocked", count: 1, totalProgress: 80, avgProgress: 80 },
    ]);
  });

  it("applies grouped aggregate filters before and after grouping", async () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-groupBy-filter",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 50)
        .groupBy(({ project }) => ({ status: project.status }), { count: Query.count() })
        .where((group) => group.count > 1)
        .select((group) => group.status),
    );

    expect(live.evaluate()).toEqual(["active"]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "kepler", changes: { progress: 30 } }]),
    );

    expect(live.evaluate()).toEqual([]);
  });

  it("maintains grouped aggregate ordered windows inside the IVM graph", async () => {
    const Projects = rowsSource<RankedProject>({
      name: "Projects.live-groupBy-window",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
        { id: "meridian", name: "Meridian", status: "queued", progress: 80 },
        { id: "orion", name: "Orion", status: "queued", progress: 12 },
        { id: "vega", name: "Vega", status: "queued", progress: 24 },
      ],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .groupBy(({ project }) => ({ status: project.status }), { count: Query.count() })
        .select((group) => ({
          status: group.status,
          count: group.count,
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2),
    );

    expect(live.evaluate()).toEqual([
      { status: "queued", count: 3 },
      { status: "active", count: 2 },
    ]);

    await Effect.runPromise(
      Projects.applyChanges([{ _tag: "Update", key: "lumen", changes: { status: "active" } }]),
    );

    expect(live.evaluate()).toEqual([
      { status: "active", count: 3 },
      { status: "queued", count: 3 },
    ]);
  });

  it("shares grouped query execution plan stages across snapshot, once, and live queries", async () => {
    const Projects = rowsSource<RankedProject>({
      name: "Projects.query-execution-plan-parity",
      getKey: (project) => project.id,
      initialData: [
        { id: "atlas", name: "Atlas", status: "active", progress: 72 },
        { id: "kepler", name: "Kepler", status: "active", progress: 52 },
        { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
        { id: "orion", name: "Orion", status: "blocked", progress: 24 },
        { id: "meridian", name: "Meridian", status: "queued", progress: 80 },
      ],
    });
    const factory = (query: Query.Root) =>
      query
        .from({ project: Projects })
        .where(({ project }) => project.progress >= 20)
        .groupBy(({ project }) => ({ status: project.status }), {
          count: Query.count(),
          totalProgress: Query.sum(({ project }) => project.progress),
        })
        .where((group) => group.count >= 2)
        .select((group) => ({
          status: group.status,
          count: group.count,
          totalProgress: group.totalProgress,
        }))
        .orderBy((group) => group.count, "desc")
        .orderBy((group) => group.status)
        .limit(2);
    const expected = [
      { status: "active", count: 2, totalProgress: 124 },
      { status: "blocked", count: 2, totalProgress: 58 },
    ];

    expect(buildQuery(factory).execute()).toEqual(expected);
    await expect(Effect.runPromise(Query.once(factory))).resolves.toEqual(expected);
    expect(Query.live(factory).evaluate()).toEqual(expected);
  });
});

describe("Query.live state", () => {
  it("reports synchronous query callback throws as typed evaluation errors", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = rowsSource<Project>({
          name: "Projects.query-evaluation-errors",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          ],
        });
        const Cards = rowsSource<{ readonly id: string; readonly name: string }>({
          name: "ProjectCards.query-evaluation-errors",
          getKey: (card) => card.id,
          initialData: [{ id: "atlas", name: "Atlas" }],
        });
        const throwError = (message: string): never => {
          throw new Error(message);
        };
        const cases: ReadonlyArray<{
          readonly operation: string;
          readonly effect: Effect.Effect<ReadonlyArray<unknown>, unknown>;
        }> = [
          {
            operation: "filter",
            effect: Query.once((query) =>
              query.from({ project: Projects }).where(() => throwError("filter failed")),
            ),
          },
          {
            operation: "projection",
            effect: Query.once((query) =>
              query.from({ project: Projects }).select(() => throwError("projection failed")),
            ),
          },
          {
            operation: "order",
            effect: Query.once((query) =>
              query.from({ project: Projects }).orderBy(() => throwError("order failed")),
            ),
          },
          {
            operation: "join",
            effect: Query.once((query) =>
              query.from({ project: Projects }).join(
                "card",
                Cards,
                () => throwError("join failed"),
                (card) => card.id,
              ),
            ),
          },
          {
            operation: "aggregate",
            effect: Query.once((query) =>
              query
                .from({ project: Projects })
                .groupBy(({ project }) => ({ status: project.status }), {
                  total: Query.sum(() => throwError("aggregate failed")),
                }),
            ),
          },
        ];

        for (const entry of cases) {
          const failure = yield* Effect.flip(entry.effect);
          expect(failure).toBeInstanceOf(QueryEvaluationError);
          expect(failure).toMatchObject({ operation: entry.operation });
        }
      }),
    ));

  it("represents live query evaluation failures in state without throwing from rows", () => {
    const Projects = rowsSource<Project>({
      name: "Projects.live-query-evaluation-state",
      getKey: (project) => project.id,
      initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
    });
    const live = Query.live((query) =>
      query
        .from({ project: Projects })
        .where(() => {
          throw new Error("filter failed");
        })
        .select(({ project }) => project.name),
    );

    expect(() => live.rows.get()).not.toThrow();
    expect(live.rows.get()).toEqual([]);
    expect(asyncResultFacts(live.state.get())).toMatchObject({
      _tag: "Failure",
      waiting: false,
      error: { _tag: "QueryEvaluationError", operation: "filter" },
      previous: [],
    });
  });

  it("keeps last successful live query data across later evaluation failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = rowsSource<Project>({
          name: "Projects.live-query-evaluation-last-good",
          getKey: (project) => project.id,
          initialData: [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }],
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => {
            if (project.name === "Broken") {
              throw new Error("projection failed");
            }
            return project.name;
          }),
        );

        expect(live.rows.get()).toEqual(["Atlas"]);

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Broken" } },
        ]);

        expect(live.rows.get()).toEqual(["Atlas"]);
        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: { _tag: "QueryEvaluationError", operation: "projection" },
          previous: ["Atlas"],
        });

        yield* Projects.applyChanges([
          { _tag: "Update", key: "atlas", changes: { name: "Atlas Reloaded" } },
        ]);

        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: ["Atlas Reloaded"],
        });
      }),
    ));

  it("keeps live query evaluation and subscriptions local to each runtime's Resource Store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstRuntime = makeRuntime();
        const secondRuntime = makeRuntime();
        const Projects = rowsSource<Project>({
          name: "Projects.live-query-store-local",
          getKey: (project) => project.id,
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        );
        let unsubscribe = (): void => {};

        try {
          Projects.server.rows = [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }];
          yield* firstRuntime.provide(Resource.preload(Projects));
          Projects.server.rows = [{ id: "lumen", name: "Lumen", status: "blocked", progress: 34 }];
          yield* secondRuntime.provide(Resource.preload(Projects));

          unsubscribe = runWithRuntime(firstRuntime, () => live.rows.subscribe(() => {}));
          expect(runWithRuntime(firstRuntime, () => live.rows.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.rows.get())).toEqual(["Lumen"]);

          yield* secondRuntime.provide(
            Projects.applyChanges([
              { _tag: "Update", key: "lumen", changes: { name: "Lumen Prime" } },
            ]),
          );

          expect(runWithRuntime(firstRuntime, () => live.rows.get())).toEqual(["Atlas"]);
          expect(runWithRuntime(secondRuntime, () => live.rows.get())).toEqual(["Lumen Prime"]);
          expect(
            asyncResultFacts(runWithRuntime(firstRuntime, () => live.state.get())),
          ).toMatchObject({ _tag: "Success", value: ["Atlas"] });
        } finally {
          unsubscribe();
          yield* firstRuntime.dispose;
          yield* secondRuntime.dispose;
        }
      }),
    ));

  it("evaluates one-shot queries against the active runtime's Resource Store", async () => {
    const runtime = makeRuntime();
    const Projects = rowsSource<Project>({
      name: "Projects.query-once-runtime",
      getKey: (project) => project.id,
    });
    try {
      Projects.server.rows = [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }];
      const names = await runInRuntime(
        runtime,
        Query.once((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        ),
      );
      expect(names).toEqual(["Atlas"]);
    } finally {
      await Effect.runPromise(runtime.dispose);
    }
  });

  it("folds source failures into live query state with current data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let loads = 0;
        const Projects = rowsSource<Project, string, string>({
          name: "Projects.live-query-source-failure",
          getKey: (project) => project.id,
          load: () =>
            Effect.gen(function* () {
              loads++;
              if (loads > 1) {
                return yield* Effect.fail("offline");
              }
              return [{ id: "atlas", name: "Atlas", status: "active", progress: 72 }] as const;
            }),
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.name),
        );

        expect(asyncResultFacts(live.state.get())).toMatchObject({ _tag: "Initial" });
        yield* live.preload();

        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Success",
          waiting: false,
          value: ["Atlas"],
        });

        const failure = yield* Effect.flip(live.refresh());

        expect(failure).toBe("offline");
        expect(asyncResultFacts(live.state.get())).toMatchObject({
          _tag: "Failure",
          waiting: false,
          error: "offline",
          previous: ["Atlas"],
        });
      }),
    ));

  it("preloads source Resources before materializing rows", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const load = vi.fn(() =>
          Effect.succeed<ReadonlyArray<Project>>([
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
          ]),
        );
        const Projects = rowsSource<Project>({
          name: "Projects.live-query.preload-source",
          getKey: (project) => project.id,
          load,
        });
        const live = Query.live((query) =>
          query.from({ project: Projects }).select(({ project }) => project.id),
        );

        expect(live.rows.get()).toEqual([]);
        yield* live.preload();
        expect(load).toHaveBeenCalledTimes(1);
        expect(live.rows.get()).toEqual(["atlas"]);
      }),
    ));

  it("follows optimistic row patches and rolls them back", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const Projects = rowsSource<Project>({
          name: "Projects.live-query.optimistic",
          getKey: (project) => project.id,
          initialData: [
            { id: "atlas", name: "Atlas", status: "active", progress: 72 },
            { id: "lumen", name: "Lumen", status: "blocked", progress: 34 },
          ],
        });
        const live = Query.live((query) =>
          query
            .from({ project: Projects })
            .where(({ project }) => project.status === "active")
            .select(({ project }) => project.name),
        );
        const gate = yield* Deferred.make<void, string>();
        const Activate = Action.define({
          name: "Projects.live-query.activate",
          optimistic: (id: string, transaction) =>
            transaction.update(Projects, id, { status: "active" }),
          run: (_id: string) => Deferred.await(gate),
        });

        expect(live.rows.get()).toEqual(["Atlas"]);
        const submission = yield* Effect.forkChild(
          Action.use(Activate, { runtime: defaultRuntime }).submit("lumen"),
        );
        yield* Effect.yieldNow;
        expect(live.rows.get()).toEqual(["Atlas", "Lumen"]);

        yield* Deferred.fail(gate, "rejected");
        yield* Fiber.await(submission);
        expect(live.rows.get()).toEqual(["Atlas"]);
      }),
    ));
});
