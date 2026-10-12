import { Signal, type WritableSignal } from "./signal.js";

/** One Action submission's optimistic patch over a signal's base value. */
export interface SignalOptimisticPatch<A> {
  readonly transaction: symbol;
  readonly apply: (value: A) => A;
}

/** A signal's base value plus the optimistic patches layered over it, oldest first. */
export interface SignalOptimisticLayers<A> {
  readonly base: A;
  readonly patches: ReadonlyArray<SignalOptimisticPatch<A>>;
}

/**
 * Optimistic layers of every patched signal. A signal is absent while no
 * submission patches it, so its visible value is its base.
 */
export const signalOptimisticLayers = new WeakMap<
  WritableSignal<any>,
  SignalOptimisticLayers<any>
>();

/** Applies `layers.patches` over `layers.base`; a throwing patch throws. */
export const applySignalOptimisticLayers = <A>(layers: SignalOptimisticLayers<A>): A => {
  let value = layers.base;
  for (const patch of layers.patches) {
    value = patch.apply(value);
  }
  return value;
};

/** The value under every optimistic patch: what the signal's owner last wrote. */
export const readSignalOptimisticBase = <A>(signal: WritableSignal<A>): A => {
  const layers = signalOptimisticLayers.get(signal) as SignalOptimisticLayers<A> | undefined;
  return layers === undefined ? Signal.peek(signal) : layers.base;
};

/**
 * The owner's write: replaces the base and re-applies the in-flight
 * optimistic patches over it, so a State message lands under a pending
 * Action's patch instead of being discarded when that Action settles.
 */
export const writeSignalOptimisticBase = <A>(signal: WritableSignal<A>, base: A): void => {
  const layers = signalOptimisticLayers.get(signal) as SignalOptimisticLayers<A> | undefined;
  if (layers === undefined) {
    signal.set(base);
    return;
  }
  const next: SignalOptimisticLayers<A> = { base, patches: layers.patches };
  signal.set(applySignalOptimisticLayers(next));
  signalOptimisticLayers.set(signal, next);
};
