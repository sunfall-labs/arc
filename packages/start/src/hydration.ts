import {
  currentOrDefaultRuntime,
  validateResourceHydrationInputEffect,
  type EffectInputCallbackError,
  Resource,
  type AnyEffectUiRuntime,
  type EffectUiRuntime,
  type ResourceHydrationApplyError,
  type ResourceSnapshotCodecError,
  type ResourceHydrationPayload
} from "@effect-ui/core";
import {
  Collection,
  type AnyCollection,
  type CollectionHydrateOptions,
  type CollectionHydrationPayload,
  CollectionSnapshotCodecError
} from "@effect-ui/db";
import { Cause, Data, Effect, Exit, type Schema } from "effect";
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
  type StartHydrationDocument
} from "./hydration-dom.js";
import {
  makeStartCollectionResolution,
  validateStartCollectionResolutionOptionsEffect,
  type StartCollectionDefinitionRegistry,
  type StartCollectionDefinitionResolver,
  type StartCollectionDuplicateName,
  type StartCollectionResolutionOptions
} from "./start-collection-resolution.js";
export type {
  StartCollectionDefinitionRegistry,
  StartCollectionDefinitionResolver,
  StartCollectionResolutionOptions
} from "./start-collection-resolution.js";
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
  type StartHydrationScriptElement
} from "./hydration-dom.js";
/** Wire-format version for streamed Start hydration chunks. */
export const startHydrationChunkVersion = 1;

/** Codec errors that can occur while applying decoded hydration snapshots. */
export type StartHydrationCodecError =
  | CollectionSnapshotCodecError
  | EffectInputCallbackError
  | ResourceSnapshotCodecError
  | ResourceHydrationApplyError
  | Schema.SchemaError;

/**
 * Error raised when a streamed hydration chunk cannot be parsed or validated.
 *
 * `sequence` is the stream order from the chunk attribute, or the fallback DOM
 * order when no valid sequence attribute exists.
 */
export class StartHydrationChunkParseError extends Data.TaggedError(
  "StartHydrationChunkParseError"
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
  "StartHydrationPayloadParseError"
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
  "StartHydrationPayloadSerializeError"
)<{
  readonly operation: "root-payload" | "stream-chunk";
  readonly value: unknown;
  readonly cause: unknown;
  readonly guidance: string;
}> {}

/**
 * Typed failures emitted by Effect-first Start hydration helpers.
 *
 * Snapshot codec and Schema errors report malformed Resource/Collection
 * payloads. Payload and chunk parse errors report malformed hydration script
 * contents before any Resource or Collection hydration runs.
 */
export type StartHydrationError =
  | StartHydrationCodecError
  | StartHydrationChunkParseError
  | StartHydrationPayloadParseError;

/** Serialized Resource and Collection state transported from Start SSR to the browser. */
export interface StartHydrationPayload extends ResourceHydrationPayload {
  /** Collection snapshots fail hydration with `CollectionSnapshotCodecError` when malformed. */
  readonly collections?: CollectionHydrationPayload["collections"];
}

/** One ordered hydration payload emitted during streamed HTML rendering. */
export interface StartHydrationChunk {
  /** Discriminant for streamed Start hydration chunks. */
  readonly _tag: "StartHydrationChunk";
  /** Wire-format version checked before a chunk is applied. */
  readonly version: typeof startHydrationChunkVersion;
  /** Stable ordering key used before applying streamed chunks. */
  readonly sequence: number;
  /** Resource and Collection snapshots carried by this chunk. */
  readonly payload: StartHydrationPayload;
}

/** Collections available when creating or applying Start hydration payloads. */
export interface StartCollectionHydrationOptions extends StartCollectionResolutionOptions {
  /** Collection definitions that can receive collection snapshots from payloads. */
  readonly collections?: Iterable<AnyCollection>;
  /** Explicit collection registry used to resolve route-declared or payload collection names. */
  readonly collectionRegistry?: StartCollectionDefinitionRegistry | ReadonlyMap<string, AnyCollection>;
  /** Explicit resolver used to resolve route-declared or payload collection names. */
  readonly resolveCollection?: StartCollectionDefinitionResolver;
}

