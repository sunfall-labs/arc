import { Resource, Route } from "@sunfall/arc-core";
import { Component, RouterOutlet, RouterProvider } from "@sunfall/arc-solid";
import { Effect, Schema } from "effect";
import { App } from "../src/index.js";

/*
 * A small Start app for route verdicts and render-loaded Resources: items
 * that may not exist (`Route.notFound()`), a page that sends visitors away
 * (`Route.redirect`), a shell that reads a Resource no route preloads, and
 * a page head from the preloaded item.
 */

export class ItemMissing extends Schema.TaggedError<ItemMissing>()("ItemMissing", {
  id: Schema.String,
}) {}

const items = new Map([["atlas", "Atlas"]]);

/** A served Resource read by the shell on every page, preloaded by no route. */
export const ViewerName = Resource.define({
  name: "RouteVerdicts.viewer",
  input: Schema.Literal("me"),
  output: Schema.String,
});
/** The server's load for `ViewerName` (a `*.server.ts` module in an app). */
export const viewerServer = Resource.implement(ViewerName, () => Effect.succeed("Ada"));

export const ItemName = Resource.define({
  name: "RouteVerdicts.item",
  input: Schema.String,
  output: Schema.String,
  error: ItemMissing,
  load: (id) => {
    const name = items.get(id);
    return name === undefined ? Effect.fail(new ItemMissing({ id })) : Effect.succeed(name);
  },
});

export const ItemRoute = Route.define("/items/:id", {
  params: Schema.Struct({ id: Schema.String }),
  preload: ({ params }) =>
    Resource.preload(ViewerName("me")).pipe(
      Effect.andThen(Resource.preload(ItemName(params.id))),
      Effect.catchTag("ItemMissing", () => Route.notFound()),
    ),
  head: ({ params, read }) => ({
    title: read(ItemName(params.id)) ?? params.id,
    description: `The <${params.id}> item`,
  }),
});

export const PrivateRoute = Route.define("/private", {
  preload: () => Route.redirect("/items/atlas?from=private"),
});

const ItemPage = Component.define("ItemPage", function* (props: { readonly id: string }) {
  const item = yield* Component.resource(ItemName);
  return () => <p class="item">{item(props.id)}</p>;
}).pipe(Component.catchTags({ ItemMissing: () => <p>missing</p> }));

const routes = [
  Route.withComponent(ItemRoute, ItemPage, ({ params }) => ({ id: params.id })),
  Route.withComponent(PrivateRoute, () => <p>private</p>),
] as const;

const Root = Component.define("Root", function* (props: App.RootProps) {
  const router = yield* Component.router(routes, { initialHref: props.href });
  const viewer = yield* Component.resource(ViewerName);
  return () => (
    <RouterProvider router={router}>
      <header>{viewer("me")}</header>
      <RouterOutlet router={router} notFound={() => <p class="not-found">Not found</p>} />
    </RouterProvider>
  );
});

export const verdictsApp = App.define({
  root: Root,
  routes,
  head: (page) => ({
    ...page,
    title: page.title === undefined ? "Items" : `${page.title} · Items`,
    meta: [{ name: "color-scheme", content: "light dark" }],
  }),
});
