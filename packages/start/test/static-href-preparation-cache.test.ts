import { Resource, makeRuntime } from "@sunfall/arc-core";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeStartStaticHrefPreparationCache,
  startStaticHydratedHrefPreparationOutcomeEffect,
} from "../src/static-href-preparation-cache.js";

describe("Start static href preparation cache", () => {
  it("coalesces host-owned href preparation after caller interruption", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = makeRuntime();
          yield* Effect.addFinalizer(() => runtime.disposeEffect);
          const ProjectById = Resource.family({
            name: "Start.Static.Cache.Project.coalesced",
            load: (_id: string) => Effect.fail(new Error("static cache test has no loader")),
          });
          const ref = ProjectById("1");
          const payload = {
            resources: [
              {
                name: ref.family.options.name,
                key: ref.key,
                input: "1",
                state: {
                  _tag: "Success" as const,
                  waiting: false,
                  value: { id: "1", name: "Hydrated project" },
                  updatedAt: Date.now(),
                },
              },
            ],
          };
          const prepareStarted = yield* Deferred.make<void>();
          const releasePrepare = yield* Deferred.make<void>();
          const prepareHrefEffect = vi.fn(() =>
            runtime.provide(
              Effect.gen(function* () {
                yield* Deferred.succeed(prepareStarted, undefined);
                yield* Deferred.await(releasePrepare);
                yield* Resource.hydrateEffect(payload);
                return yield* startStaticHydratedHrefPreparationOutcomeEffect(payload);
              }),
            ),
          );
          const prepareHref = makeStartStaticHrefPreparationCache({
            runtime,
            prepareHrefEffect,
          });

          const first = Effect.runFork(prepareHref("/projects/1"));
          yield* Deferred.await(prepareStarted);
          yield* Fiber.interrupt(first);
          const second = Effect.runPromise(prepareHref("/projects/1"));
          yield* Effect.sleep("10 millis");

          expect(prepareHrefEffect).toHaveBeenCalledTimes(1);

          yield* Deferred.succeed(releasePrepare, undefined);
          yield* Effect.promise(() => second);
          yield* prepareHref("/projects/1");

          expect(prepareHrefEffect).toHaveBeenCalledTimes(1);
        }),
      ),
    ));

  it("revalidates cached href preparation when hydrated Resource refs become stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = makeRuntime();
            yield* Effect.addFinalizer(() => runtime.disposeEffect);
            const ProjectById = Resource.family({
              name: "Start.Static.Cache.Project.stale",
              load: (_id: string) => Effect.fail(new Error("static cache test has no loader")),
              policy: {
                staleFor: 10,
              },
            });
            const ref = ProjectById("1");
            const payload = (): Resource.HydrationPayload => ({
              resources: [
                {
                  name: ref.family.options.name,
                  key: ref.key,
                  input: "1",
                  state: {
                    _tag: "Success",
                    waiting: false,
                    value: { id: "1", name: "Hydrated project" },
                    updatedAt: Date.now(),
                  },
                },
              ],
            });
            const prepareHrefEffect = vi.fn(() =>
              runtime.provide(
                Effect.gen(function* () {
                  const currentPayload = payload();
                  yield* Resource.hydrateEffect(currentPayload);
                  return yield* startStaticHydratedHrefPreparationOutcomeEffect(currentPayload);
                }),
              ),
            );
            const prepareHref = makeStartStaticHrefPreparationCache({
              runtime,
              prepareHrefEffect,
            });

            yield* prepareHref("/projects/1");
            yield* prepareHref("/projects/1");
            expect(prepareHrefEffect).toHaveBeenCalledTimes(1);

            yield* Effect.promise(() => vi.advanceTimersByTimeAsync(11));
            yield* prepareHref("/projects/1");

            expect(prepareHrefEffect).toHaveBeenCalledTimes(2);
          }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