/** Effect-first options for applying a Start hydration payload. */
export interface HydrateStartPayloadEffectOptions
  extends StartCollectionHydrationOptions, CollectionHydrateOptions {}

/** Synchronous host-seam options for applying a Start hydration payload. */
export interface HydrateStartPayloadOptions<RuntimeServices = never, RuntimeError = never>
  extends HydrateStartPayloadEffectOptions {
  /** Runtime used by the synchronous host-seam hydration facade. */
  readonly runtime?: EffectUiRuntime<RuntimeServices, RuntimeError> | AnyEffectUiRuntime<RuntimeError>;
}

/**
 * Options for applying streamed hydration chunks from a document.
 *
 * Streamed chunk hydration is progressive: each Start hydration payload is
 * validated before that payload mutates Resource or Collection state, but a
 * later chunk failure does not roll back chunks that were already applied.
 * `markConsumed` defaults to true when hydrating from a document so repeated
 * hydration passes skip chunks after the full chunk scan succeeds.
 */
export interface HydrateStartHydrationChunksFromDocumentEffectOptions
  extends HydrateStartPayloadEffectOptions, ReadStartHydrationChunksOptions {
  /** Mark applied chunk elements as consumed. Defaults to true for document hydration. */
  readonly markConsumed?: boolean;
}

export interface HydrateStartHydrationChunksFromDocumentOptions<RuntimeServices = never, RuntimeError = never>
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {
  /** Runtime used by the synchronous host-seam hydration facade. */
  readonly runtime?: EffectUiRuntime<RuntimeServices, RuntimeError> | AnyEffectUiRuntime<RuntimeError>;
}

/** Effect-first options for reading and applying the document hydration script. */
export interface HydrateFromDocumentEffectOptions
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {}

/** Synchronous host-seam options for reading and applying the document hydration script. */
export interface HydrateFromDocumentOptions<RuntimeServices = never, RuntimeError = never>
  extends HydrateFromDocumentEffectOptions {
  /** Runtime used by the synchronous host-seam document hydration facade. */
  readonly runtime?: EffectUiRuntime<RuntimeServices, RuntimeError> | AnyEffectUiRuntime<RuntimeError>;
}

/** Options for preloading request-time collections into the Start hydration payload. */
export interface PreloadRequestOptions extends StartCollectionHydrationOptions {}

interface StartHydrationChunkElement extends Pick<StartHydrationChunkScriptElement, "element" | "index"> {
  readonly chunk: StartHydrationChunk;
}

const emptyCollectionHydrationPayload: CollectionHydrationPayload = { collections: [] };

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
  value.replace(/[&"<>\u0000]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "\"":
        return "&quot;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\u0000":
        return "\uFFFD";
      default:
        return character;
    }
  });

const collectionHydrateOptions = (
  options: HydrateStartPayloadEffectOptions
): CollectionHydrateOptions => ({
  ...(options.replace === undefined ? {} : { replace: options.replace })
});

const duplicateHydrationCollection = (
  cause: StartCollectionDuplicateName
): CollectionSnapshotCodecError =>
  new CollectionSnapshotCodecError({
    operation: "hydrate",
    path: "$.collections",
    reason: `Multiple collection definitions were provided for '${cause.name}'. Collection names must identify one hydration definition in a Start hydration scope.`
  });

const collectionsForHydrationPayloadEffect = (
  payload: StartHydrationPayload,
  options: HydrateStartPayloadEffectOptions
): Effect.Effect<ReadonlyArray<AnyCollection>, CollectionSnapshotCodecError> => {
  const snapshots = payload.collections;
  if (!snapshots || snapshots.length === 0) {
    return Effect.succeed([]);
  }

  return Effect.gen(function* () {
    yield* validateStartCollectionResolutionOptionsEffect(options).pipe(
      Effect.mapError(duplicateHydrationCollection)
    );
    const resolution = makeStartCollectionResolution(options);
    const resolved = new Map<string, AnyCollection>();
    for (const [index, snapshot] of snapshots.entries()) {
      const collection = resolution.resolve(snapshot.name);
      if (collection === undefined) {
        return yield* Effect.fail(new CollectionSnapshotCodecError({
          operation: "hydrate",
          path: `$.collections[${index}].name`,
          reason: `No collection definition was provided for '${snapshot.name}'.`
        }));
      }
      if (collection.name !== snapshot.name) {
        return yield* Effect.fail(new CollectionSnapshotCodecError({
          operation: "hydrate",
          path: `$.collections[${index}].name`,
          reason: `Collection resolver returned '${collection.name}' for payload collection '${snapshot.name}'.`
        }));
      }
      const existing = resolved.get(collection.name);
      if (existing !== undefined && existing !== collection) {
        return yield* Effect.fail(new CollectionSnapshotCodecError({
          operation: "hydrate",
          path: `$.collections[${index}].name`,
          reason: `Multiple collection definitions were resolved for '${collection.name}'.`
        }));
      }
      resolved.set(collection.name, collection);
    }
    return Array.from(resolved.values());
  });
};

