import { Context, Data, Effect, Exit, Fiber } from "effect";
import type { TimelineCause } from "./timeline.js";

/**
 * A signal was written outside every named transition, so its commit would
 * have no name on the `Timeline`. Raised as a defect at the write.
 */
export class SignalWriteOutsideTransition extends Data.TaggedError("SignalWriteOutsideTransition")<{
  /** The written signal's `Signal.make` name. */
  readonly signal: string;
}> {
  override get message(): string {
    return (
      `Signal "${this.signal}" was written outside a named transition. ` +
      "Every state change needs a name: write it inside a named " +
      '`Component.callback("name", ...)`, an Action, or a Program update, ' +
      "or wrap it in `Signal.batch(f, { name })` / `Signal.transaction(effect, { name })`."
    );
  }
}

/**
 * A staged signal write. Commit applies every write to committed state before
 * any subscriber runs, so observers never see a half-applied transaction.
 */
export interface SignalTransactionWritable {
  /** Committed value, bypassing any open transaction. */
  readCommitted(): unknown;
  /** Replaces the committed value; returns true when `Object.is` sees a change. */
  writeCommitted(value: unknown): boolean;
  /** Notifies subscribers after a committed change. */
  notifyCommitted(): void;
  /** Readable label used by timeline entries; stable for the signal's lifetime. */
  timelineName(): string;
}

/** An open transaction's staged writes. */
export interface SignalTransactionState {
  readonly writes: Map<SignalTransactionWritable, unknown>;
  /** Bumped on every staged write, so derived reads can cache per write set. */
  version: number;
  open: boolean;
  /**
   * Why this transaction commits, reported to an installed commit recorder.
   * Writes into a transaction without one fail with `SignalWriteOutsideTransition`.
   */
  cause: TimelineCause | undefined;
}

/** One committed signal change reported to a commit recorder. */
export interface SignalCommitChange {
  readonly signal: SignalTransactionWritable;
  readonly previous: unknown;
  readonly next: unknown;
}

/**
 * Observer of committed change sets, installed by `Timeline.record`.
 *
 * `commit` runs after committed values are written and before any subscriber
 * runs, so a cascading commit made by a subscriber is reported after the
 * commit that caused it.
 */
export interface SignalCommitRecorder {
  /** `cause` is `undefined` only for framework bookkeeping writes (`writeUntracedSignals`). */
  commit(changes: ReadonlyArray<SignalCommitChange>, cause: TimelineCause | undefined): void;
}

/**
 * Internal Effect service carrying the active transaction. It is never part of
 * a public requirement type: `Signal.transaction` provides and removes it.
 */
class SignalTransaction extends Context.Service<SignalTransaction, SignalTransactionState>()(
  "@sunfall/arc-core/SignalTransaction",
) {}

/**
 * Internal Effect service carrying the named transition a fiber runs in
 * (`Component.callback`). Writes outside a transaction commit under it, and
 * transactions opened without a cause inherit it; forked fibers inherit it too.
 */
class SignalTransition extends Context.Service<SignalTransition, TimelineCause>()(
  "@sunfall/arc-core/SignalTransition",
) {}

let currentBatch: SignalTransactionState | undefined;

/** Depth of `writeUntracedSignals`: framework bookkeeping writes that need no cause. */
let untracedWrites = 0;

/**
 * The named transition the running fiber belongs to, if any: its
 * `withSignalTransition` cause, else the cause of a transaction it outlived
 * (a fiber forked inside a transaction commits its later writes under it).
 */
const currentSignalTransition = (): TimelineCause | undefined => {
  const fiber = Fiber.getCurrent();
  return fiber === undefined
    ? undefined
    : (Context.getOrUndefined(fiber.context, SignalTransition) ??
        Context.getOrUndefined(fiber.context, SignalTransaction)?.cause);
};

const unnamedWrite = (signal: SignalTransactionWritable): never => {
  throw new SignalWriteOutsideTransition({ signal: signal.timelineName() });
};

/**
 * Runs `effect` as a named transition: writes outside a transaction commit
 * under `cause`, and transactions opened without a cause inherit it. Unlike a
 * transaction it stages nothing, so each write (and any Action or Program it
 * starts, which keep their own causes) commits as it happens.
 */
export const withSignalTransition = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  cause: TimelineCause,
): Effect.Effect<A, E, R> => Effect.provideService(effect, SignalTransition, cause);

/**
 * Runs framework bookkeeping writes that are not application state changes
 * and so carry no cause: a recording's own state, or a router outlet's node
 * (derived from recorded router state). Their commits are not recorded. Never
 * for application signals.
 */
