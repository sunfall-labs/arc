import { Clock, Data, Effect, type Scope } from "effect";
import { Signal, SignalWrites, type ReadableSignal } from "./signal.js";
import {
  installSignalCommitRecorder,
  isSignalCommitRecorderInstalled,
  refreshRenderedSignals,
  setSignalTravelView,
  writeUntracedSignals,
  type SignalCommitChange,
  type SignalTransactionWritable,
} from "./signal-transaction.js";

/**
 * Commit made by a framework transition: work started by a `Component.callback`
 * (named `<Component>.<name>`), or a `Component.stream` element.
 */
export interface TimelineTransitionCause {
  readonly _tag: "Transition";
  readonly name: string;
}

/** Commit made by an Action submission's visible state. */
export interface TimelineActionCause {
  readonly _tag: "Action";
  readonly action: string;
  /**
   * `submit`/`success`/`failure`/`interrupt`/`reset` come from an Action
   * instance's state. The Action Outbox (durable submissions) adds `queue`
   * (persisted and pending), `restore` (pending submissions restored and
   * re-patched on launch), `replay` (an attempt to send one), `success` and
   * `failure` when one settles, and `dismiss` (a failure acknowledged).
   */
  readonly event:
    | "submit"
    | "success"
    | "failure"
    | "interrupt"
    | "reset"
    | "queue"
    | "restore"
    | "replay"
    | "dismiss";
}

/**
 * Entry made by a running State. Every message it processes makes exactly one
 * entry, `message` (applied, with the model change when it changed the model)
 * or `ignored` (no handler in the current state, the handler returned
 * `State.ignore`, or it came from work of a state since exited), so the
 * entries are the State's message log: `State.history` reads it back and
 * `State.replay` re-applies it.
 */
export interface TimelineStateCause {
  readonly _tag: "State";
  /** The State definition's `name`. */
  readonly state: string;
  /** Which running instance, unique per process: one name can have several instances. */
  readonly instance: number;
  /**
   * `start`: the instance started (no change; `model` is its starting model,
   * initial or hydrated). `restore`: its persisted model was restored.
   * `message`/`ignored`: a message was applied or ignored. `failure`: a
   * failure was recorded. `clearFailures`: they were cleared.
   */
  readonly event: "start" | "restore" | "message" | "ignored" | "failure" | "clearFailures";
  /** The message applied, ignored, or failed, when known. */
  readonly message?: unknown;
  /** The model a `start` or `restore` entry starts from. */
  readonly model?: unknown;
}

/** Commit made by the Resource store for one cached entry. */
export interface TimelineResourceCause {
  readonly _tag: "Resource";
  readonly resource: string;
  readonly key: string;
  /** `change` applies a `rows.changes` batch to the synced rows. */
  readonly event: "load" | "success" | "failure" | "interrupt" | "hydrate" | "reset" | "change";
}

/** Commit made by the browser router kernel while navigating. */
export interface TimelineRouterCause {
  readonly _tag: "Router";
  readonly href: string;
  readonly status: "Pending" | "Ready" | "NotFound" | "Failure";
}

/** Why a committed change set happened. */
export type TimelineCause =
  | TimelineTransitionCause
  | TimelineActionCause
  | TimelineStateCause
  | TimelineResourceCause
  | TimelineRouterCause;

/** One signal's committed change inside a timeline entry. */
export interface TimelineChange {
  readonly signal: ReadableSignal<unknown>;
  /** The signal's `SignalWrites.make` name. */
  readonly name: string;
  readonly previous: unknown;
  readonly next: unknown;
}

/** One committed change set: every signal a solo write, batch, or transaction changed. */
export interface TimelineEntry {
  /** Recording-local sequence, starting at 1. */
  readonly sequence: number;
  /** `Clock` time of the commit, in milliseconds. */
  readonly at: number;
  /** The named transition or framework event that made the commit. */
  readonly cause: TimelineCause;
  readonly changes: ReadonlyArray<TimelineChange>;
}

/** Options for `Timeline.record`. */
export interface TimelineRecordOptions {
  /** Maximum retained entries; older entries are dropped first. Defaults to 1000. */
  readonly limit?: number;
}

