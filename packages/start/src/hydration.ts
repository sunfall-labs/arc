import {
  currentOrDefaultRuntime,
  Resource,
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
  type CollectionSnapshotCodecError
} from "@effect-ui/db";
import { Data, Effect, Schema } from "effect";

/** Default DOM id for the root Start hydration payload script. */
export const hydrationScriptId = "__EFFECT_UI_HYDRATION__";
/** Attribute that marks streamed Start hydration chunk script elements. */
export const streamHydrationAttribute = "data-effect-ui-hydration-chunk";
/** Attribute storing a streamed hydration chunk's stable ordering sequence. */
export const streamHydrationSequenceAttribute = "data-effect-ui-hydration-sequence";
/** Attribute used to skip already-applied streamed hydration chunks. */
export const streamHydrationConsumedAttribute = "data-effect-ui-hydration-consumed";
/** Script MIME type used for JSON hydration payloads and streamed chunks. */
export const streamHydrationScriptType = "application/json";
/** Wire-format version for streamed Start hydration chunks. */
export const startHydrationChunkVersion = 1;

/** Codec errors that can occur while applying decoded hydration snapshots. */
export type StartHydrationCodecError =
  | CollectionSnapshotCodecError
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
 * Typed failures emitted by Effect-first Start hydration helpers.
 *
 * Snapshot codec errors report malformed Resource/Collection payloads. Payload
 * and chunk parse errors report malformed hydration script contents before any
 * Resource or Collection hydration runs.
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
export interface StartCollectionHydrationOptions {
  /** Collection definitions that can receive collection snapshots from payloads. */
  readonly collections?: Iterable<AnyCollection>;
}

/** Effect-first options for applying a Start hydration payload. */
export interface HydrateStartPayloadEffectOptions
  extends StartCollectionHydrationOptions, CollectionHydrateOptions {}

/** Synchronous host-boundary options for applying a Start hydration payload. */
export interface HydrateStartPayloadOptions<RuntimeError = never> extends HydrateStartPayloadEffectOptions {
  /** Runtime used by the synchronous host-boundary hydration facade. */
  readonly runtime?: EffectUiRuntime<unknown, RuntimeError>;
}

/**
 * Options for reading streamed hydration chunks from a rendered document.
 *
 * By default consumed chunks are skipped; `includeConsumed` rereads them, and
 * `consumedAttribute` customizes the marker attribute.
 */
export interface ReadStartHydrationChunksOptions {
  /** Include chunks already marked with the consumed attribute. Defaults to false. */
  readonly includeConsumed?: boolean;
  /** Custom marker attribute used to skip already-applied chunks. */
  readonly consumedAttribute?: string;
}

/**
 * Options for applying streamed hydration chunks from a document.
 *
 * `markConsumed` defaults to true when hydrating from a document so repeated
 * hydration passes skip chunks that were already applied.
 */
export interface HydrateStartHydrationChunksFromDocumentEffectOptions
  extends HydrateStartPayloadEffectOptions, ReadStartHydrationChunksOptions {
  /** Mark applied chunk elements as consumed. Defaults to true for document hydration. */
  readonly markConsumed?: boolean;
}

export interface HydrateStartHydrationChunksFromDocumentOptions<RuntimeError = never>
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {
  /** Runtime used by the synchronous host-boundary hydration facade. */
  readonly runtime?: EffectUiRuntime<unknown, RuntimeError>;
}

/** Effect-first options for reading and applying the document hydration script. */
export interface HydrateFromDocumentEffectOptions
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {}

/** Synchronous host-boundary options for reading and applying the document hydration script. */
export interface HydrateFromDocumentOptions<RuntimeError = never> extends HydrateFromDocumentEffectOptions {
  /** Runtime used by the synchronous host-boundary document hydration facade. */
  readonly runtime?: EffectUiRuntime<unknown, RuntimeError>;
}

/** Options for preloading request-time collections into the Start hydration payload. */
export interface PreloadRequestOptions extends StartCollectionHydrationOptions {}

/** Minimal DOM script element shape used by hydration readers. */
export interface StartHydrationScriptElement {
  /** Text content containing escaped JSON. */
  readonly textContent: string | null;
  /** Reads marker and sequence attributes when present. */
  getAttribute?(name: string): string | null;
  /** Marks a streamed chunk as consumed after hydration. */
  setAttribute?(name: string, value: string): void;
}

/** Minimal document shape required to read streamed hydration chunks. */
export interface StartHydrationChunkDocument {
  /** Finds streamed hydration chunk script elements. */
  querySelectorAll?(
    selectors: string
  ): Iterable<StartHydrationScriptElement> | ArrayLike<StartHydrationScriptElement>;
}

/** Minimal document shape required for root and streamed hydration. */
export interface StartHydrationDocument
  extends Pick<Document, "getElementById">, StartHydrationChunkDocument {}

