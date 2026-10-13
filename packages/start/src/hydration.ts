import { type EffectInputCallbackError, Resource, Route } from "@sunfall/arc-core";
import { Cause, Data, Effect, Exit, type Schema } from "effect";
import { hydrateAppStates, isStateSnapshots, type StateSnapshot } from "@sunfall/arc-core/internal";
import type { StartPostedAction } from "./start-action-form-post.js";
import {
  hydrationScriptId,
  markStartHydrationChunkElementConsumed,
  readStartHydrationChunkScriptElements,
  readStartHydrationScriptText,
  streamHydrationAttribute,
  streamHydrationScriptType,
  streamHydrationSequenceAttribute,
  type ReadStartHydrationChunksOptions,
  type StartHydrationChunkDocument,
  type StartHydrationChunkScriptElement,
  type StartHydrationDocument,
} from "./hydration-dom.js";
export {
  hydrationScriptId,
  markStartHydrationChunkElementConsumed,
  readStartHydrationChunkScriptElements,
  readStartHydrationScriptText,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationScriptType,
  streamHydrationSequenceAttribute,
  type ReadStartHydrationChunksOptions,
  type StartHydrationChunkDocument,
  type StartHydrationChunkScriptElement,
  type StartHydrationDocument,
  type StartHydrationScriptElement,
} from "./hydration-dom.js";
/** Wire-format version for Start hydration chunks. */
export const startHydrationChunkVersion = 1;

/** Codec errors that can occur while applying decoded hydration snapshots. */
export type StartHydrationCodecError =
  | EffectInputCallbackError
  | Resource.SnapshotCodecError
  | Resource.HydrationApplyError
  | Schema.SchemaError;

/**
 * Error raised when a hydration chunk cannot be parsed or validated.
 *
 * `sequence` is the stream order from the chunk attribute, or the fallback DOM
 * order when no valid sequence attribute exists.
 */
export class StartHydrationChunkParseError extends Data.TaggedError(
  "StartHydrationChunkParseError",
)<{
  readonly sequence: number;
  readonly value: unknown;
  readonly cause?: unknown;
  readonly guidance: string;
}> {}

/**
 * Error raised when the root hydration payload script is malformed.
 */
export class StartHydrationPayloadParseError extends Data.TaggedError(
  "StartHydrationPayloadParseError",
)<{
  readonly id: string;
  readonly value: unknown;
  readonly cause?: unknown;
  readonly guidance: string;
}> {}

/**
 * Error raised when a Start hydration payload cannot be serialized for HTML.
 */
