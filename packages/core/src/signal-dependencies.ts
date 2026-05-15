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
  onValue: (value: A) => void,
  onFailure?: (cause: unknown) => void
): SignalDependencyTracker => {
  let dependencies = new Map<Subscribable, () => void>();
  let disposed = false;
  let running = false;
  let queued = false;

  const clearDependencyMap = (target: Map<Subscribable, () => void>): void => {
    for (const cleanup of target.values()) {
      cleanup();
    }
    target.clear();
  };

  const clearDependencies = (): void => {
    clearDependencyMap(dependencies);
    dependencies = new Map();
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
    const nextDependencies = new Map<Subscribable, () => void>();

    let value: A;
    try {
      value = withSignalDependencyObserver({
        depend: (source) => {
          if (nextDependencies.has(source)) {
            return;
          }

          const existing = dependencies.get(source);
          nextDependencies.set(source, existing ?? source.subscribe(run));
        }
      }, evaluate);
    } catch (cause) {
      try {
        for (const [source, cleanup] of nextDependencies) {
          if (!dependencies.has(source)) {
            cleanup();
          }
        }
        nextDependencies.clear();
        onFailure?.(cause);
      } finally {
        running = false;
        if (queued) {
          queued = false;
          run();
        }
      }
      return;
    }

    for (const [source, cleanup] of dependencies) {
      if (!nextDependencies.has(source)) {
        cleanup();
      }
    }
    dependencies = nextDependencies;

    try {
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