const streamCollectionHydrateOptions = (
  options: HydrateStartPayloadEffectOptions
): HydrateStartPayloadEffectOptions => ({
  ...options,
  replace: false
});

const runHydrationSync = <A, E, RuntimeServices, RuntimeError>(
  effect: Effect.Effect<A, E>,
  runtime: EffectUiRuntime<RuntimeServices, RuntimeError> | AnyEffectUiRuntime<RuntimeError> | undefined
): A =>
  (runtime ?? currentOrDefaultRuntime() as AnyEffectUiRuntime<RuntimeError>).runSync(effect);

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

/**
 * Dehydrates Start collection snapshots into a payload Effect.
 *
 * When no collections are provided the payload is empty. Snapshot codec errors
 * and collection callback failures stay in the Effect error channel so SSR and
 * streaming adapters can report typed hydration failures.
 */
export const collectionHydrationPayloadEffect = (
  options: StartCollectionHydrationOptions = {}
): Effect.Effect<CollectionHydrationPayload, CollectionSnapshotCodecError | EffectInputCallbackError> =>
  options.collections
    ? Collection.dehydrateEffect(options.collections)
    : Effect.succeed(emptyCollectionHydrationPayload);

/** Combines Resource and Collection dehydration output into one Start payload. */
export const createStartHydrationPayload = (
  resources: ResourceHydrationPayload,
  collections: CollectionHydrationPayload = emptyCollectionHydrationPayload
): StartHydrationPayload => ({
  resources: resources.resources,
  ...(collections.collections.length > 0 ? { collections: collections.collections } : {})
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStartHydrationPayload = (value: unknown): value is StartHydrationPayload =>
  isRecord(value) &&
  Array.isArray(value.resources) &&
  (value.collections === undefined || Array.isArray(value.collections));

/** Narrow an unknown value to the current streamed hydration chunk wire format. */
export const isStartHydrationChunk = (value: unknown): value is StartHydrationChunk =>
  isRecord(value) &&
  value._tag === "StartHydrationChunk" &&
  value.version === startHydrationChunkVersion &&
  typeof value.sequence === "number" &&
  Number.isSafeInteger(value.sequence) &&
  value.sequence >= 0 &&
  isStartHydrationPayload(value.payload);

/** Wrap a root hydration payload in a streamed chunk with an explicit sequence. */
export const makeStartHydrationChunk = (
  payload: StartHydrationPayload,
  sequence: number
): StartHydrationChunk => ({
  _tag: "StartHydrationChunk",
  version: startHydrationChunkVersion,
  sequence,
  payload
});

const decodeStartHydrationChunkEffect = (
  value: unknown,
  fallbackSequence: number
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
  cause?: unknown
): StartHydrationChunkParseError =>
  new StartHydrationChunkParseError({
    sequence,
    value,
    ...(cause === undefined ? {} : { cause }),
    guidance: "Emit stream hydration chunks with createStreamHydrationScript or serializeStreamHydrationPayload."
  });

const parseStartHydrationChunkJsonEffect = (
  text: string,
  sequence: number
): Effect.Effect<StartHydrationChunk, StartHydrationChunkParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationChunkParseError(sequence, text, cause)
  }).pipe(
    Effect.flatMap((value) => decodeStartHydrationChunkEffect(value, sequence))
  );