export const writeUntracedSignals = <A>(f: () => A): A => {
  untracedWrites++;
  try {
    return f();
  } finally {
    untracedWrites--;
  }
};

/**
 * Open transactions plus active travelled-view evaluations. Zero lets reads and
 * writes skip every lookup, so neither feature costs more than this one check
 * while unused.
 */
let guardedAccess = 0;

/** Increments whenever committed state changes, so caches over it can validate cheaply. */
let commitSequence = 0;

/** The installed commit recorder, if any. */
let installedRecorder: SignalCommitRecorder | undefined;

/**
 * The commit hook: the installed recorder, or `undefined` while none is
 * installed or while it is recording. Every committed write passes through the
 * solo path in `writeSignalTransactionValue` or through `commitSignalWrites`;
 * without a recorder, each pays one `undefined` check.
 */
let recorder: SignalCommitRecorder | undefined;

/** True while a commit recorder is installed. */
export const isSignalCommitRecorderInstalled = (): boolean => installedRecorder !== undefined;

/** Installs the one commit recorder and returns its uninstaller. */
export const installSignalCommitRecorder = (next: SignalCommitRecorder): (() => void) => {
  installedRecorder = next;
  recorder = next;
  return () => {
    if (installedRecorder === next) {
      installedRecorder = undefined;
      recorder = undefined;
    }
  };
};

/**
 * Values shown to rendered reads while a timeline travels. Committed state
 * stays live, so Effects keep computing from the head; only reads evaluated
 * through `readSignalsThroughView` see the travelled values.
 */
let travelView: ReadonlyMap<SignalTransactionWritable, unknown> | undefined;

/** Set only while a rendered value is evaluated against `travelView`. */
let viewReads: ReadonlyMap<SignalTransactionWritable, unknown> | undefined;

/** Replaces the travelled view; `undefined` returns rendered reads to live state. */
export const setSignalTravelView = (
  view: ReadonlyMap<SignalTransactionWritable, unknown> | undefined,
): void => {
  travelView = view;
};

/** The travelled view, when a timeline is travelling. */
export const currentSignalTravelView = ():
  | ReadonlyMap<SignalTransactionWritable, unknown>
  | undefined => travelView;

/** True while `readSignalsThroughView` evaluates; derived signals then skip their caches. */
export const isReadingSignalView = (): boolean => viewReads !== undefined;

/** Evaluates `f` with writable reads answered from `view` wherever it holds a value. */
export const readSignalsThroughView = <A>(
  view: ReadonlyMap<SignalTransactionWritable, unknown>,
  f: () => A,
): A => {
  const previous = viewReads;
  viewReads = view;
  guardedAccess++;
  try {
    return f();
  } finally {
    guardedAccess--;
    viewReads = previous;
  }
};

/**
 * Refreshers for every live Solid projection of a signal. Travel and resume
 * re-evaluate them, because the rendered value changes without a commit.
 */
export const renderedSignalProjections = new Set<() => void>();

/** Re-evaluates every rendered signal value after the travelled view changes. */
export const refreshRenderedSignals = (): void => {
  for (const refresh of Array.from(renderedSignalProjections)) {
    refresh();
  }
};

/** Current committed-state sequence number. */
export const currentSignalCommitSequence = (): number => commitSequence;

/**
 * Resolves the transaction a synchronous read or write belongs to: the active
 * `Signal.batch`, else the transaction in the running fiber's context. Fibers
 * forked inside a transaction inherit it, so concurrent branches commit
 * atomically with it; a fiber still running after commit sees a closed
 * transaction and commits its own writes.
 */
export const currentSignalTransaction = (): SignalTransactionState | undefined => {
  if (guardedAccess === 0) {
    return undefined;
  }
  if (currentBatch?.open) {
    return currentBatch;
  }

  const fiber = Fiber.getCurrent();
  const transaction =
    fiber === undefined ? undefined : Context.getOrUndefined(fiber.context, SignalTransaction);
  return transaction?.open ? transaction : undefined;
};

/** Reads the value visible to the caller: its own staged write, else committed state. */
export const readSignalTransactionValue = (signal: SignalTransactionWritable): unknown => {
  if (guardedAccess === 0) {
    return signal.readCommitted();
  }
  if (viewReads?.has(signal)) {
    return viewReads.get(signal);
  }
  const transaction = currentSignalTransaction();
  return transaction?.writes.has(signal) ? transaction.writes.get(signal) : signal.readCommitted();
};

/**
 * Stages a write in the caller's transaction, or commits it alone under the
 * caller's named transition. A write with no cause to commit under fails with
 * `SignalWriteOutsideTransition`.
 */
