import { Context, Effect, Exit, Fiber } from "effect";
import type { TimelineCause } from "./timeline.js";

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
  /** Why this transaction commits, reported to an installed commit recorder. */
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
  commit(changes: ReadonlyArray<SignalCommitChange>, cause: TimelineCause | undefined): void;
}

/**
 * Internal Effect service carrying the active transaction. It is never part of
 * a public requirement type: `Signal.transaction` provides and removes it.
 */
class SignalTransaction extends Context.Service<SignalTransaction, SignalTransactionState>()(
  "@sunfall/arc-core/SignalTransaction",
) {}

let currentBatch: SignalTransactionState | undefined;

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

/** Stages a write in the caller's transaction, or commits it alone. */
export const writeSignalTransactionValue = (
  signal: SignalTransactionWritable,
  value: unknown,
): void => {
  const transaction = currentSignalTransaction();
  if (transaction) {
    transaction.writes.set(signal, value);
    transaction.version++;
    return;
  }

  if (recorder !== undefined) {
    commitRecordedSignalWrites(recorder, [[signal, value]], undefined);
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

const openSignalTransaction = (cause: TimelineCause | undefined): SignalTransactionState => {
  guardedAccess++;
  return { writes: new Map(), version: 0, open: true, cause };
};

const closeSignalTransaction = (transaction: SignalTransactionState, commit: boolean): void => {
  transaction.open = false;
  guardedAccess--;
  if (commit) {
    commitSignalWrites(transaction.writes, transaction.cause);
  }
  transaction.writes.clear();
};

/** Options shared by `Signal.transaction` and `Signal.batch`. */
export interface SignalTransactionOptions {
  /**
   * Why the transaction commits, shown on its `Timeline` entry. A nested
   * transaction names the commit only when the outer one has no cause.
   */
  readonly cause?: TimelineCause;
}

const joinSignalTransaction = (
  transaction: SignalTransactionState,
  options: SignalTransactionOptions | undefined,
): void => {
  if (transaction.cause === undefined && options?.cause !== undefined) {
    transaction.cause = options.cause;
  }
};

/**
 * Runs synchronous work as one atomic signal transaction.
 *
 * Reads inside `f` see its own writes; subscribers run once after `f` returns.
 * If `f` throws, nothing is committed. Nested batches and transactions join the
 * outer one.
 */
export const batchSignalWrites = <A>(f: () => A, options?: SignalTransactionOptions): A => {
  const current = currentSignalTransaction();
  if (current) {
    joinSignalTransaction(current, options);
    return f();
  }

  const transaction = openSignalTransaction(options?.cause);
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
 * Runs an Effect as one atomic signal transaction, including fibers it forks.
 *
 * Reads see the transaction's own writes. Success commits every write at once;
 * failure or interruption commits nothing. Nested transactions join the outer one.
 */
export const signalTransaction = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: SignalTransactionOptions,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const current = currentSignalTransaction();
    if (current) {
      joinSignalTransaction(current, options);
      return effect;
    }

    // Acquire and release are uninterruptible, so the open count never leaks.
    return Effect.acquireUseRelease(
      Effect.sync(() => openSignalTransaction(options?.cause)),
      (transaction) => Effect.provideService(effect, SignalTransaction, transaction),
      (transaction, exit) =>
        Effect.sync(() => closeSignalTransaction(transaction, Exit.isSuccess(exit))),
    );
  });
