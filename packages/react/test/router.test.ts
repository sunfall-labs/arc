import { makeMemoryBrowserHistoryAdapter, makeRuntime, onDispose, Resource, route, runWithRuntime } from "@effect-ui/core";
import { Effect } from "effect";
import { Window } from "happy-dom";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  RouterLink,
  RouterOutlet,
  RouterProvider,
  RuntimeProvider,
  useRouter,
  type BrowserRouter
} from "../src/index.js";

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