interface StartHydrationChunkElement {
  readonly chunk: StartHydrationChunk;
  readonly element: StartHydrationScriptElement;
  readonly index: number;
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

const collectionHydrateOptions = (
  options: HydrateStartPayloadEffectOptions
): CollectionHydrateOptions => ({
  ...(options.replace === undefined ? {} : { replace: options.replace })
});

const streamCollectionHydrateOptions = (
  options: HydrateStartPayloadEffectOptions
): HydrateStartPayloadEffectOptions => ({
  ...options,
  replace: false
});

const runHydrationSync = <A, E, RuntimeError>(
  effect: Effect.Effect<A, E>,
  runtime: EffectUiRuntime<unknown, RuntimeError> | undefined
): A =>
  (runtime ?? currentOrDefaultRuntime()).runSync(effect);

export const collectionHydrationPayloadEffect = (
  options: StartCollectionHydrationOptions = {}
): Effect.Effect<CollectionHydrationPayload> =>
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
  isRecord(value) && Array.isArray(value.resources);

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

const parseStartHydrationChunk = (
  value: unknown,
  fallbackSequence: number
): StartHydrationChunk => {
  if (isStartHydrationChunk(value)) {
    return value;
  }

  if (isStartHydrationPayload(value)) {
    return makeStartHydrationChunk(value, fallbackSequence);
  }

  throw startHydrationChunkParseError(fallbackSequence, value);
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

const parseStartHydrationChunkJson = (
  text: string,
  sequence: number
): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw startHydrationChunkParseError(sequence, text, cause);
  }
};

const parseStartHydrationChunkJsonEffect = (
  text: string,
  sequence: number
): Effect.Effect<unknown, StartHydrationChunkParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationChunkParseError(sequence, text, cause)
  });

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

const parseStartHydrationPayloadJson = (
  text: string,
  id: string
): StartHydrationPayload => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw startHydrationPayloadParseError(id, text, cause);
  }

  if (isStartHydrationPayload(value)) {
    return value;
  }

  throw startHydrationPayloadParseError(id, value);
};

const parseStartHydrationPayloadJsonEffect = (
  text: string,
  id: string
): Effect.Effect<StartHydrationPayload, StartHydrationPayloadParseError> =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => startHydrationPayloadParseError(id, text, cause)
  }).pipe(
    Effect.flatMap((value) =>
      isStartHydrationPayload(value)
        ? Effect.succeed(value)
        : Effect.fail(startHydrationPayloadParseError(id, value))
    )
  );

const startHydrationChunkFrom = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence: number
): StartHydrationChunk =>
  isStartHydrationChunk(input) ? input : makeStartHydrationChunk(input, sequence);

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
  escapeJsonForHtml(JSON.stringify(payload));

/** Create the root hydration script tag emitted during SSR. */
export const createHydrationScript = (
  payload: StartHydrationPayload,
  id = hydrationScriptId
): string => `<script type="application/json" id="${id}">${serializeHydrationPayload(payload)}</script>`;

/** Serialize one streamed hydration chunk as HTML-safe JSON. */
export const serializeStreamHydrationPayload = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => escapeJsonForHtml(JSON.stringify(startHydrationChunkFrom(input, sequence)));

/** Create a streamed hydration script tag with chunk marker and sequence attributes. */
export const createStreamHydrationScript = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => {
  const chunk = startHydrationChunkFrom(input, sequence);
  return `<script type="${streamHydrationScriptType}" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="${chunk.sequence}">${serializeStreamHydrationPayload(chunk)}</script>`;
};

/** Read and parse the root hydration payload from a document. */
export const readHydrationPayload = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId
): StartHydrationPayload | undefined => {
  const element = document.getElementById(id);
  if (!element?.textContent) {
    return undefined;
  }

  return parseStartHydrationPayloadJson(element.textContent, id);
};

/** Effect-first reader for the root hydration payload. */
export const readHydrationPayloadEffect = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId
): Effect.Effect<StartHydrationPayload | undefined, StartHydrationPayloadParseError> => {
  const element = document.getElementById(id);
  return !element?.textContent
    ? Effect.succeed(undefined)
    : parseStartHydrationPayloadJsonEffect(element.textContent, id);
};

const readElementSequence = (
  element: StartHydrationScriptElement,
  fallback: number
): number => {
  const raw = element.getAttribute?.(streamHydrationSequenceAttribute);
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const sequence = Number(raw);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : fallback;
};

const consumedAttributeFrom = (options: ReadStartHydrationChunksOptions): string =>
  options.consumedAttribute ?? streamHydrationConsumedAttribute;

const isConsumedElement = (
  element: StartHydrationScriptElement,
  options: ReadStartHydrationChunksOptions
): boolean => {
  const raw = element.getAttribute?.(consumedAttributeFrom(options));
  return raw !== undefined && raw !== null;
};

