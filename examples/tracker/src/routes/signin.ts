import { Resource, Route } from "@sunfall/arc-core";
import { Effect, Schema } from "effect";
import { lenientSearch } from "../model.js";
import { CurrentUserRef } from "../resources.js";
import { safeRedirect } from "../session.js";

export const route = Route.define("/signin", {
  search: Schema.Struct({ next: lenientSearch(Schema.String) }),
  // Signed in already: go where the sign-in would have gone.
  preload: ({ search }) =>
    Resource.preload(CurrentUserRef).pipe(
      Effect.flatMap((user) =>
        user === null ? Effect.void : Route.redirect(safeRedirect(search.next)),
      ),
    ),
});
