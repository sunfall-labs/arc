// Internal: the one path for failures Arc throws to a Solid `<Errored>`.
//
// Solid serializes whatever an `<Errored>` boundary catches during a server
// render into the page, for the hydrating client to rethrow into the same
// boundary. So on the server Arc never throws a raw failure: it throws a
// `RenderFailureWire` that carries only what may cross (a Resource failure
// encoded by its family's `error` schema, or its `_tag`), and both the server
// and the hydrating client decode the typed failure from that same wire.
import { ResourceFailure } from "@sunfall/arc-core";
import {
  resourceFailureSnapshot,
  type ResourceFailureSnapshot,
  resourceRenderCauseFromSnapshot,
  resourceRenderError,
} from "@sunfall/arc-core/internal";
import { isServer } from "@solidjs/web";
import { Cause, Effect, Option } from "effect";

const RenderFailureKey = "~@sunfall/arc-solid/RenderFailure";

/** Solid passes a value marked with this symbol to the page as is, in production too. */
const SolidSafeError: unique symbol = Symbol.for("solid.SafeError") as never;

type RenderFailureBody =
  /** A failed Resource read, as its family's `error` schema lets it cross. */
  | { readonly _tag: "Resource"; readonly snapshot: ResourceFailureSnapshot }
  /** Anything else (setup failures, defects): nothing about it crosses. */
  | { readonly _tag: "Opaque" };

/**
 * The value a server render throws to `<Errored>`, and so the value Solid
 * serializes into the page: plain JSON-shaped data with no failure fields
 * beyond what the Resource family's `error` schema encodes.
 */
interface RenderFailureWire {
  readonly [RenderFailureKey]: RenderFailureBody;
  readonly name: "RenderFailure";
  readonly message: string;
}

const isRenderFailureWire = (value: unknown): value is RenderFailureWire =>
  typeof value === "object" && value !== null && RenderFailureKey in value;

const makeWire = (body: RenderFailureBody, message: string): RenderFailureWire => {
  const wire = { [RenderFailureKey]: body, name: "RenderFailure", message } as const;
  Object.defineProperty(wire, SolidSafeError, { value: true, enumerable: false });
  return wire;
};

/** Only called during a server render. */
const toWire = (
  value: unknown,
  cause: Cause.Cause<unknown> = Cause.die(value),
): RenderFailureWire => {
  if (isRenderFailureWire(value)) {
    return value;
  }
  if (value instanceof ResourceFailure) {
    const snapshot = resourceFailureSnapshot(value.ref.family, value.result.cause);
    if (snapshot.failure._tag === "Unencodable") {
      Effect.runSync(
        Effect.logWarning(
          `Resource "${snapshot.resource}" load failure did not encode with the family's error schema`,
        ),
      );
    }
    return makeWire(
      { _tag: "Resource", snapshot },
      `Resource "${snapshot.resource}" failed to load`,
    );
  }
  // Nothing about it reaches the page, so the server log is the only record of
  // what failed: log the original cause here.
  Effect.runSync(Effect.logError("Render failed on the server", cause));
  return makeWire({ _tag: "Opaque" }, "Render failed on the server");
};

/** Typed setup failures (members of a component's `E`), as thrown on the client. */
const typedSetupFailures = new WeakSet<object>();

/**
 * The value to throw to `<Errored>` for `failure`: the failure itself on the
 * client, its `RenderFailureWire` during a server render.
 */
export const renderFailure = (failure: unknown): unknown => (isServer ? toWire(failure) : failure);

/**
 * The value to throw to `<Errored>` for a failed setup (or a binding's failed
 * read): its typed failure, when `cause` has one, is what `catchTags` and
 * `catchAll` handle on the client. A server render sends no setup failure
 * data, so there it is opaque on both sides.
 */
export const setupRenderFailure = (cause: Cause.Cause<unknown>): unknown => {
  const error = Cause.squash(cause);
  if (!isServer && Cause.hasFails(cause) && typeof error === "object" && error !== null) {
    typedSetupFailures.add(error);
  }
  return isServer ? toWire(error, cause) : error;
};

/**
 * The typed failure a value thrown to `<Errored>` carries, if any.
 *
 * A `ResourceFailure` carries its family's render failure (the load error with
 * an `error` schema, `ResourceUntypedFailure` without one); a server-rendered
 * wire decodes to the same value; a typed setup failure is itself. Defects,
 * interruptions, and opaque wires carry none.
 */
export const typedRenderFailure = (thrown: unknown): Option.Option<unknown> => {
  if (isRenderFailureWire(thrown)) {
    const body = thrown[RenderFailureKey];
    return body._tag === "Resource"
      ? Cause.findErrorOption(resourceRenderCauseFromSnapshot(body.snapshot))
      : Option.none();
  }
  if (thrown instanceof ResourceFailure) {
    return resourceRenderError(thrown.ref.family, thrown.result.cause);
  }
  return typeof thrown === "object" && thrown !== null && typedSetupFailures.has(thrown)
    ? Option.some(thrown)
    : Option.none();
};
