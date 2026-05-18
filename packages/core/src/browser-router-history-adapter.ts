/** Options for router navigation history behavior. */
export interface BrowserNavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  readonly replace?: boolean;
}

/** Minimal browser history host used by the Browser History Adapter. */
export interface BrowserHistoryWindow {
  readonly location: {
    readonly pathname: string;
    readonly search: string;
  };
  readonly history: {
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

/**
 * Host history seam used by framework browser routers.
 *
 * Programmatic `commit(...)` returns the href the router should process. It
 * should not notify listeners; browser `pushState(...)` also does not emit a
 * `popstate` event.
 */
export interface BrowserHistoryAdapter {
  /** Reads the current path plus search string, or `fallback` when unavailable. */
  currentHref(fallback?: string): string;
  /** Subscribes to external history changes such as `popstate`. */
  listen(onChange: (href: string) => void): () => void;
  /** Maps a router-owned href to the browser-visible href used by anchors. */
  createHref?(href: string): string;
  /** Applies a programmatic navigation and returns the href to process. */
  commit(href: string, options?: BrowserNavigateOptions): string;
}

/** In-memory Browser History Adapter useful for tests and non-DOM hosts. */
export interface MemoryBrowserHistoryAdapter extends BrowserHistoryAdapter {
  /** Simulates an external browser navigation and notifies listeners. */
  externalNavigate(href: string): void;
  /** Snapshot of committed entries, including the initial entry. */
  entries(): ReadonlyArray<string>;
}

const browserHistoryWindowHref = (windowLike: BrowserHistoryWindow, fallback = "/"): string => {
  const href = `${windowLike.location.pathname}${windowLike.location.search}`;
  return href.length === 0 ? fallback : href;
};

const defaultBrowserHistoryWindow = (): BrowserHistoryWindow | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as BrowserHistoryWindow);

/** Creates a Browser History Adapter backed by `window.history`. */
export const makeWindowBrowserHistoryAdapter = (
  getWindow: () => BrowserHistoryWindow | undefined = defaultBrowserHistoryWindow,
): BrowserHistoryAdapter => ({
  currentHref: (fallback = "/") => {
    const windowLike = getWindow();
    return windowLike === undefined ? fallback : browserHistoryWindowHref(windowLike, fallback);
  },
  listen: (onChange) => {
    const windowLike = getWindow();
    if (windowLike === undefined) {
      return () => undefined;
    }

    const listener = (): void => {
      onChange(browserHistoryWindowHref(windowLike));
    };
    windowLike.addEventListener("popstate", listener);
    return () => {
      windowLike.removeEventListener("popstate", listener);
    };
  },
  createHref: (href) => href,
  commit: (href, options = {}) => {
    const windowLike = getWindow();
    if (windowLike === undefined) {
      return href;
    }

    const currentHref = browserHistoryWindowHref(windowLike, href);
    if (href === currentHref) {
      return currentHref;
    }

    if (options.replace) {
      windowLike.history.replaceState(null, "", href);
    } else {
      windowLike.history.pushState(null, "", href);
    }

    return browserHistoryWindowHref(windowLike, href);
  },
});

/** Creates an in-memory Browser History Adapter. */
export const makeMemoryBrowserHistoryAdapter = (
  options: { readonly initialHref?: string } = {},
): MemoryBrowserHistoryAdapter => {
  let href = options.initialHref ?? "/";
  const entries = [href];
  const listeners = new Set<(href: string) => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(href);
    }
  };

  return {
    currentHref: () => href,
    listen: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    commit: (nextHref, navigateOptions = {}) => {
      if (nextHref === href) {
        return href;
      }
      href = nextHref;
      if (navigateOptions.replace) {
        entries[entries.length - 1] = href;
      } else {
        entries.push(href);
      }
      return href;
    },
    createHref: (nextHref) => nextHref,
    externalNavigate: (nextHref) => {
      href = nextHref;
      entries.push(href);
      notify();
    },
    entries: () => entries.slice(),
  };
};
