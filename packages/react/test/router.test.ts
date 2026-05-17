import { forkScoped, makeMemoryBrowserHistoryAdapter, makeRuntime, onDispose, Resource, route, runWithRuntime, UiScopeDisposed, type BrowserRouterState } from "@effect-ui/core";
import { Cause, Deferred, Effect } from "effect";
import { Window } from "happy-dom";
import { act, Component, createElement, Fragment, StrictMode, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RuntimeProvider,
  useRouter,
  type BrowserRouter
} from "../src/index.js";
import { renderReactRouteState } from "../src/route-render-scope.js";

const installDom = (url = "http://effect-ui.test/"): (() => void) => {
  const window = new Window({ url });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "MouseEvent",
    "IS_REACT_ACT_ENVIRONMENT"
  ] as const;
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const setGlobal = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value
    });
  };

  setGlobal("window", window);
  setGlobal("document", window.document);
  setGlobal("navigator", window.navigator);
  setGlobal("HTMLElement", window.HTMLElement);
  setGlobal("Node", window.Node);
  setGlobal("MouseEvent", window.MouseEvent);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key);
      } else {
        Object.defineProperty(globalThis, key, descriptor);
      }
    }
    window.close();
  };
};

const withReactRoot = async (
  f: (root: Root, container: HTMLElement) => Promise<void> | void,
  url?: string
): Promise<void> => {
  const cleanupDom = installDom(url);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await f(root, container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    cleanupDom();
  }
};

const flushReact = async (): Promise<void> => {
  await act(async () => {
    await Effect.runPromise(Effect.sleep(0));
  });
};

class TestErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: unknown) => void },
  { readonly error: unknown | undefined }
> {
  override state: { readonly error: unknown | undefined } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { readonly error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.error === undefined
      ? this.props.children
      : createElement("span", {}, "caught");
  }
}

