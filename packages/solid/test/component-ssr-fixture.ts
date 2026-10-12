// Shared by the server render test (Solid's server build) and the client
// hydration test (Solid's browser build): one Component tree, rendered on both.
import { Resource } from "@sunfall/arc-core";
import { Context, Effect, Layer } from "effect";
import type { JSX } from "@solidjs/web";
import { Component } from "../src/index.js";

interface Greeter {
  readonly greet: (name: string) => string;
}
const Greeter = Context.Service<Greeter>("@sunfall/arc-solid/test/ComponentSsr/Greeter");

/** A reactive text child, as JSX compiles `{read()}`. */
export const reactive = (read: () => string): JSX.Element => read as unknown as JSX.Element;

/** Markup the server renders for `ssrApp(...)` with project "atlas" preloaded. */
export const ssrMarkup = "Hello atlas: Project atlas";

/** Builds the tree with counters, so each test observes its own setups, loads, and fallbacks. */
export const ssrApp = () => {
  const events = {
    layerBuilds: 0,
    setups: 0,
    loads: 0,
    fallbacks: 0,
    released: 0,
  };
  const ProjectById = Resource.define({
    name: `SolidComponentSsr.ProjectById.${Math.random().toString(36).slice(2)}`,
    load: (id: string) =>
      Effect.sync(() => {
        events.loads++;
        return `Project ${id}`;
      }),
  });
  const GreeterLive = Layer.effect(
    Greeter,
    Effect.acquireRelease(
      Effect.sync(() => {
        events.layerBuilds++;
        return { greet: (name: string) => `Hello ${name}` };
      }),
      () => Effect.sync(() => events.released++),
    ),
  );
  const Card = Component.define("Card", function* (props: { readonly id: string }) {
    events.setups++;
    const greeter = yield* Greeter;
    const project = yield* Component.resource(ProjectById);
    return () => reactive(() => `${greeter.greet(props.id)}: ${project(props.id)}`);
  });
  const App = Card.pipe(
    Component.loading(() => {
      events.fallbacks++;
      return "loading";
    }),
    Component.provide(GreeterLive),
  );
  return { App, ProjectById, events };
};