const markConsumedElement = (
  element: StartHydrationScriptElement,
  options: ReadStartHydrationChunksOptions
): void => {
  element.setAttribute?.(consumedAttributeFrom(options), "true");
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
): ReadonlyArray<StartHydrationChunkElement> => {
  const elements = document.querySelectorAll?.(`[${streamHydrationAttribute}]`);
  if (!elements) {
    return [];
  }

  const chunks: Array<StartHydrationChunkElement> = [];
  Array.from(elements).forEach((element, index) => {
    if (!element.textContent || (!options.includeConsumed && isConsumedElement(element, options))) {
      return;
    }

    const sequence = readElementSequence(element, index);
    chunks.push({
      element,
      index,
      chunk: parseStartHydrationChunk(
        parseStartHydrationChunkJson(element.textContent, sequence),
        sequence
      )
    });
  });

  return sortStartHydrationChunkElements(chunks);
};

const readStartHydrationChunkElementsEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): Effect.Effect<ReadonlyArray<StartHydrationChunkElement>, StartHydrationChunkParseError> => {
  const elements = document.querySelectorAll?.(`[${streamHydrationAttribute}]`);
  if (!elements) {
    return Effect.succeed([]);
  }

  return Effect.forEach(
    Array.from(elements),
    (element, index) => {
      if (!element.textContent || (!options.includeConsumed && isConsumedElement(element, options))) {
        return Effect.succeed(undefined);
      }

      const sequence = readElementSequence(element, index);
      return parseStartHydrationChunkJsonEffect(element.textContent, sequence).pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => parseStartHydrationChunk(value, sequence),
            catch: (cause) =>
              cause instanceof StartHydrationChunkParseError
                ? cause
                : startHydrationChunkParseError(sequence, value, cause)
          })
        ),
        Effect.map((chunk): StartHydrationChunkElement => ({
          element,
          index,
          chunk
        }))
      );
    }
  ).pipe(
    Effect.map((entries) =>
      sortStartHydrationChunkElements(
        entries.filter((entry): entry is StartHydrationChunkElement => entry !== undefined)
      )
    )
  );
};

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
    yield* Resource.hydrateEffect(payload);
    if (payload.collections && options.collections) {
      yield* Collection.hydratePayloadEffect(
        options.collections,
        { collections: payload.collections },
        collectionHydrateOptions(options)
      );
    }
  });

/** Applies streamed hydration chunks in sequence inside Effect. */
export const hydrateStartHydrationChunksEffect = (
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadEffectOptions = {}
): Effect.Effect<void, StartHydrationCodecError> =>
  Effect.forEach(
    sortStartHydrationChunks(chunks),
    (chunk) => hydrateStartPayloadEffect(chunk.payload, streamCollectionHydrateOptions(options)),
    { discard: true }
  );

/** Synchronous host-boundary facade for applying streamed hydration chunks. */
export const hydrateStartHydrationChunks = <RuntimeError = never>(
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadOptions<RuntimeError> = {}
): ReadonlyArray<StartHydrationChunk> => {
  const sorted = sortStartHydrationChunks(chunks);
  runHydrationSync(hydrateStartHydrationChunksEffect(sorted, options), options.runtime);
  return sorted;
};

/** Reads document stream chunks and applies them inside Effect. */
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
            markConsumedElement(element, options);
          }
        });
      }
    }

    return chunks;
  });

/** Synchronous host-boundary facade for reading and applying document stream chunks. */
export const hydrateStartHydrationChunksFromDocument = <RuntimeError = never>(
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentOptions<RuntimeError> = {}
): ReadonlyArray<StartHydrationChunk> =>
  runHydrationSync(
    hydrateStartHydrationChunksFromDocumentEffect(document, options),
    options.runtime
  );

/** Synchronous host-boundary facade for applying one Start hydration payload. */
export const hydrateStartPayload = <RuntimeError = never>(
  payload: StartHydrationPayload,
  options: HydrateStartPayloadOptions<RuntimeError> = {}
): StartHydrationPayload => {
  runHydrationSync(hydrateStartPayloadEffect(payload, options), options.runtime);
  return payload;
};

/** Read the root payload and streamed chunks from a document, then hydrate them in Effect. */
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

    return payload ?? (chunks.length > 0
      ? mergeStartHydrationPayloads(chunks.map((chunk) => chunk.payload))
      : undefined);
  });

/** Synchronous host-boundary facade for full document hydration. */
export const hydrateFromDocument = <RuntimeError = never>(
  document: StartHydrationDocument = globalThis.document,
  id = hydrationScriptId,
  options: HydrateFromDocumentOptions<RuntimeError> = {}
): StartHydrationPayload | undefined =>
  runHydrationSync(hydrateFromDocumentEffect(document, id, options), options.runtime);
