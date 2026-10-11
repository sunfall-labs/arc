// Internal Solid Resource bindings shared by the public hooks and Components.
// Every binding takes its runtime explicitly: hooks pass the nearest
// `RuntimeProvider` runtime, Components pass the runtime their setup ran in.
import {
  Resource,
  ResourcePending,
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  resourceUiPreloadFailureFor,
  resourceUiRefAccessor,
  resourceUiSameRef,
  runWithRuntime,
  Signal,
  type AnySunfallArcRuntime,
  type ResourceRef,
  type ResourceUiBindingController,
  type ResourceUiInput,
  type ResourceUiPreloadFailure,
} from "@sunfall/arc-core";
import { Cause, Effect, Fiber } from "effect";
import type { AsyncResult } from "effect/reactivity";
import { createMemo, createRenderEffect, onCleanup, type Accessor } from "solid-js";
import type { UseResourceOptions } from "./hooks.js";
import { createRuntimeScope } from "./runtime-scope.js";

/** Internal: a Resource ref bound to Solid reactivity under the current owner. */
export interface ResourceBinding<I, A, E, R, ER> {
  readonly result: Accessor<AsyncResult.AsyncResult<A, Resource.LoadError<E>>>;
  readonly preloadFailure: Accessor<Resource.LoadError<E> | ER | undefined>;
  readonly controller: ResourceUiBindingController<I, A, E, R, ER>;
}

/** Internal: binds a Resource ref (or ref accessor) to Solid reactivity under the current owner. */
export const createResourceBinding = <I, A, E, R = unknown, ER = never>(
  runtime: AnySunfallArcRuntime<ER>,
  ref: ResourceUiInput<I, A, E, R>,
  options: UseResourceOptions<E, ER> = {},
): ResourceBinding<I, A, E, R, ER> => {
  const getRef = resourceUiRefAccessor(ref);
  // Adapter state lives in an Arc signal: Solid tracks it natively on the
  // client, and writes stay plain committed values during server rendering.
  const preloadFailure = Signal.make<ResourceUiPreloadFailure<I, A, E, R, ER> | undefined>(
    undefined,
  );
  const controller = makeResourceUiBindingController<I, A, E, R, ER>({
    runtime,
    onPreloadFailureChange: (failure) => {
      preloadFailure.set(() => failure);
    },
  });
  const currentRef = createMemo<ResourceRef<I, A, E, R>>(() => getRef(), {
    equals: (previous, next) => resourceUiSameRef(previous, next),
  });

  // Binding a ref and starting its preload are side effects, so they run in the
  // effect's apply phase, never inside a read. The compute phase tracks the ref
  // and the (possibly reactive) preload option.
  createRenderEffect(
    () => ({ ref: currentRef(), preload: options.preload }),
    ({ ref: nextRef, preload }) => {
      if (preload === false) {
        controller.bindRef(nextRef);
        controller.interruptPreload();
        return;
      }

      controller.startInitialPreload(nextRef, {
        ...(preload === undefined ? {} : { preload }),
        onPreloadFailure: (error) => options.onPreloadFailure?.(error),
      });
    },
  );

  onCleanup(() => {
    controller.dispose();
  });

  return {
    result: () => controller.result(currentRef()).get(),
    preloadFailure: () => resourceUiPreloadFailureFor(preloadFailure.get(), currentRef()),
    controller,
  };
};

type SuspenseOutcome<A> =
  | { readonly _tag: "Value"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: unknown };

/** Host token Solid awaits: the single Effect-to-Promise conversion for suspense reads. */
const suspenseOutcomeToken = <A>(outcome: Effect.Effect<SuspenseOutcome<A>>) =>
  Effect.runPromise(outcome);

type SuspenseOutcomeToken<A> = ReturnType<typeof suspenseOutcomeToken<A>>;

/**
 * Internal: fiber-backed async memo over a Resource ref, under the current owner.
 *
 * Cached values return synchronously; pending reads suspend the nearest Solid
 * `<Loading>`; failed loads throw `ResourceFailure` to the nearest `<Errored>`.
 */
export const createResourceSuspense = <I, A, E, R = unknown, ER = unknown>(
  runtime: AnySunfallArcRuntime<ER>,
  ref: ResourceUiInput<I, A, E, R>,
): Accessor<A> => {
  const getRef = resourceUiRefAccessor(ref);
  const result = createResourceBinding(runtime, getRef).result;
  return createRuntimeScope(runtime, (scope) => {
    const preloadController = makeResourceUiSuspensePreloadController<
      I,
      A,
      E,
      R,
      ER,
      SuspenseOutcomeToken<A>
    >(runtime);
    scope.addFinalizer(() => {
      preloadController.dispose();
    });

    const readOutcome = (ref: ResourceRef<I, A, E, R>): SuspenseOutcome<A> | undefined => {
      try {
        return { _tag: "Value", value: runWithRuntime(runtime, () => Resource.read(ref)) };
      } catch (error) {
        return error instanceof ResourcePending ? undefined : { _tag: "Failure", error };
      }
    };

    // Settles a preload into a typed outcome inside Effect, so failures reach
    // callers as `ResourceFailure` rather than Solid's internal error wrapper.
    const settleOutcome = (
      fiber: Fiber.Fiber<A, unknown>,
      ref: ResourceRef<I, A, E, R>,
    ): Effect.Effect<SuspenseOutcome<A>> =>
      Fiber.join(fiber).pipe(
        Effect.map((value): SuspenseOutcome<A> => ({ _tag: "Value", value })),
        Effect.catchCause((cause) =>
          Effect.sync(
            (): SuspenseOutcome<A> =>
              readOutcome(ref) ?? { _tag: "Failure", error: Cause.squash(cause) },
          ),
        ),
      );

    const outcome = createMemo<SuspenseOutcome<A>>(() => {
      const currentRef = getRef();
      preloadController.interruptStale(currentRef);
      result();

      return (
        readOutcome(currentRef) ??
        preloadController.hostToken(currentRef, {
          fork: (effect) => scope.fork(runtime.provide(effect)),
          toHostToken: (fiber) => suspenseOutcomeToken(settleOutcome(fiber, currentRef)),
        })
      );
    });

    return () => {
      const current = outcome();
      if (current._tag === "Failure") {
        throw current.error;
      }
      return current.value;
    };
  });
};
