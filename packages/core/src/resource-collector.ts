import { Context } from "effect";
import type { AnyResourceRef } from "./resource.js";

/** Internal collector service used while planning route preloads. */
export interface ResourceCollector {
  readonly refs: Map<string, AnyResourceRef>;
}

export const ResourceCollector = Context.Service<ResourceCollector>(
  "@sunfall/arc-core/ResourceCollector",
);

export interface ResourceCollected<A> {
  readonly value: A;
  readonly refs: ReadonlyArray<AnyResourceRef>;
}
