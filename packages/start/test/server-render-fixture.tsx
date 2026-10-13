import { Machine, Message, Model, Resource, Route, State, StateRefTypeId } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { Effect, Schema, Stream } from "effect";
import { App } from "../src/index.js";

/*
 * A small Start app for what a server render must not keep: a board whose
 * rows follow a change feed (preloaded by the route and read by the shell),
 * and an app State the shell and the page share.
 */

export const probe = {
  /** Every `rows.changes` subscription, wherever it ran. */
  feeds: 0,
  /** The model cell of every app State binding, per render. */
  toastRefs: [] as Array<unknown>,
};

const Card = Schema.Struct({ id: Schema.String, title: Schema.String });

export const Cards = Resource.define({
  name: "ServerRender.cards",
  input: Schema.Literal("all"),
  output: Schema.Array(Card),
  rows: {
    key: (card) => card.id,
    changes: () =>
      Stream.suspend(() => {
        probe.feeds++;
        return Stream.never;
      }),
  },
  load: () => Effect.succeed([{ id: "a", title: "Alpha" }]),
});

const ToastModel = Model({ Toast: { text: Schema.String } });
const ToastMessage = Message({ Notified: { text: Schema.String } });

export const Toast = State.define({
  name: "ServerRender.toast",
  scope: "app",
  machine: Machine.make({
    state: ToastModel,
    event: ToastMessage,
    initial: ToastModel.Toast({ text: "" }),
  }).onAny(ToastMessage.Notified, ({ event }) => ToastModel.Toast({ text: event.text })),
});

const BoardRoute = Route.define("/board", {
  preload: () => Resource.preload(Cards("all")),
});

const BoardPage = Component.define("BoardPage", function* () {
  const cards = yield* Component.resource(Cards);
  const toast = yield* Component.state(Toast);
  probe.toastRefs.push(toast[StateRefTypeId]);
  return () => <ul>{cards("all").map((card) => `[${card.title}]`)}</ul>;
});

const routes = [Route.withComponent(BoardRoute, BoardPage)] as const;

const Root = Component.define("Root", function* (props: App.RootProps) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  const cards = yield* Component.resource(Cards);
  const toast = yield* Component.state(Toast);
  probe.toastRefs.push(toast[StateRefTypeId]);
  return () => (
    <RouterProvider router={router}>
      <header>{cards("all").length} cards</header>
      <RouterOutlet router={router} />
    </RouterProvider>
  );
});

export const serverRenderApp = App.define({ root: Root, routes });