export const writeSignalTransactionValue = (
  signal: SignalTransactionWritable,
  value: unknown,
): void => {
  const transaction = currentSignalTransaction();
  if (transaction) {
    if (transaction.cause === undefined && untracedWrites === 0) {
      unnamedWrite(signal);
    }
    transaction.writes.set(signal, value);
    transaction.version++;
    return;
  }

  const cause =
    untracedWrites === 0 ? (currentSignalTransition() ?? unnamedWrite(signal)) : undefined;
  if (recorder !== undefined) {
    commitRecordedSignalWrites(recorder, [[signal, value]], cause);
    return;
  }

  if (signal.writeCommitted(value)) {
    commitSequence++;
    signal.notifyCommitted();
  }
};

const commitRecordedSignalWrites = (
  active: SignalCommitRecorder,
  writes: Iterable<readonly [SignalTransactionWritable, unknown]>,
  cause: TimelineCause | undefined,
): void => {
  const changes: Array<SignalCommitChange> = [];
  for (const [signal, next] of writes) {
    const previous = signal.readCommitted();
    if (signal.writeCommitted(next)) {
      changes.push({ signal, previous, next });
    }
  }
  if (changes.length === 0) {
    return;
  }

  commitSequence++;
  // The recorder's own bookkeeping writes (and whatever reacts to them) are
  // not application commits, so the recorder is suspended while it records.
  recorder = undefined;
  try {
    active.commit(changes, cause);
  } finally {
    recorder = installedRecorder;
  }
  for (const change of changes) {
    change.signal.notifyCommitted();
  }
};

const commitSignalWrites = (
  writes: ReadonlyMap<SignalTransactionWritable, unknown>,
  cause: TimelineCause | undefined,
): void => {
  if (recorder !== undefined) {
    commitRecordedSignalWrites(recorder, writes, cause);
    return;
  }

  const changed: Array<SignalTransactionWritable> = [];
  for (const [signal, value] of writes) {
    if (signal.writeCommitted(value)) {
      changed.push(signal);
    }
  }
  if (changed.length > 0) {
    commitSequence++;
  }

  for (const signal of changed) {
    signal.notifyCommitted();
  }
};

/** Opens a transaction named by `cause`, else by the caller's named transition. */
const openSignalTransaction = (cause: TimelineCause | undefined): SignalTransactionState => {
  const named = cause ?? currentSignalTransition();
  guardedAccess++;
  return { writes: new Map(), version: 0, open: true, cause: named };
};

const closeSignalTransaction = (transaction: SignalTransactionState, commit: boolean): void => {
  transaction.open = false;
  guardedAccess--;
  if (commit) {
    commitSignalWrites(transaction.writes, transaction.cause);
  }
  transaction.writes.clear();
};

/** A nested transaction names the commit only when the outer one has no cause. */
const joinSignalTransaction = (
  transaction: SignalTransactionState,
  cause: TimelineCause | undefined,
): void => {
  if (transaction.cause === undefined && cause !== undefined) {
    transaction.cause = cause;
  }
};

/**
 * Runs synchronous work as one atomic signal transaction committed under
 * `cause` (else the caller's named transition).
 *
 * Reads inside `f` see its own writes; subscribers run once after `f` returns.
 * If `f` throws, nothing is committed. Nested batches and transactions join the
 * outer one.
 */
export const batchSignalWrites = <A>(f: () => A, cause?: TimelineCause): A => {
  const current = currentSignalTransaction();
  if (current) {
    joinSignalTransaction(current, cause);
    return f();
  }

  const transaction = openSignalTransaction(cause);
  currentBatch = transaction;
  let committed = false;
  try {
    const value = f();
    committed = true;
    return value;
  } finally {
    currentBatch = undefined;
    closeSignalTransaction(transaction, committed);
  }
};

/**
 * Runs an Effect as one atomic signal transaction, including fibers it forks,
 * committed under `cause` (else the caller's named transition).
 *
 * Reads see the transaction's own writes. Success commits every write at once;
 * failure or interruption commits nothing. Nested transactions join the outer one.
 */
export const signalTransaction = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  cause?: TimelineCause,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const current = currentSignalTransaction();
    if (current) {
      joinSignalTransaction(current, cause);
      return effect;
    }

    // Acquire and release are uninterruptible, so the open count never leaks.
    return Effect.acquireUseRelease(
      Effect.sync(() => openSignalTransaction(cause)),
      (transaction) => Effect.provideService(effect, SignalTransaction, transaction),
      (transaction, exit) =>
        Effect.sync(() => closeSignalTransaction(transaction, Exit.isSuccess(exit))),
    );
  });