/** A running recording returned by `Timeline.record`. */
export interface TimelineRecording {
  /** Retained entries, oldest first. Reactive for Arc and Solid readers. */
  readonly entries: ReadableSignal<ReadonlyArray<TimelineEntry>>;
  /** Sequence of the entry rendered while travelling, or `undefined` at the live head. */
  readonly position: ReadableSignal<number | undefined>;
  /**
   * Renders every recorded signal as it was right after entry `sequence`.
   *
   * Committed state stays live: Effects, Actions, and States keep running
   * against the head and their commits keep being recorded, while Solid shows
   * the travelled values. Signals first written after `sequence` render the
   * value they had then, which for signals created later is their initial value.
   */
  travel(sequence: number): Effect.Effect<void, TimelineEntryUnavailable>;
  /** Renders the live head again. */
  resume(): Effect.Effect<void>;
}

/** `travel` named a sequence that is not retained. */
export class TimelineEntryUnavailable extends Data.TaggedError("TimelineEntryUnavailable")<{
  readonly sequence: number;
}> {}

/** `Timeline.record` ran while another recording was installed. */
export class TimelineAlreadyRecording extends Data.TaggedError("TimelineAlreadyRecording")<{}> {}

const defaultTimelineLimit = 1000;

const resolveLimit = (limit: number | undefined): number =>
  limit !== undefined && Number.isFinite(limit) && limit >= 1
    ? Math.floor(limit)
    : defaultTimelineLimit;

const messageLabel = (message: unknown): string => {
  if (typeof message === "object" && message !== null) {
    const tag = (message as { readonly _tag?: unknown })._tag;
    if (typeof tag === "string") {
      return tag;
    }
  }
  return typeof message === "string" ? message : typeof message;
};

const makeRecording = (clock: Clock.Clock, limit: number) => {
  // Ring buffer: `ring[start]` is the oldest of `ring.length` retained entries.
  const ring: Array<TimelineEntry> = [];
  let start = 0;
  const retained = (): ReadonlyArray<TimelineEntry> =>
    start === 0 ? ring.slice() : [...ring.slice(start), ...ring.slice(0, start)];
  let sequence = 0;
  let view: Map<SignalTransactionWritable, unknown> | undefined;
  const version = SignalWrites.make(0, { name: "Timeline.version" });
  const position = SignalWrites.make<number | undefined>(undefined, { name: "Timeline.position" });
  const own: ReadonlySet<unknown> = new Set<unknown>([version, position]);
  const entries = Signal.derive((): ReadonlyArray<TimelineEntry> => {
    version.get();
    return retained();
  });

  const commit = (
    changes: ReadonlyArray<SignalCommitChange>,
    cause: TimelineCause | undefined,
  ): void => {
    const recorded = changes.filter((change) => !own.has(change.signal));
    // Only a recording's own bookkeeping commits without a cause or changes
    // nothing but its own signals. An empty change set is an event entry (a
    // State message that changed nothing).
    if (cause === undefined || (recorded.length === 0 && changes.length > 0)) {
      return;
    }
    if (view !== undefined) {
      // Freeze signals first written while travelling at their travelled value.
      for (const change of recorded) {
        if (!view.has(change.signal)) {
          view.set(change.signal, change.previous);
        }
      }
    }

    const entry: TimelineEntry = {
      sequence: ++sequence,
      at: clock.currentTimeMillisUnsafe(),
      cause,
      changes: recorded.map((change) => ({
        signal: change.signal as unknown as ReadableSignal<unknown>,
        name: change.signal.timelineName(),
        previous: change.previous,
        next: change.next,
      })),
    };
    if (ring.length < limit) {
      ring.push(entry);
    } else {
      ring[start] = entry;
      start = (start + 1) % limit;
    }
    writeUntracedSignals(() => version.update((value) => value + 1));
  };

  const showView = (next: Map<SignalTransactionWritable, unknown> | undefined): void => {
    view = next;
    setSignalTravelView(next);
    refreshRenderedSignals();
  };

  const travel = (target: number): Effect.Effect<void, TimelineEntryUnavailable> =>
    Effect.suspend(() => {
      const entries = retained();
      if (!entries.some((entry) => entry.sequence === target)) {
        return Effect.fail(new TimelineEntryUnavailable({ sequence: target }));
      }

      // Value after `target`: the last change at or before it, else the value
      // before the first change after it. Signals absent from every retained
      // entry have not changed since, so their live value is already right.
      const next = new Map<SignalTransactionWritable, unknown>();
      for (const entry of entries) {
        for (const change of entry.changes) {
          // Recorded signals are writable signals, which are commit-seam writables.
          const signal = change.signal as unknown as SignalTransactionWritable;
          if (entry.sequence <= target) {
            next.set(signal, change.next);
          } else if (!next.has(signal)) {
            next.set(signal, change.previous);
          }
        }
      }
      return Effect.sync(() => {
        writeUntracedSignals(() => position.set(target));
        showView(next);
      });
    });

  const resume = (): Effect.Effect<void> =>
    Effect.sync(() => {
      if (view === undefined) {
        return;
      }
      writeUntracedSignals(() => position.set(undefined));
      showView(undefined);
    });

  const release = (): void => {
    if (view !== undefined) {
      writeUntracedSignals(() => position.set(undefined));
      showView(undefined);
    }
    ring.length = 0;
    start = 0;
    writeUntracedSignals(() => version.update((value) => value + 1));
  };

  const recording: TimelineRecording = { entries, position, travel, resume };
  return { recording, commit, release };
};