const startHydrationPayloadParseError = (
  id: string,
  value: unknown,
  cause?: unknown
): StartHydrationPayloadParseError =>
  new StartHydrationPayloadParseError({
    id,
    value,
    ...(cause === undefined ? {} : { cause }),
    guidance: "Emit the root hydration payload with createHydrationScript or serializeHydrationPayload."
  });

const decodeStartHydrationPayloadEffect = (
  value: unknown,
  id: string
): Effect.Effect<StartHydrationPayload, StartHydrationPayloadParseError> =>
  isStartHydrationPayload(value)
    ? Effect.succeed(value)
    : Effect.fail(startHydrationPayloadParseError(id, value));

const parseStartHydrationPayloadJsonEffect = (
  text: string,
  id: string
): Effect.Effect<StartHydrationPayload, StartHydrationPayloadParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationPayloadParseError(id, text, cause)
  }).pipe(
    Effect.flatMap((value) => decodeStartHydrationPayloadEffect(value, id))
  );

const startHydrationChunkFrom = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence: number
): StartHydrationChunk =>
  isStartHydrationChunk(input) ? input : makeStartHydrationChunk(input, sequence);

const startHydrationPayloadSerializeError = (
  operation: StartHydrationPayloadSerializeError["operation"],
  value: unknown,
  cause: unknown
): StartHydrationPayloadSerializeError =>
  new StartHydrationPayloadSerializeError({
    operation,
    value,
    cause,
    guidance: "Start hydration payloads must contain JSON-serializable Resource and Collection state."
  });

const encodeStartHydrationValueEffect = (
  value: StartHydrationPayload | StartHydrationChunk,
  operation: StartHydrationPayloadSerializeError["operation"]
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  Effect.try({
    try: () => JSON.stringify(value),
    catch: (cause) => startHydrationPayloadSerializeError(operation, value, cause)
  }).pipe(
    Effect.map(escapeJsonForHtml)
  );

/** Encode a root hydration payload as HTML-safe JSON inside Effect. */
export const encodeStartHydrationPayloadEffect = (
  payload: StartHydrationPayload
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationValueEffect(payload, "root-payload");

/** Encode one streamed hydration chunk as HTML-safe JSON inside Effect. */
export const encodeStartHydrationChunkEffect = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationValueEffect(startHydrationChunkFrom(input, sequence), "stream-chunk");

/** Sort streamed hydration chunks by sequence, preserving input order for ties. */
export const sortStartHydrationChunks = (
  chunks: Iterable<StartHydrationChunk>
): ReadonlyArray<StartHydrationChunk> =>
  Array.from(chunks, (chunk, index) => ({ chunk, index }))
    .sort((left, right) =>
      left.chunk.sequence === right.chunk.sequence
        ? left.index - right.index
        : left.chunk.sequence - right.chunk.sequence
    )
    .map(({ chunk }) => chunk);

/** Merge several root or streamed payloads into one Resource/Collection payload. */
export const mergeStartHydrationPayloads = (
  payloads: Iterable<StartHydrationPayload>
): StartHydrationPayload => {
  const resources: Array<StartHydrationPayload["resources"][number]> = [];
  const collections: Array<NonNullable<StartHydrationPayload["collections"]>[number]> = [];

  for (const payload of payloads) {
    resources.push(...payload.resources);
    if (payload.collections) {
      collections.push(...payload.collections);
    }
  }

  return {
    resources,
    ...(collections.length > 0 ? { collections } : {})
  };
};

/** Serialize a root hydration payload as HTML-safe JSON. */
export const serializeHydrationPayload = (payload: StartHydrationPayload): string =>
  runStartHydrationTransportSync(encodeStartHydrationPayloadEffect(payload));

/** Create the root hydration script tag inside Effect. */
export const createHydrationScriptEffect = (
  payload: StartHydrationPayload,
  id = hydrationScriptId
): Effect.Effect<string, StartHydrationPayloadSerializeError> =>
  encodeStartHydrationPayloadEffect(payload).pipe(
    Effect.map((encoded) => `<script type="application/json" id="${escapeHtmlAttribute(id)}">${encoded}</script>`)
  );

/** Create the root hydration script tag emitted during SSR. */
export const createHydrationScript = (
  payload: StartHydrationPayload,
  id = hydrationScriptId
): string => runStartHydrationTransportSync(createHydrationScriptEffect(payload, id));

/** Serialize one streamed hydration chunk as HTML-safe JSON. */
export const serializeStreamHydrationPayload = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => runStartHydrationTransportSync(encodeStartHydrationChunkEffect(input, sequence));

/** Create a streamed hydration script tag inside Effect. */
export const createStreamHydrationScriptEffect = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): Effect.Effect<string, StartHydrationPayloadSerializeError> => {
  const chunk = startHydrationChunkFrom(input, sequence);
  return encodeStartHydrationChunkEffect(chunk).pipe(
    Effect.map((encoded) =>
      `<script type="${streamHydrationScriptType}" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="${chunk.sequence}">${encoded}</script>`
    )
  );
};

/** Create a streamed hydration script tag with chunk marker and sequence attributes. */
export const createStreamHydrationScript = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => runStartHydrationTransportSync(createStreamHydrationScriptEffect(input, sequence));

/** Read and parse the root hydration payload from a document. */
export const readHydrationPayload = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId
): StartHydrationPayload | undefined =>
  runStartHydrationTransportSync(readHydrationPayloadEffect(document, id));

