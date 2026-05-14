export interface Subscribable {
  subscribe(listener: () => void): () => void;
}

export interface SignalDependencyObserver {
  depend(source: Subscribable): void;
}

let currentObserver: SignalDependencyObserver | undefined;

export const trackSignalDependency = (source: Subscribable): void => {
  currentObserver?.depend(source);
};

export const withSignalDependencyObserver = <A>(
  observer: SignalDependencyObserver,
  f: () => A
): A => {
  const previous = currentObserver;
  currentObserver = observer;
  try {
    return f();
  } finally {
    currentObserver = previous;
  }
};

export const withoutSignalDependencyObserver = <A>(f: () => A): A => {
  const previous = currentObserver;
  currentObserver = undefined;
  try {
    return f();
  } finally {
    currentObserver = previous;
  }
};

export interface SignalDependencyTracker {
  run(): void;
  dispose(): void;
}

export const makeSignalDependencyTracker = <A>(
  evaluate: () => A,
  onValue: (value: A) => void
): SignalDependencyTracker => {
  const cleanups = new Set<() => void>();
  const sources = new Set<Subscribable>();
  let disposed = false;
  let running = false;
  let queued = false;

  const clearDependencies = (): void => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.clear();
    sources.clear();
  };

  const run = (): void => {
    if (disposed) {
      return;
    }

    if (running) {
      queued = true;
      return;
    }

    running = true;
    clearDependencies();

    try {
      const value = withSignalDependencyObserver({
        depend: (source) => {
          if (sources.has(source)) {
            return;
          }

          sources.add(source);
          cleanups.add(source.subscribe(run));
        }
      }, evaluate);

      onValue(value);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        run();
      }
    }
  };

  return {
    run,
    dispose: () => {
      disposed = true;
      clearDependencies();
    }
  };
};