export class StartHydrationPayloadSerializeError extends Data.TaggedError(
  "StartHydrationPayloadSerializeError",
)<{
  readonly operation: "root-payload" | "stream-chunk";
  readonly value: unknown;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

/**
 * Typed failures emitted by Effect-first Start hydration helpers.
 *
 * Snapshot codec and Schema errors report malformed Resource payloads.
 * Payload and chunk parse errors report malformed hydration script contents
 * before any Resource hydration runs.
 */
export type StartHydrationError =
  | StartHydrationCodecError
  | StartHydrationChunkParseError
  | StartHydrationPayloadParseError;

/** Serialized Resource state transported from Start SSR to the browser. */
export interface StartHydrationPayload extends Resource.HydrationPayload {
  /** Route preload failure the server rendered; the hydrating router starts in that `Failure` state. */
  readonly routeFailure?: Route.PreloadFailureSnapshot;
  /**
   * The server rendered the not-found state (no route matched); the hydrating
   * router starts `NotFound` whatever URL the document is served at.
   */
  readonly notFound?: true;
  /**
   * Ids of the browser's pending durable submissions (from its outbox cookie)
   * that the server settled before rendering this state. `App.launch` restores
   * them without re-applying their optimistic patch.
   */
  readonly settledSubmissions?: ReadonlyArray<string>;
  /**
   * The no-JavaScript form post the server rendered the page again for (its
   * Action answered a validation failure or a failure). `App.launch` starts
   * the Action's bindings from it while the page hydrates.
   */
  readonly postedAction?: StartPostedAction;
  /**
   * Models of the request's app States that moved off their initial state
   * while rendering, encoded through each machine's state schema. The
   * browser decodes each when its State starts; a snapshot the schema
   * rejects is a `Hydrate` failure and the State starts from its initial
   * state.
   */
  readonly states?: ReadonlyArray<StateSnapshot>;
}

/** One ordered hydration payload emitted after the app root. */
export interface StartHydrationChunk {
  /** Discriminant for Start hydration chunks. */
  readonly _tag: "StartHydrationChunk";
  /** Wire-format version checked before a chunk is applied. */
  readonly version: typeof startHydrationChunkVersion;
  /** Stable ordering key used before applying hydration chunks. */
  readonly sequence: number;
  /** Resource snapshots carried by this chunk. */
  readonly payload: StartHydrationPayload;
}

/** Effect-first options for applying a Start hydration payload. */
export interface HydrateStartPayloadEffectOptions extends Resource.HydrationOptions {}

/**
 * Options for applying hydration chunks from a document.
 *
 * Streamed chunk hydration is progressive: each Start hydration payload is
 * validated before that payload mutates Resource state, but a
 * later chunk failure does not roll back chunks that were already applied.
 * `markConsumed` defaults to true when hydrating from a document so repeated
 * hydration passes skip chunks after the full chunk scan succeeds.
 */
export interface HydrateStartHydrationChunksFromDocumentEffectOptions
  extends HydrateStartPayloadEffectOptions, ReadStartHydrationChunksOptions {
  /** Mark applied chunk elements as consumed. Defaults to true for document hydration. */
  readonly markConsumed?: boolean;
}

/** Effect-first options for reading and applying the document hydration script. */
export interface HydrateFromDocumentOptions extends HydrateStartHydrationChunksFromDocumentEffectOptions {
  /** DOM id of the root hydration payload script. Defaults to Start's id. */
  readonly id?: string;
}

interface StartHydrationChunkElement extends Pick<
  StartHydrationChunkScriptElement,
  "element" | "index"
> {
  readonly chunk: StartHydrationChunk;
}

const escapeJsonForHtml = (json: string): string =>
  json.replace(/[<>&\u2028\u2029]/g, (character) => {
    switch (character) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return character;
    }
  });

const escapeHtmlAttribute = (value: string): string =>
  value
    .replace(/[&"<>]/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case '"':
          return "&quot;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        default:
          return character;
      }
    })
    .replaceAll("\u0000", "\uFFFD");

const runStartHydrationTransportSync = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
  if (failure !== undefined) {
    throw failure;
  }

  throw Cause.squash(exit.cause);
};

/** The route outcome a render shows, carried by its root payload. */
export interface StartHydrationRouteOutcome {
  readonly routeFailure?: Route.PreloadFailureSnapshot | undefined;
  readonly notFound?: boolean | undefined;
}