/** Effect-first reader for the root hydration payload. */
export const readHydrationPayloadEffect = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId
): Effect.Effect<StartHydrationPayload | undefined, StartHydrationPayloadParseError> => {
  const text = readStartHydrationScriptText(document, id);
  return text === undefined
    ? Effect.succeed(undefined)
    : parseStartHydrationPayloadJsonEffect(text, id);
};

const sortStartHydrationChunkElements = (
  entries: Iterable<StartHydrationChunkElement>
): ReadonlyArray<StartHydrationChunkElement> =>
  Array.from(entries).sort((left, right) =>
    left.chunk.sequence === right.chunk.sequence
      ? left.index - right.index
      : left.chunk.sequence - right.chunk.sequence
  );

const readStartHydrationChunkElements = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): ReadonlyArray<StartHydrationChunkElement> =>
  runStartHydrationTransportSync(readStartHydrationChunkElementsEffect(document, options));

const readStartHydrationChunkElementsEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): Effect.Effect<ReadonlyArray<StartHydrationChunkElement>, StartHydrationChunkParseError> =>
  Effect.forEach(
    readStartHydrationChunkScriptElements(document, options),
    ({ element, index, sequence, text }) =>
      parseStartHydrationChunkJsonEffect(text, sequence).pipe(
        Effect.map((chunk): StartHydrationChunkElement => ({
          element,
          index,
          chunk
        }))
      )
  ).pipe(
    Effect.map(sortStartHydrationChunkElements)
  );

/** Read streamed hydration chunks from a document without applying them. */
export const readStartHydrationChunks = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): ReadonlyArray<StartHydrationChunk> =>
  readStartHydrationChunkElements(document, options).map(({ chunk }) => chunk);

/** Effect-first reader for streamed hydration chunks from a document. */
export const readStartHydrationChunksEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): Effect.Effect<ReadonlyArray<StartHydrationChunk>, StartHydrationChunkParseError> =>
  readStartHydrationChunkElementsEffect(document, options).pipe(
    Effect.map((entries) => entries.map(({ chunk }) => chunk))
  );

/**
 * Applies a Start hydration payload inside Effect.
 *
 * Malformed resource or collection snapshots fail as typed codec errors; host
 * adapters should keep those failures instead of catching them as `unknown`.
 */
export const hydrateStartPayloadEffect = (
  payload: StartHydrationPayload,
  options: HydrateStartPayloadEffectOptions = {}
): Effect.Effect<void, StartHydrationCodecError> =>
  Effect.gen(function* () {
    yield* validateResourceHydrationInputEffect(payload);
    const collections = yield* collectionsForHydrationPayloadEffect(payload, options);
    if (payload.collections && collections.length > 0) {
      yield* Collection.validateHydrationPayloadEffect(
        collections,
        { collections: payload.collections }
      );
    }
    yield* Resource.hydrateEffect(payload);
    if (payload.collections && collections.length > 0) {
      yield* Collection.hydratePayloadEffect(
        collections,
        { collections: payload.collections },
        collectionHydrateOptions(options)
      );
    }
  });

