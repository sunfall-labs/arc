// Probe: a naive Arc Signal on raw @solidjs/signals (rejected; see README).
// Mirrors packages/core/src/signal.ts: get / set / subscribe / derive / peek.
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  untrack,
} from "@solidjs/signals";

export interface ReadableSignal<A> {
  get(): A;
  peek(): A;
  subscribe(listener: () => void): () => void;
}

export interface WritableSignal<A> extends ReadableSignal<A> {
  set(value: A | ((current: A) => A)): void;
}

const subscribe = <A>(read: () => A, listener: () => void): (() => void) =>
  createRoot((dispose) => {
    let first = true;
    createEffect(read, () => {
      if (first) {
        first = false;
        return;
      }
      listener();
    });
    return dispose;
  });

export const make = <A>(initial: A): WritableSignal<A> => {
  const [read, write] = createSignal<A>(
    initial as Exclude<A, Function>,
    { ownedWrite: true } as never,
  );
  return {
    get: read,
    peek: () => untrack(read),
    set: (value) => {
      write(value as never);
    },
    subscribe: (listener) => subscribe(read, listener),
  };
};

export const derive = <A>(compute: () => A): ReadableSignal<A> => {
  const read = createRoot(() => createMemo(compute));
  return {
    get: read,
    peek: () => untrack(read),
    subscribe: (listener) => subscribe(read, listener),
  };
};

export { flush };