/** Builds a Start payload from Resource dehydration output and the rendered route outcome. */
export const createStartHydrationPayload = (
  resources: Resource.HydrationPayload,
  route: StartHydrationRouteOutcome = {},
): StartHydrationPayload => ({
  resources: resources.resources,
  ...(route.routeFailure === undefined ? {} : { routeFailure: route.routeFailure }),
  ...(route.notFound === true ? { notFound: true } : {}),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isRoutePreloadFailureEncoding = (value: unknown): boolean =>
  isRecord(value) &&
  (value._tag === "Encoded"
    ? "value" in value
    : value._tag === "Untyped"
      ? value.tag === undefined || typeof value.tag === "string"
      : value._tag === "Unencodable");

const isRoutePreloadFailureSnapshot = (value: unknown): value is Route.PreloadFailureSnapshot =>
  isRecord(value) &&
  typeof value.path === "string" &&
  typeof value.href === "string" &&
  isRoutePreloadFailureEncoding(value.failure);

const isStartHydrationPayload = (value: unknown): value is StartHydrationPayload =>
  isRecord(value) &&
  Array.isArray(value.resources) &&
  (value.routeFailure === undefined || isRoutePreloadFailureSnapshot(value.routeFailure)) &&
  (value.notFound === undefined || value.notFound === true) &&
  (value.settledSubmissions === undefined ||
    (Array.isArray(value.settledSubmissions) &&
      value.settledSubmissions.every((id) => typeof id === "string"))) &&
  (value.postedAction === undefined ||
    (isRecord(value.postedAction) &&
      typeof value.postedAction.action === "string" &&
      isRecord(value.postedAction.values) &&
      isRecord(value.postedAction.outcome))) &&
  (value.states === undefined || isStateSnapshots(value.states));

/** Narrow an unknown value to the current hydration chunk wire format. */
export const isStartHydrationChunk = (value: unknown): value is StartHydrationChunk =>
  isRecord(value) &&
  value._tag === "StartHydrationChunk" &&
  value.version === startHydrationChunkVersion &&
  typeof value.sequence === "number" &&
  Number.isSafeInteger(value.sequence) &&
  value.sequence >= 0 &&
  isStartHydrationPayload(value.payload);

/** Wrap a root hydration payload in a hydration chunk with an explicit sequence. */
export const makeStartHydrationChunk = (
  payload: StartHydrationPayload,
  sequence: number,
): StartHydrationChunk => ({
  _tag: "StartHydrationChunk",
  version: startHydrationChunkVersion,
  sequence,
  payload,
});

const decodeStartHydrationChunkEffect = (
  value: unknown,
  fallbackSequence: number,
): Effect.Effect<StartHydrationChunk, StartHydrationChunkParseError> => {
  if (isStartHydrationChunk(value)) {
    return Effect.succeed(value);
  }

  if (isStartHydrationPayload(value)) {
    return Effect.succeed(makeStartHydrationChunk(value, fallbackSequence));
  }

  return Effect.fail(startHydrationChunkParseError(fallbackSequence, value));
};

const startHydrationChunkParseError = (
  sequence: number,
  value: unknown,
  cause?: unknown,
): StartHydrationChunkParseError =>
  new StartHydrationChunkParseError({
    sequence,
    value,
    ...(cause === undefined ? {} : { cause }),
    guidance:
      "Emit stream hydration chunks with createStreamHydrationScriptSync or serializeStreamHydrationPayload.",
  });

const parseStartHydrationChunkJsonEffect = (
  text: string,
  sequence: number,
): Effect.Effect<StartHydrationChunk, StartHydrationChunkParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationChunkParseError(sequence, text, cause),
  }).pipe(Effect.flatMap((value) => decodeStartHydrationChunkEffect(value, sequence)));

const startHydrationPayloadParseError = (
  id: string,
  value: unknown,
  cause?: unknown,
): StartHydrationPayloadParseError =>
  new StartHydrationPayloadParseError({
    id,
    value,
    ...(cause === undefined ? {} : { cause }),
    guidance:
      "Emit the root hydration payload with createHydrationScriptSync or serializeHydrationPayload.",
  });

const decodeStartHydrationPayloadEffect = (
  value: unknown,
  id: string,
): Effect.Effect<StartHydrationPayload, StartHydrationPayloadParseError> =>
  isStartHydrationPayload(value)
    ? Effect.succeed(value)
    : Effect.fail(startHydrationPayloadParseError(id, value));

const parseStartHydrationPayloadJsonEffect = (
  text: string,
  id: string,
): Effect.Effect<StartHydrationPayload, StartHydrationPayloadParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationPayloadParseError(id, text, cause),
  }).pipe(Effect.flatMap((value) => decodeStartHydrationPayloadEffect(value, id)));

const startHydrationChunkFrom = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence: number,
): StartHydrationChunk =>
  isStartHydrationChunk(input) ? input : makeStartHydrationChunk(input, sequence);

const startHydrationPayloadSerializeError = (
  operation: StartHydrationPayloadSerializeError["operation"],
  value: unknown,
  cause: unknown,
): StartHydrationPayloadSerializeError =>
  new StartHydrationPayloadSerializeError({
    operation,
    value,
    cause,
    guidance: "Start hydration payloads must contain JSON-serializable Resource state.",
  });