describe("react router", () => {
  it("renders the matched route component after preload", async () => {
    const Home = route("/", {
      component: () => createElement("h1", {}, "Home")
    });
    const routes = [Home] as const;

    await withReactRoot(async (root, container) => {
      await act(async () => {
        root.render(createElement(RouterProvider, { routes, initialHref: "/" }));
      });
      await flushReact();

      expect(container.textContent).toBe("Home");
    });
  });

  it("starts matched routes ready while React hydrates existing DOM", async () => {
    const cleanupDom = installDom("http://effect-ui.test/hydrating-projects/atlas");
    const runtime = makeRuntime();
    const release = await Effect.runPromise(Deferred.make<void>());
    const Project = route("/hydrating-projects/:id", {
      preload: () => Deferred.await(release),
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const routes = [Project] as const;
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement("h1", {}, "Project atlas"));
    document.body.appendChild(container);
    let root: Root | undefined;
    const errors: string[] = [];
    const previousError = console.error;
    console.error = (...args: ReadonlyArray<unknown>) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          createElement(
            RuntimeProvider,
            { runtime },
            createElement(RouterProvider, {
              routes,
              initialHref: "/hydrating-projects/atlas",
              runtime,
              hydrating: true,
              pending: () => createElement("h1", {}, "Pending")
            })
          )
        );
        await Effect.runPromise(Effect.sleep(0));
      });

      expect(container.textContent).toBe("Project atlas");
      expect(errors.filter((message) =>
        message.includes("Hydration failed") ||
        message.includes("did not match")
      )).toEqual([]);

      await act(async () => {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        await Effect.runPromise(Effect.sleep(0));
      });
      expect(container.textContent).toBe("Project atlas");
    } finally {
      console.error = previousError;
      if (root) {
        await act(async () => {
          root?.unmount();
        });
      }
      await Effect.runPromise(runtime.disposeEffect);
      cleanupDom();
    }
  });

  it("navigates by href and updates RouterOutlet", async () => {
    let router: BrowserRouter<typeof routes> | undefined;
    const Home = route("/", {
      component: () => createElement("h1", {}, "Home")
    });
    const Project = route("/projects/:id", {
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const routes = [Home, Project] as const;

    function CaptureRouter() {
      router = useRouter<typeof routes>();
      return null;
    }

    await withReactRoot(async (root, container) => {
      await act(async () => {
        root.render(
          createElement(
            RouterProvider,
            { routes, initialHref: "/" },
            createElement(Fragment, {}, createElement(CaptureRouter), createElement(RouterOutlet))
          )
        );
      });
      await flushReact();
      expect(container.textContent).toBe("Home");

      await act(async () => {
        router!.navigateHref("/projects/atlas");
      });
      await flushReact();

      expect(container.textContent).toBe("Project atlas");
    });
  });

  it("forwards RouterProvider history adapters to navigation", async () => {
    let router: BrowserRouter<typeof routes> | undefined;
    const history = makeMemoryBrowserHistoryAdapter({ initialHref: "/" });
    const Home = route("/", {
      component: () => createElement("h1", {}, "Home")
    });
    const Project = route("/provider-history/:id", {
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const routes = [Home, Project] as const;

    function CaptureRouter() {
      router = useRouter<typeof routes>();
      return null;
    }

    await withReactRoot(async (root, container) => {
      await act(async () => {
        root.render(
          createElement(
            RouterProvider,
            { routes, history },
            createElement(Fragment, {}, createElement(CaptureRouter), createElement(RouterOutlet))
          )
        );
      });
      await flushReact();
      expect(container.textContent).toBe("Home");

      await act(async () => {
        router!.navigateHref("/provider-history/atlas");
      });
      await flushReact();

      expect(container.textContent).toBe("Project atlas");
      expect(history.entries()).toEqual(["/", "/provider-history/atlas"]);
      expect(window.location.pathname).toBe("/");
    });
  });

  it("preloads and navigates through RouterLink plain clicks", async () => {
    let preloads = 0;
    const Project = route("/projects/:id", {
      preload: () =>
        Effect.sync(() => {
          preloads++;
        }),
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const Home = route("/", {
      component: () => createElement(RouterLink, { route: Project, options: { params: { id: "atlas" } } }, "Project")
    });
    const routes = [Home, Project] as const;

    await withReactRoot(async (root, container) => {
      await act(async () => {
        root.render(createElement(RouterProvider, { routes, initialHref: "/" }));
      });
      await flushReact();

      const anchor = container.querySelector("a")!;
      expect(anchor.getAttribute("href")).toBe("/projects/atlas");

      await act(async () => {
        anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      await flushReact();
      expect(preloads).toBe(1);

      await act(async () => {
        anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      });
      await flushReact();

      expect(container.textContent).toBe("Project atlas");
    });
  });

  it("interrupts stale RouterLink hover preloads when the target changes", async () => {
    const runtime = makeRuntime();
    const started: string[] = [];
    const finalized: string[] = [];
    const Project = route("/hover-target-projects/:id", {
      preload: ({ params }) =>
        Effect.sync(() => {
          started.push((params as { id: string }).id);
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => {
            finalized.push((params as { id: string }).id);
          }))
        ),
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const routes = [Project] as const;

    try {
      await withReactRoot(async (root, container) => {
        let setProjectId: ((id: string) => void) | undefined;
        function App() {
          const [projectId, setProjectIdState] = useState("atlas");
          setProjectId = setProjectIdState;
          return createElement(
            RouterProvider,
            { routes, initialHref: "/missing", runtime },
            createElement(RouterLink, {
              route: Project,
              options: { params: { id: projectId } },
              children: projectId
            })
          );
        }

        await act(async () => {
          root.render(createElement(App));
        });
        await flushReact();

        const anchor = () => container.querySelector("a")!;
        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["atlas"]);

        await act(async () => {
          setProjectId?.("curie");
        });
        await flushReact();
        expect(anchor().getAttribute("href")).toBe("/hover-target-projects/curie");
        await vi.waitFor(() => expect(finalized).toEqual(["atlas"]));

        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["atlas", "curie"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("interrupts stale RouterLink hover preloads when preload becomes disabled", async () => {
    const runtime = makeRuntime();
    const started: string[] = [];
    const finalized: string[] = [];
    const Project = route("/hover-disabled-projects/:id", {
      preload: ({ params }) =>
        Effect.sync(() => {
          started.push((params as { id: string }).id);
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => {
            finalized.push((params as { id: string }).id);
          }))
        )
    });
    const routes = [Project] as const;

    try {
      await withReactRoot(async (root, container) => {
        let disablePreload: (() => void) | undefined;
        function App() {
          const [preload, setPreload] = useState(true);
          disablePreload = () => setPreload(false);
          return createElement(
            RouterProvider,
            { routes, initialHref: "/missing", runtime },
            createElement(RouterLink, {
              route: Project,
              options: { params: { id: "atlas" } },
              preload,
              children: "Atlas"
            })
          );
        }

        await act(async () => {
          root.render(createElement(App));
        });
        await flushReact();

        const anchor = () => container.querySelector("a")!;
        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["atlas"]);

        await act(async () => {
          disablePreload?.();
        });
        await flushReact();
        await vi.waitFor(() => expect(finalized).toEqual(["atlas"]));

        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["atlas"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("interrupts RouterLink hover preloads when the router instance is replaced", async () => {
    const runtime = makeRuntime();
    const started: string[] = [];
    const finalized: string[] = [];
    const OldProject = route("/hover-router-replace/:id", {
      preload: () =>
        Effect.sync(() => {
          started.push("old");
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => {
            finalized.push("old");
          }))
        )
    });
    const NewProject = route("/hover-router-replace/:id", {
      preload: () =>
        Effect.sync(() => {
          started.push("new");
        }).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => {
            finalized.push("new");
          }))
        )
    });

    try {
      await withReactRoot(async (root, container) => {
        let replaceRoute: (() => void) | undefined;
        function App() {
          const [projectRoute, setProjectRoute] = useState<typeof OldProject | typeof NewProject>(OldProject);
          replaceRoute = () => setProjectRoute(NewProject);
          return createElement(
            RouterProvider,
            {
              routes: [projectRoute] as readonly [typeof OldProject | typeof NewProject],
              initialHref: "/missing",
              runtime
            },
            createElement(RouterLink, {
              route: projectRoute,
              options: { params: { id: "atlas" } },
              children: "Atlas"
            })
          );
        }

        await act(async () => {
          root.render(createElement(App));
        });
        await flushReact();

        const anchor = () => container.querySelector("a")!;
        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["old"]);

        await act(async () => {
          replaceRoute?.();
        });
        await flushReact();
        expect(anchor().getAttribute("href")).toBe("/hover-router-replace/atlas");
        await vi.waitFor(() => expect(finalized).toEqual(["old"]));

        await act(async () => {
          anchor().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        });
        await flushReact();
        expect(started).toEqual(["old", "new"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("preloads shadowed hrefs with the same route match as navigation", async () => {
    const preloaded: string[] = [];
    let router: BrowserRouter<typeof routes> | undefined;
    const Project = route("/projects/:id", {
      preload: ({ params }) =>
        Effect.sync(() => {
          preloaded.push(`project:${params.id}`);
        }),
      component: ({ params }) => createElement("h1", {}, `Project ${(params as { id: string }).id}`)
    });
    const ProjectSettings = route("/projects/settings", {
      preload: () =>
        Effect.sync(() => {
          preloaded.push("settings");
        }),
      component: () => createElement("h1", {}, "Settings")
    });
    const routes = [Project, ProjectSettings] as const;

    function CaptureRouter() {
      router = useRouter<typeof routes>();
      return null;
    }

    await withReactRoot(async (root, container) => {
      await act(async () => {
        root.render(
          createElement(
            RouterProvider,
            { routes, initialHref: "/projects/settings" },
            createElement(Fragment, {}, createElement(CaptureRouter), createElement(RouterOutlet))
          )
        );
      });
      await flushReact();

      expect(container.textContent).toBe("Settings");
      preloaded.length = 0;
      await Effect.runPromise(router!.preloadEffect(Project, { params: { id: "settings" } }));

      expect(preloaded).toEqual(["settings"]);
    });
  });

  it("keeps route scopes separate when the React router runtime changes", async () => {
    const runtimeA = makeRuntime();
    const runtimeB = makeRuntime();
    const disposed: string[] = [];
    let label = "A";
    let switchRuntime: (() => void) | undefined;
    const Home = route("/", {
      component: () => {
        const renderedLabel = label;
        onDispose(() => Effect.sync(() => {
          disposed.push(renderedLabel);
        }));
        return createElement("h1", {}, renderedLabel);
      }
    });
    const routes = [Home] as const;

    try {
      await withReactRoot(async (root, container) => {
        function App() {
          const [runtime, setRuntime] = useState(runtimeA);
          switchRuntime = () => {
            label = "B";
            setRuntime(runtimeB);
          };
          return createElement(RouterProvider, { routes, runtime, initialHref: "/" });
        }

        await act(async () => {
          root.render(createElement(App));
        });
        await flushReact();
        expect(container.textContent).toBe("A");

        await act(async () => {
          switchRuntime?.();
        });
        await flushReact();

        expect(container.textContent).toBe("B");
        expect(disposed).toContain("A");
        expect(disposed).not.toContain("B");
      });

      expect(disposed).toContain("B");
    } finally {
      await Effect.runPromise(runtimeA.disposeEffect);
      await Effect.runPromise(runtimeB.disposeEffect);
    }
  });

  it("keeps committed route scopes alive across React StrictMode effect replay", async () => {
    const runtime = makeRuntime();
    const disposed: string[] = [];
    const Home = route("/", {
      component: () => {
        onDispose(() => Effect.sync(() => {
          disposed.push("home");
        }));
        return createElement("h1", {}, "Home");
      }
    });
    const routes = [Home] as const;

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(
            createElement(
              StrictMode,
              {},
              createElement(RouterProvider, {
                routes,
                initialHref: "/",
                runtime
              })
            )
          );
        });
        await flushReact();
        await Effect.runPromise(Effect.sleep("20 millis"));

        expect(container.textContent).toBe("Home");
        expect(disposed).toEqual([]);
      });

      await Effect.runPromise(Effect.sleep("20 millis"));
      expect(disposed).toEqual(["home"]);
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("drops uncommitted route scope finalizers when route render throws before commit", async () => {
    const runtime = makeRuntime();
    const renderError = new Error("route render failed");
    const disposed: string[] = [];
    let caught: unknown;
    const Broken = route("/", {
      component: () => {
        onDispose(() => Effect.sync(() => {
          disposed.push("route");
        }));
        throw renderError;
      }
    });
    const routes = [Broken] as const;

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(
            createElement(
              TestErrorBoundary,
              {
                onError: (error) => {
                  caught = error;
                }
              },
              createElement(RouterProvider, {
                routes,
                initialHref: "/",
                runtime
              })
            )
          );
        });
        await flushReact();
        await Effect.runPromise(Effect.sleep("20 millis"));

        expect(container.textContent).toBe("caught");
        expect(caught).toBe(renderError);
        expect(disposed).toEqual([]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rejects route render scoped forks before React commit", async () => {
    const runtime = makeRuntime();
    let caught: unknown;
    const Forking = route("/", {
      component: () => {
        forkScoped(Effect.never);
        return createElement("h1", {}, "unreachable");
      }
    });
    const routes = [Forking] as const;

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(
            createElement(
              TestErrorBoundary,
              {
                onError: (error) => {
                  caught = error;
                }
              },
              createElement(RouterProvider, {
                routes,
                initialHref: "/",
                runtime
              })
            )
          );
        });
        await flushReact();

        expect(container.textContent).toBe("caught");
        expect(caught).toBeInstanceOf(UiScopeDisposed);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("renders pending fallbacks inside the router runtime and route scope", async () => {
    const runtime = makeRuntime();
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "ReactRouter.pending-runtime-resource",
      load: (id) => Effect.succeed({ id })
    });
    const ref = ProjectById("atlas");
    await Effect.runPromise(runtime.provide(Resource.prefetchEffect(ref)));

    const Project = route("/pending-runtime/:id", {
      preload: () => Effect.never,
      component: () => createElement("h1", {}, "Project")
    });
    const routes = [Project] as const;

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(
            createElement(RouterProvider, {
              routes,
              initialHref: "/pending-runtime/atlas",
              runtime,
              pending: () => {
                onDispose(() => Resource.deleteEffect(ref));
                return Resource.status(ref)._tag;
              }
            })
          );
        });
        await flushReact();

        expect(container.textContent).toBe("Success");
      });

      await Effect.runPromise(Effect.sleep("20 millis"));
      expect(runWithRuntime(runtime, () => Resource.status(ref)._tag)).toBe("Initial");
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rerenders pending outlet renderers without navigation", async () => {
    const runtime = makeRuntime();
    const Project = route("/renderer-pending/:id", {
      component: () => createElement("span", {}, "Project")
    });
    const match = Project.match("/renderer-pending/atlas");
    if (!match) {
      expect.fail("Expected route to match.");
    }
    const state: Extract<BrowserRouterState<readonly [typeof Project]>, { readonly _tag: "Pending" }> = {
      _tag: "Pending",
      href: "/renderer-pending/atlas",
      match
    };
    const disposed: Array<string> = [];
    const first = () => {
      onDispose(() => Effect.sync(() => {
        disposed.push("first");
      }));
      return createElement("span", {}, "pending-one");
    };
    const second = () => {
      onDispose(() => Effect.sync(() => {
        disposed.push("second");
      }));
      return createElement("span", {}, "pending-two");
    };

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(renderReactRouteState(state, { pending: first }, runtime));
        });
        await flushReact();
        expect(container.textContent).toBe("pending-one");

        await act(async () => {
          root.render(renderReactRouteState(state, { pending: second }, runtime));
        });
        await flushReact();
        await Effect.runPromise(Effect.sleep("20 millis"));

        expect(container.textContent).toBe("pending-two");
        expect(disposed).toEqual(["first"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("rerenders failure outlet renderers without navigation", async () => {
    const runtime = makeRuntime();
    const FailingRoute = route("/renderer-failure", {
      preload: () => Effect.fail("offline" as const),
      component: () => createElement("span", {}, "never")
    });
    const routes = [FailingRoute] as const;
    type FailureState = Extract<BrowserRouterState<typeof routes, "offline">, { readonly _tag: "Failure" }>;
    const state: FailureState = {
      _tag: "Failure",
      href: "/renderer-failure",
      cause: Cause.fail("offline" as const),
      error: "offline"
    };
    const disposed: Array<string> = [];
    const first = () => {
      onDispose(() => Effect.sync(() => {
        disposed.push("first");
      }));
      return createElement("span", {}, "failure-one");
    };
    const second = () => {
      onDispose(() => Effect.sync(() => {
        disposed.push("second");
      }));
      return createElement("span", {}, "failure-two");
    };

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(renderReactRouteState(state, { failure: first }, runtime));
        });
        await flushReact();
        expect(container.textContent).toBe("failure-one");

        await act(async () => {
          root.render(renderReactRouteState(state, { failure: second }, runtime));
        });
        await flushReact();
        await Effect.runPromise(Effect.sleep("20 millis"));

        expect(container.textContent).toBe("failure-two");
        expect(disposed).toEqual(["first"]);
      });
    } finally {
      await Effect.runPromise(runtime.disposeEffect);
    }
  });

  it("renders route components with the router runtime despite nested providers", async () => {
    const outerRuntime = makeRuntime();
    const innerRuntime = makeRuntime();
    const ProjectById = Resource.family<string, { readonly id: string }>({
      name: "ReactRouter.runtime-owned-route-resource",
      load: (id) => Effect.succeed({ id })
    });
    const ref = ProjectById("atlas");
    let renderedStatus: string | undefined;
    const Project = route("/runtime-projects/:id", {
      preload: () => Resource.prefetchEffect(ref),
      component: () => {
        const status = Resource.status(ref);
        renderedStatus = status._tag;
        return createElement("span", {}, status._tag);
      }
    });
    const routes = [Project] as const;

    try {
      await withReactRoot(async (root, container) => {
        await act(async () => {
          root.render(
            createElement(
              RouterProvider,
              {
                routes,
                initialHref: "/runtime-projects/atlas",
                runtime: outerRuntime
              },
              createElement(
                RuntimeProvider,
                { runtime: innerRuntime },
                createElement(RouterOutlet)
              )
            )
          );
        });
        await flushReact();
        await flushReact();

        expect(renderedStatus).toBe("Success");
        expect(container.textContent).toBe("Success");
      });

      expect(runWithRuntime(innerRuntime, () => Resource.status(ref)._tag)).toBe("Initial");
    } finally {
      await Effect.runPromise(outerRuntime.disposeEffect);
      await Effect.runPromise(innerRuntime.disposeEffect);
    }
  });
});
