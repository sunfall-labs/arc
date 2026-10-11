import { Context, Effect, Exit, Fiber } from "effect";

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
}

/** An open transaction's staged writes. */
export interface SignalTransactionState {
  readonly writes: Map<SignalTransactionWritable, unknown>;
  /** Bumped on every staged write, so derived reads can cache per write set. */
  version: number;
  open: boolean;
}

/**
 * Internal Effect service carrying the active transaction. It is never part of
 * a public requirement type: `Signal.transaction` provides and removes it.
 */
class SignalTransaction extends Context.Service<SignalTransaction, SignalTransactionState>()(
  "@sunfall/arc-core/SignalTransaction",
) {}

let currentBatch: SignalTransactionState | undefined;

/** Open transactions anywhere; zero lets reads and writes skip the lookup entirely. */
let openTransactions = 0;

/** Increments whenever committed state changes, so caches over it can validate cheaply. */
let commitSequence = 0;

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
  if (openTransactions === 0) {
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

  if (signal.writeCommitted(value)) {
    commitSequence++;
    signal.notifyCommitted();
  }
};

const commitSignalWrites = (writes: ReadonlyMap<SignalTransactionWritable, unknown>): void => {
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

const openSignalTransaction = (): SignalTransactionState => {
  openTransactions++;
  return { writes: new Map(), version: 0, open: true };
};

const closeSignalTransaction = (transaction: SignalTransactionState, commit: boolean): void => {
  transaction.open = false;
  openTransactions--;
  if (commit) {
    commitSignalWrites(transaction.writes);
  }
  transaction.writes.clear();
};

/**
 * Runs synchronous work as one atomic signal transaction.
 *
 * Reads inside `f` see its own writes; subscribers run once after `f` returns.
 * If `f` throws, nothing is committed. Nested batches and transactions join the
 * outer one.
 */
export const batchSignalWrites = <A>(f: () => A): A => {
  if (currentSignalTransaction()) {
    return f();
  }

  const transaction = openSignalTransaction();
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
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (currentSignalTransaction()) {
      return effect;
    }

    // Acquire and release are uninterruptible, so the open count never leaks.
    return Effect.acquireUseRelease(
      Effect.sync(openSignalTransaction),
      (transaction) => Effect.provideService(effect, SignalTransaction, transaction),
      (transaction, exit) =>
        Effect.sync(() => closeSignalTransaction(transaction, Exit.isSuccess(exit))),
    );
  });