const encodeStartHydrationValueEffect = (
  value: StartHydrationPayload | StartHydrationChunk,
  operation: StartHydrationPayloadSerializeError["operation"],
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  Effect.try({
    try: () => JSON.stringify(value),
    catch: (cause) => startHydrationPayloadSerializeError(operation, value, cause),
  }).pipe(Effect.map(escapeJsonForHtml));

/** Encode a root hydration payload as HTML-safe JSON inside Effect. */
export const encodeStartHydrationPayload = (
  payload: StartHydrationPayload,
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationValueEffect(payload, "root-payload");

/** Encode one hydration chunk as HTML-safe JSON inside Effect. */
export const encodeStartHydrationChunk = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0,
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationValueEffect(startHydrationChunkFrom(input, sequence), "stream-chunk");

/** Sort hydration chunks by sequence, preserving input order for ties. */
export const sortStartHydrationChunks = (
  chunks: Iterable<StartHydrationChunk>,
): ReadonlyArray<StartHydrationChunk> =>
  Array.from(chunks, (chunk, index) => ({ chunk, index }))
    .sort((left, right) =>
      left.chunk.sequence === right.chunk.sequence
        ? left.index - right.index
        : left.chunk.sequence - right.chunk.sequence,
    )
    .map(({ chunk }) => chunk);

/** Merge several root or chunk payloads into one payload. */
export const mergeStartHydrationPayloads = (
  payloads: Iterable<StartHydrationPayload>,
): StartHydrationPayload => {
  const resources: Array<StartHydrationPayload["resources"][number]> = [];
  const settledSubmissions = new Set<string>();
  let routeFailure: Route.PreloadFailureSnapshot | undefined;
  let notFound = false;
  let postedAction: StartPostedAction | undefined;
  const states: Array<StateSnapshot> = [];

  for (const payload of payloads) {
    resources.push(...payload.resources);
    states.push(...(payload.states ?? []));
    routeFailure = payload.routeFailure ?? routeFailure;
    notFound ||= payload.notFound === true;
    postedAction = payload.postedAction ?? postedAction;
    for (const id of payload.settledSubmissions ?? []) {
      settledSubmissions.add(id);
    }
  }

  return {
    resources,
    ...(routeFailure === undefined ? {} : { routeFailure }),
    ...(notFound ? { notFound: true } : {}),
    ...(settledSubmissions.size > 0 ? { settledSubmissions: [...settledSubmissions] } : {}),
    ...(postedAction === undefined ? {} : { postedAction }),
    ...(states.length > 0 ? { states } : {}),
  };
};

/** Serialize a root hydration payload as HTML-safe JSON. */
export const serializeHydrationPayload = (payload: StartHydrationPayload): string =>
  runStartHydrationTransportSync(encodeStartHydrationPayload(payload));

/** Create the root hydration script tag inside Effect. */
export const createHydrationScript = (
  payload: StartHydrationPayload,
  id = hydrationScriptId,
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationPayload(payload).pipe(
    Effect.map(
      (encoded) =>
        `<script type="application/json" id="${escapeHtmlAttribute(id)}">${encoded}</script>`,
    ),
  );

/** Create the root hydration script tag emitted during SSR. */
export const createHydrationScriptSync = (
  payload: StartHydrationPayload,
  id = hydrationScriptId,
): string => runStartHydrationTransportSync(createHydrationScript(payload, id));

/** Serialize one hydration chunk as HTML-safe JSON. */
export const serializeStreamHydrationPayload = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0,
): string => runStartHydrationTransportSync(encodeStartHydrationChunk(input, sequence));

/** Create a hydration chunk script tag inside Effect. */
export const createStreamHydrationScript = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0,
): Effect.Effect<string, StartHydrationPayloadSerializeError> => {
  const chunk = startHydrationChunkFrom(input, sequence);
  return encodeStartHydrationChunk(chunk).pipe(
    Effect.map(
      (encoded) =>
        `<script type="${streamHydrationScriptType}" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="${chunk.sequence}">${encoded}</script>`,
    ),
  );
};

/** Create a hydration chunk script tag with chunk marker and sequence attributes. */
export const createStreamHydrationScriptSync = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0,
): string => runStartHydrationTransportSync(createStreamHydrationScript(input, sequence));

/** Effect-first reader for the root hydration payload. */
export const readHydrationPayload = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId,
): Effect.Effect<StartHydrationPayload | undefined, StartHydrationPayloadParseError> => {
  const text = readStartHydrationScriptText(document, id);
  return text === undefined
    ? Effect.succeed(undefined)
    : parseStartHydrationPayloadJsonEffect(text, id);
};

const sortStartHydrationChunkElements = (
  entries: Iterable<StartHydrationChunkElement>,
): ReadonlyArray<StartHydrationChunkElement> =>
  Array.from(entries).sort((left, right) =>
    left.chunk.sequence === right.chunk.sequence
      ? left.index - right.index
      : left.chunk.sequence - right.chunk.sequence,
  );

const readStartHydrationChunkElementsEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {},
): Effect.Effect<ReadonlyArray<StartHydrationChunkElement>, StartHydrationChunkParseError> =>
  Effect.forEach(
    readStartHydrationChunkScriptElements(document, options),
    ({ element, index, sequence, text }) =>
      parseStartHydrationChunkJsonEffect(text, sequence).pipe(
        Effect.map(
          (chunk): StartHydrationChunkElement => ({
            element,
            index,
            chunk,
          }),
        ),
      ),
  ).pipe(Effect.map(sortStartHydrationChunkElements));

/** Effect-first reader for hydration chunks from a document. */
export const readStartHydrationChunks = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {},
): Effect.Effect<ReadonlyArray<StartHydrationChunk>, StartHydrationChunkParseError> =>
  readStartHydrationChunkElementsEffect(document, options).pipe(
    Effect.map((entries) => entries.map(({ chunk }) => chunk)),
  );

/**
 * Applies a Start hydration payload inside Effect.
 *
 * Malformed resource snapshots fail as typed codec errors; host
 * adapters should keep those failures instead of catching them as `unknown`.
 */
export const hydrateStartPayload = (
  payload: StartHydrationPayload,
  options: HydrateStartPayloadEffectOptions = {},
): Effect.Effect<void, StartHydrationCodecError> =>
  Effect.gen(function* () {
    // `Resource.hydrate` validates the payload's shape before applying it.
    yield* Resource.hydrate(payload, options);
    if (payload.routeFailure !== undefined) {
      yield* Route.hydratePreloadFailure(payload.routeFailure);
    }
    if (payload.notFound === true) {
      yield* Route.hydrateNotFound();
    }
    if (payload.states !== undefined) {
      yield* hydrateAppStates(payload.states);
    }
  });

/**
 * Applies hydration chunks in sequence inside Effect.
 *
 * The atomic unit is one Start hydration payload. A malformed later chunk fails
 * the Effect without rolling back earlier successfully-applied chunks.
 */
export const hydrateStartHydrationChunks = (
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadEffectOptions = {},
): Effect.Effect<void, StartHydrationCodecError> =>
  Effect.forEach(
    sortStartHydrationChunks(chunks),
    (chunk) => hydrateStartPayload(chunk.payload, options),
    { discard: true },
  );

/**
 * Reads document stream chunks and applies them inside Effect.
 *
 * Chunks are marked consumed only after the full read/apply pass succeeds. If a
 * later chunk fails, earlier chunks may already be hydrated and will remain
 * unmarked so callers can retry the scan after fixing the document/source.
 */
export const hydrateStartHydrationChunksFromDocument = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentEffectOptions = {},
): Effect.Effect<ReadonlyArray<StartHydrationChunk>, StartHydrationError> =>
  Effect.gen(function* () {
    const entries = yield* readStartHydrationChunkElementsEffect(document, options);
    const chunks = entries.map(({ chunk }) => chunk);

    if (chunks.length > 0) {
      yield* hydrateStartHydrationChunks(chunks, options);

      if (options.markConsumed !== false) {
        yield* Effect.sync(() => {
          for (const { element } of entries) {
            markStartHydrationChunkElementConsumed(element, options);
          }
        });
      }
    }

    return chunks;
  });

/**
 * Read the root payload and hydration chunks from a document, then hydrate them
 * in Effect.
 *
 * Root payload hydration runs before the chunks. The chunks then use
 * the progressive semantics of `hydrateStartHydrationChunksFromDocument`.
 */
export const hydrateFromDocument = (
  document: StartHydrationDocument = globalThis.document,
  options: HydrateFromDocumentOptions = {},
): Effect.Effect<StartHydrationPayload | undefined, StartHydrationError> =>
  Effect.gen(function* () {
    const payload = yield* readHydrationPayload(document, options.id ?? hydrationScriptId);
    if (payload) {
      yield* hydrateStartPayload(payload, options);
    }

    const chunks = yield* hydrateStartHydrationChunksFromDocument(document, options);

    if (payload === undefined && chunks.length === 0) {
      return undefined;
    }

    return mergeStartHydrationPayloads([
      ...(payload === undefined ? [] : [payload]),
      ...chunks.map((chunk) => chunk.payload),
    ]);
  });
