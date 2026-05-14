import { Data } from "effect";
import type { ResourceRef } from "./resource.js";

export class ResourceFailure<A = unknown, E = unknown> extends Data.TaggedError("ResourceFailure")<{
  readonly ref: ResourceRef<unknown, A, E, unknown>;
  readonly error: E;
  readonly previous: A | undefined;
}> {}

export class MissingResourceInput extends Data.TaggedError("MissingResourceInput")<{
  readonly key: string;
}> {}