/**
 * Whole-app commit history and replay.
 *
 * Arc owns application state in writable signals, and every committed change
 * passes through one commit seam. A recording observes that seam, so its
 * entries cover State models, Resource entries, Action state, and router
 * state alike.
 */
export namespace Timeline {
  /** Commit made by a framework transition: a named callback or stream element. */
  export type TransitionCause = TimelineTransitionCause;
  /** Commit made by an Action submission. */
  export type ActionCause = TimelineActionCause;
  /** Entry made by a State: its start, a restore, a message applied or ignored, a failure. */
  export type StateCause = TimelineStateCause;
  /** Commit made by a Resource load or invalidation. */
  export type ResourceCause = TimelineResourceCause;
  /** Commit made by router navigation. */
  export type RouterCause = TimelineRouterCause;
  /** Why a Timeline commit happened. */
  export type Cause = TimelineCause;
  /** One recorded state change inside a commit. */
  export type Change = TimelineChange;
  /** One recorded commit. */
  export type Entry = TimelineEntry;
  /** Options for `Timeline.record`. */
  export type RecordOptions = TimelineRecordOptions;
  /** Live recording handle returned by `Timeline.record`. */
  export type Recording = TimelineRecording;

  /**
   * Records every committed change set until the scope closes.
   *
   * Retention is bounded by `limit`. Closing the scope uninstalls the recorder,
   * resumes the live head, and drops retained entries. Only one recording can
   * be installed at a time.
   */
  export const record = (
    options?: TimelineRecordOptions,
  ): Effect.Effect<TimelineRecording, TimelineAlreadyRecording, Scope.Scope> =>
    Effect.flatMap(
      Clock.clockWith((clock) => Effect.succeed(clock)),
      (clock) =>
        Effect.acquireRelease(
          Effect.suspend(() => {
            if (isSignalCommitRecorderInstalled()) {
              return Effect.fail(new TimelineAlreadyRecording());
            }
            const recording = makeRecording(clock, resolveLimit(options?.limit));
            const uninstall = installSignalCommitRecorder({ commit: recording.commit });
            return Effect.succeed({ ...recording, uninstall });
          }),
          ({ release, uninstall }) =>
            Effect.sync(() => {
              uninstall();
              release();
            }),
        ),
    ).pipe(Effect.map(({ recording }) => recording));

  /**
   * Human-readable label for a cause: a transition's name (`ProjectPage.rename`)
   * or a framework event (`State "Board" ClickedRelabel`).
   */
  export const describe = (cause: TimelineCause): string => {
    switch (cause._tag) {
      case "Transition":
        return cause.name;
      case "Action":
        return `Action "${cause.action}" ${cause.event}`;
      case "State":
        return cause.event === "message"
          ? `State "${cause.state}" ${messageLabel(cause.message)}`
          : cause.event === "ignored"
            ? `State "${cause.state}" ${messageLabel(cause.message)} (ignored)`
            : `State "${cause.state}" ${cause.event}`;
      case "Resource":
        return `Resource "${cause.resource}" ${cause.event} ${cause.key}`;
      case "Router":
        return `Router navigate ${cause.href} (${cause.status})`;
    }
  };
}
