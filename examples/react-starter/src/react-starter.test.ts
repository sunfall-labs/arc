import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuntimeProvider, createEffectRuntime } from "@sunfall/arc-react";
import { Effect, Layer } from "effect";
import { Window } from "happy-dom";
import { act, createElement, type ReactNode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import {
  hydrateFromDocument,
  hydrationScriptId,
  streamHydrationAttribute,
  type StartHydrationChunk,
  type StartHydrationPayload,
} from "@sunfall/arc-start";
import App from "./App.js";
import { app } from "./app-definition.js";
import { WelcomeRef } from "./starter.js";
import {
  hrefById,
  hrefByPath,
  routeById,
  routeByPath,
  routes,
  type FileRouteHrefOptionsById,
} from "./routeTree.gen.js";
import { handleRequest } from "./server.js";

const htmlJsonScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const rootHydrationPayloadFrom = (html: string): StartHydrationPayload => {
  for (const match of html.matchAll(htmlJsonScriptPattern)) {
    if ((match[1] ?? "").includes(`id="${hydrationScriptId}"`)) {
      return JSON.parse(match[2] ?? "") as StartHydrationPayload;
    }
  }

  expect.fail("Root hydration script not found.");
};

const streamHydrationChunksFrom = (html: string): ReadonlyArray<StartHydrationChunk> =>
  Array.from(html.matchAll(htmlJsonScriptPattern))
    .filter((match) => match[1]?.includes(streamHydrationAttribute))
    .map((match) => JSON.parse(match[2] ?? "") as StartHydrationChunk);

const resourcePairs = (payload: StartHydrationPayload): ReadonlySet<string> =>
  new Set(payload.resources.map((resource) => JSON.stringify([resource.name, resource.key])));

const installDom = (html: string): (() => void) => {
  const window = new Window({ url: "https://starter.test/" });
  window.document.write(html);
  window.document.close();

  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const setGlobal = (key: PropertyKey, value: unknown): void => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };

  setGlobal("window", window);
  setGlobal("document", window.document);
  setGlobal("navigator", window.navigator);
  setGlobal("HTMLElement", window.HTMLElement);
  setGlobal("Node", window.Node);
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

describe("react starter", () => {
  it("renders the SSR shell and route-owned Resource preload", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          app.runtime.provide(handleRequest(new Request("https://starter.test/"))),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const rootPairs = resourcePairs(rootHydrationPayloadFrom(html));
        const streamedPairs = new Set(
          streamHydrationChunksFrom(html).flatMap((chunk) => [...resourcePairs(chunk.payload)]),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("x-sunfall-arc-starter")).toBe("react");
        expect(html).toContain("Hello, React.");
        expect(html).toContain("__SUNFALL_ARC_HYDRATION__");
        expect(html).toContain("data-sunfall-arc-hydration-chunk");
        const document = new Window().document;
        document.write(html);
        document.close();
        const root = document.getElementById("root");
        expect(root?.querySelector(`[${streamHydrationAttribute}]`)).toBeNull();
        expect(document.querySelector(`[${streamHydrationAttribute}]`)).not.toBeNull();
        expect([...rootPairs]).toEqual([]);
        expect(streamHydrationChunksFrom(html)).toHaveLength(1);
        expect([...streamedPairs]).toContain(
          JSON.stringify([WelcomeRef.family.options.name, WelcomeRef.key]),
        );
        expect([...streamedPairs].filter((pair) => rootPairs.has(pair))).toEqual([]);
      }),
    ));

  it("hydrates a fresh browser document from streamed Resource payloads", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.scoped(
          app.runtime.provide(handleRequest(new Request("https://starter.test/"))),
        );
        const html = yield* Effect.tryPromise(() => response.text());
        const cleanupDom = installDom(html);
        const runtime = createEffectRuntime(Layer.empty);
        const RuntimeRoot = RuntimeProvider as (props: {
          readonly runtime: typeof runtime;
          readonly children?: ReactNode;
        }) => ReactNode;
        let root: Root | undefined;
        const errors: string[] = [];
        const previousError = console.error;
        console.error = (...args: ReadonlyArray<unknown>) => {
          errors.push(args.map(String).join(" "));
        };

        try {
          hydrateFromDocument(document, undefined, { runtime });
          const container = document.getElementById("root");
          expect(container).not.toBeNull();

          yield* Effect.tryPromise(() =>
            act(async () => {
              root = hydrateRoot(
                container!,
                createElement(RuntimeRoot, { runtime }, createElement(App)),
              );
              await Effect.runPromise(Effect.sleep(0));
            }),
          );

          expect(container!.textContent).toContain("Hello, React.");
          expect(container!.textContent).toContain("shadcn CLI");
          expect(container!.textContent).toContain("Base UI primitive");
          expect(errors.filter((message) => message.includes("Hydration failed"))).toEqual([]);
        } finally {
          console.error = previousError;
          if (root) {
            yield* Effect.tryPromise(() =>
              act(async () => {
                root?.unmount();
              }),
            );
          }
          cleanupDom();
          yield* runtime.disposeEffect;
        }
      }),
    ));

  it("pins the generated route definitions artifact", () => {
    const hrefOptions: FileRouteHrefOptionsById["route_root"] = {};
    const source = readFileSync(new URL("./routeTree.gen.ts", import.meta.url), "utf8");

    expect(source).toContain("// This file is generated by @sunfall/arc-start. Do not edit.");
    expect(routes).toEqual([routeById.route_root]);
    expect(routeByPath["/"]).toBe(routeById.route_root);
    expect(routeById.route_root.path).toBe("/");
    expect(hrefOptions).toEqual({});
    expect(hrefById("route_root")).toBe("/");
    expect(hrefByPath("/")).toBe("/");
  });
});
