import {
  Resource,
  type ResourceHydrationPayload,
  type ResourceStoreEvent,
} from "@sunfall/arc-core";
import { Effect, Exit, Fiber, PubSub, Scope } from "effect";

export interface StartStaticNavigationHydrationRuntime<RuntimeError = unknown> {
  readonly provide: (effect: Effect.Effect<any, any, any>) => Effect.Effect<any, any, any>;
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, never>,
    options?: Effect.RunOptions,
  ) => Fiber.Fiber<A, E | RuntimeError>;
}

export type StartStaticHrefPreparationOutcome =
  | { readonly _tag: "Hydrated"; readonly refs: ReadonlyArray<Resource.AnyRef> }
  | { readonly _tag: "NoHydrationNeeded" }
  | { readonly _tag: "EnvironmentUnavailable" };

export interface StartStaticHrefPreparationCacheOptions<RuntimeError = unknown, Error = never> {
  readonly runtime: StartStaticNavigationHydrationRuntime<RuntimeError>;
  readonly initialHydratedHrefs?: Iterable<string>;
  readonly prepareHrefEffect: (
    href: string,
  ) => Effect.Effect<StartStaticHrefPreparationOutcome, Error>;
}

type StartStaticPreparedHref = Exclude<
  StartStaticHrefPreparationOutcome,
  { readonly _tag: "EnvironmentUnavailable" }
>;

type StartStaticHrefPreparationFiber<RuntimeError, Error> = Fiber.Fiber<
  StartStaticHrefPreparationOutcome,
  Error | RuntimeError
>;

const startStaticHrefPreparationOutcomeCacheable = (
  outcome: StartStaticHrefPreparationOutcome,
): outcome is StartStaticPreparedHref =>
  outcome._tag === "NoHydrationNeeded" || (outcome._tag === "Hydrated" && outcome.refs.length > 0);

const isResolvedStartStaticHydratedResourceRef = (
  ref: Resource.AnyRef | undefined,
): ref is Resource.AnyRef => ref !== undefined;

export const startStaticHydratedHrefPreparationOutcomeEffect = (
  payload: ResourceHydrationPayload | undefined,
): Effect.Effect<StartStaticHrefPreparationOutcome> =>
  Effect.forEach(payload?.resources ?? [], (snapshot) =>
    Resource.definitionEffect(snapshot.name).pipe(
      Effect.flatMap((family) =>
        family === undefined
          ? Effect.succeed(undefined)
          : Effect.sync(() => {
              const ref = family.ref(snapshot.input);
              return ref.key === snapshot.key ? ref : undefined;
            }),
      ),
    ),
  ).pipe(
    Effect.map((refs) => ({
      _tag: "Hydrated" as const,
      refs: refs.filter(isResolvedStartStaticHydratedResourceRef),
    })),
  );

const startStaticPreparedHrefReusableEffect = (
  prepared: StartStaticPreparedHref,
): Effect.Effect<boolean> => {
  switch (prepared._tag) {
    case "NoHydrationNeeded":
      return Effect.succeed(true);
    case "Hydrated":
      return Effect.forEach(prepared.refs, (ref) =>
        Resource.statusEffect(ref).pipe(
          Effect.map((status) => status.isSuccess && !status.isStale && !status.isGcExpired),
        ),
      ).pipe(Effect.map((statuses) => statuses.every(Boolean)));
  }
};

const startStaticPreparedHrefInvalidatedByResourceEvent = (event: ResourceStoreEvent): boolean =>
  event._tag === "ResourceInvalidated" || event._tag === "ResourceDeleted";

const watchStartStaticPreparedHrefInvalidationsEffect = (
  initialHydratedHrefs: Set<string>,
  preparedHrefs: Map<string, StartStaticPreparedHref>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Resource.subscribeEventsEffect();
    yield* Effect.forever(
      PubSub.take(events).pipe(
        Effect.tap((event) =>
          startStaticPreparedHrefInvalidatedByResourceEvent(event)
            ? Effect.sync(() => {
                initialHydratedHrefs.clear();
                preparedHrefs.clear();
              })
            : Effect.void,
        ),
      ),
    );
  });

export const makeStartStaticHrefPreparationCache = <RuntimeError = unknown, Error = never>(
  options: StartStaticHrefPreparationCacheOptions<RuntimeError, Error>,
): ((href: string) => Effect.Effect<void, Error | RuntimeError>) => {
  const initialHydratedHrefs = new Set(options.initialHydratedHrefs ?? []);
  const preparedHrefs = new Map<string, StartStaticPreparedHref>();
  const inFlightPreparations = new Map<
    string,
    StartStaticHrefPreparationFiber<RuntimeError, Error>
  >();

  void options.runtime.runFork(
    Effect.scoped(
      watchStartStaticPreparedHrefInvalidationsEffect(initialHydratedHrefs, preparedHrefs),
    ),
  );

  const rememberPreparationExit = (
    href: string,
    fiber: StartStaticHrefPreparationFiber<RuntimeError, Error>,
    exit: Exit.Exit<StartStaticHrefPreparationOutcome, Error | RuntimeError>,
  ): void => {
    if (inFlightPreparations.get(href) === fiber) {
      inFlightPreparations.delete(href);
    }
    if (Exit.isSuccess(exit) && startStaticHrefPreparationOutcomeCacheable(exit.value)) {
      preparedHrefs.set(href, exit.value);
    }
  };

  const finishPreparationEffect = (
    href: string,
    fiber: StartStaticHrefPreparationFiber<RuntimeError, Error>,
  ): Effect.Effect<void> =>
    Fiber.await(fiber).pipe(
      Effect.tap((exit) => Effect.sync(() => rememberPreparationExit(href, fiber, exit))),
      Effect.asVoid,
      Effect.catchCause(() => Effect.void),
    );

  const prepareHrefFiber = (href: string): StartStaticHrefPreparationFiber<RuntimeError, Error> => {
    const inFlightPreparation = inFlightPreparations.get(href);
    if (inFlightPreparation) {
      return inFlightPreparation;
    }

    const fiber = options.runtime.runFork(options.prepareHrefEffect(href));
    inFlightPreparations.set(href, fiber);
    void options.runtime.runFork(finishPreparationEffect(href, fiber));
    return fiber;
  };

  return (href) =>
    Effect.gen(function* () {
      if (initialHydratedHrefs.delete(href)) {
        return;
      }

      const prepared = preparedHrefs.get(href);
      if (prepared !== undefined) {
        const reusableEffect = options.runtime.provide(
          startStaticPreparedHrefReusableEffect(prepared),
        ) as Effect.Effect<boolean, RuntimeError>;
        const reusable = yield* reusableEffect;
        if (reusable) {
          return;
        }
        preparedHrefs.delete(href);
      }

      const fiber = yield* Effect.sync(() => prepareHrefFiber(href));
      const exit = yield* Fiber.await(fiber);
      yield* Effect.sync(() => rememberPreparationExit(href, fiber, exit));
      if (Exit.isFailure(exit)) {
        return yield* Effect.failCause(exit.cause);
      }
    });
};