/**
 * Applies streamed hydration chunks in sequence inside Effect.
 *
 * The atomic unit is one Start hydration payload. A malformed later chunk fails
 * the Effect without rolling back earlier successfully-applied chunks.
 */
export const hydrateStartHydrationChunksEffect = (
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadEffectOptions = {}
): Effect.Effect<void, StartHydrationCodecError> =>
  Effect.forEach(
    sortStartHydrationChunks(chunks),
    (chunk) => hydrateStartPayloadEffect(chunk.payload, streamCollectionHydrateOptions(options)),
    { discard: true }
  );

/** Synchronous host-seam facade for applying streamed hydration chunks. */
export const hydrateStartHydrationChunks = <RuntimeServices = never, RuntimeError = never>(
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadOptions<RuntimeServices, RuntimeError> = {}
): ReadonlyArray<StartHydrationChunk> => {
  const sorted = sortStartHydrationChunks(chunks);
  runHydrationSync(hydrateStartHydrationChunksEffect(sorted, options), options.runtime);
  return sorted;
};

/**
 * Reads document stream chunks and applies them inside Effect.
 *
 * Chunks are marked consumed only after the full read/apply pass succeeds. If a
 * later chunk fails, earlier chunks may already be hydrated and will remain
 * unmarked so callers can retry the scan after fixing the document/source.
 */
export const hydrateStartHydrationChunksFromDocumentEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentEffectOptions = {}
): Effect.Effect<ReadonlyArray<StartHydrationChunk>, StartHydrationError> =>
  Effect.gen(function* () {
    const entries = yield* readStartHydrationChunkElementsEffect(document, options);
    const chunks = entries.map(({ chunk }) => chunk);

    if (chunks.length > 0) {
      yield* hydrateStartHydrationChunksEffect(chunks, options);

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

/** Synchronous host-seam facade for reading and applying document stream chunks. */
export const hydrateStartHydrationChunksFromDocument = <RuntimeServices = never, RuntimeError = never>(
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentOptions<RuntimeServices, RuntimeError> = {}
): ReadonlyArray<StartHydrationChunk> =>
  runHydrationSync(
    hydrateStartHydrationChunksFromDocumentEffect(document, options),
    options.runtime
  );

/** Synchronous host-seam facade for applying one Start hydration payload. */
export const hydrateStartPayload = <RuntimeServices = never, RuntimeError = never>(
  payload: StartHydrationPayload,
  options: HydrateStartPayloadOptions<RuntimeServices, RuntimeError> = {}
): StartHydrationPayload => {
  runHydrationSync(hydrateStartPayloadEffect(payload, options), options.runtime);
  return payload;
};

/**
 * Read the root payload and streamed chunks from a document, then hydrate them
 * in Effect.
 *
 * Root payload hydration runs before streamed chunks. Streamed chunks then use
 * the progressive semantics of `hydrateStartHydrationChunksFromDocumentEffect`.
 */
export const hydrateFromDocumentEffect = (
  document: StartHydrationDocument = globalThis.document,
  id = hydrationScriptId,
  options: HydrateFromDocumentEffectOptions = {}
): Effect.Effect<StartHydrationPayload | undefined, StartHydrationError> =>
  Effect.gen(function* () {
    const payload = yield* readHydrationPayloadEffect(document, id);
    if (payload) {
      yield* hydrateStartPayloadEffect(payload, options);
    }

    const chunks = yield* hydrateStartHydrationChunksFromDocumentEffect(document, options);

    if (payload === undefined && chunks.length === 0) {
      return undefined;
    }

    return mergeStartHydrationPayloads([
      ...(payload === undefined ? [] : [payload]),
      ...chunks.map((chunk) => chunk.payload)
    ]);
  });

/** Synchronous host-seam facade for full document hydration. */
export const hydrateFromDocument = <RuntimeServices = never, RuntimeError = never>(
  document: StartHydrationDocument = globalThis.document,
  id = hydrationScriptId,
  options: HydrateFromDocumentOptions<RuntimeServices, RuntimeError> = {}
): StartHydrationPayload | undefined =>
  runHydrationSync(hydrateFromDocumentEffect(document, id, options), options.runtime);
