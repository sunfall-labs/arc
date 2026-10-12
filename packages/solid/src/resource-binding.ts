// Internal Solid Resource bindings behind `Component.resource(...)`. Every
// binding takes its runtime explicitly: the runtime (and setup context) of the
// Component instance that bound it.
import {
  Resource,
  ResourceFailure,
  ResourcePending,
  type AnySunfallArcRuntime,
} from "@sunfall/arc-core";
import {
  makeResourceUiBindingController,
  makeResourceUiSuspensePreloadController,
  resourceUiRefAccessor,
  resourceUiSameRef,
  type ResourceUiInput,
} from "@sunfall/arc-core/internal";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createMemo, createRenderEffect, onCleanup, untrack, type Accessor } from "solid-js";
import { renderFailure } from "./render-failure.js";
import { createRuntimeScope } from "./runtime-scope.js";
import { projectView, type ViewKey } from "./view-projection.js";

/** Internal: binds a Resource ref (or ref accessor) to Solid reactivity under the current owner. */
const createResourceResult = <I, A, E, R = unknown, ER = never>(
  runtime: AnySunfallArcRuntime<ER>,
  ref: ResourceUiInput<I, A, E, R>,
): Accessor<AsyncResult.AsyncResult<A, E>> => {
  const getRef = resourceUiRefAccessor(ref);
  const controller = makeResourceUiBindingController<I, A, E, R, ER>({ runtime });
  const currentRef = createMemo<Resource.Ref<I, A, E, R>>(() => getRef(), {
    equals: (previous, next) => resourceUiSameRef(previous, next),
  });

  // Binding a ref and starting its preload are side effects, so they run in the
  // effect's apply phase, never inside a read.
  createRenderEffect(currentRef, (nextRef) => {
    controller.startInitialPreload(nextRef);
  });

  onCleanup(() => {
    void Effect.runFork(controller.dispose());
  });

  return () => controller.result(currentRef()).get();
};

/** Internal: a suspending Resource read plus its value-free `AsyncResult`. */
export interface ResourceSuspense<A, E> {
  /**
   * The value as a fine-grained view: a binding to one field re-runs only
   * when that field changes, and unchanged objects keep their identity.
   */
  readonly read: Accessor<A>;
  /** The stored value itself; any change to it re-runs the reader. */
  readonly raw: Accessor<A>;
  readonly result: Accessor<AsyncResult.AsyncResult<A, E>>;
}

/** The read's settled kind; a value-free stand-in, so a new value does not re-notify it. */
const valueStatus = { _tag: "Value" } as const;

/**
 * Identity the value view reconciles plain objects by: the family's row key
 * where it declares `rows` (an object it does not key is matched by
 * position), else `"id"`.
 */
const resourceViewKey = (family: Resource.AnyFamily): ViewKey => {
  const rows = family.options.rows;
  if (rows === undefined) {
    return "id";
  }
  return (item) => {
    try {
      const key: unknown = rows.key(item);
      return typeof key === "string" || typeof key === "number" ? key : undefined;
    } catch {
      return undefined;
    }
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
 * `<Loading>`; a failed first load throws `ResourceFailure` (during a server
 * render, its safe wire form; see `render-failure.ts`) to the nearest
 * `<Errored>`, while a failed refresh keeps returning the stale value.
 */
export const createResourceSuspense = <I, A, E, R = unknown, ER = unknown>(
  runtime: AnySunfallArcRuntime<ER>,
  ref: ResourceUiInput<I, A, E, R>,
): ResourceSuspense<A, E> => {
  const getRef = resourceUiRefAccessor(ref);
  const result = createResourceResult(runtime, getRef);
  return createRuntimeScope(runtime, (scope) => {
    const preloadController = makeResourceUiSuspensePreloadController<
      I,
      A,
      E,
      R,
      ER,
      SuspenseOutcomeToken<A>
    >(runtime);
    scope.addFinalizer(() => preloadController.dispose());

    const readOutcome = (ref: Resource.Ref<I, A, E, R>): SuspenseOutcome<A> | undefined => {
      const exit = runtime.runSync(Effect.exit(Resource.read(ref)));
      if (Exit.isSuccess(exit)) {
        return { _tag: "Value", value: exit.value };
      }
      const error = Cause.squash(exit.cause);
      if (error instanceof ResourcePending) {
        return undefined;
      }
      // A failed refresh keeps serving the last value: content stays mounted
      // and status chrome reads the failure. Only a first load throws.
      const stale = error instanceof ResourceFailure ? AsyncResult.value(error.result) : undefined;
      return stale !== undefined && Option.isSome(stale)
        ? { _tag: "Value", value: stale.value as A }
        : { _tag: "Failure", error };
    };

    // Settles a preload into a typed outcome inside Effect, so failures reach
    // callers as `ResourceFailure` rather than Solid's internal error wrapper.
    const settleOutcome = (
      fiber: Fiber.Fiber<A, unknown>,
      ref: Resource.Ref<I, A, E, R>,
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

    // Whether the read throws: it re-notifies on a tag or error change, never
    // on a new value, so the value reaches readers only through the view.
    const status = createMemo(() => {
      const current = outcome();
      return current._tag === "Failure" ? current : valueStatus;
    });
    const view = projectView(
      () => {
        const current = outcome();
        return current._tag === "Value" ? { value: current.value } : undefined;
      },
      resourceViewKey(untrack(getRef).family as Resource.AnyFamily),
    );

    return {
      read: () => {
        const current = status();
        if (current._tag === "Failure") {
          throw renderFailure(current.error);
        }
        return view();
      },
      raw: () => {
        const current = outcome();
        if (current._tag === "Failure") {
          throw renderFailure(current.error);
        }
        return current.value;
      },
      result,
    };
  });
};
