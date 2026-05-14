import {
  currentOrDefaultRuntime,
  Resource,
  type EffectUiRuntime,
  type ResourceHydrationPayload
} from "@effect-ui/core";
import {
  Collection,
  type AnyCollection,
  type CollectionHydrateOptions,
  type CollectionHydrationPayload
} from "@effect-ui/db";
import { Data, Effect } from "effect";

export const hydrationScriptId = "__EFFECT_UI_HYDRATION__";
export const streamHydrationAttribute = "data-effect-ui-hydration-chunk";
export const streamHydrationSequenceAttribute = "data-effect-ui-hydration-sequence";
export const streamHydrationConsumedAttribute = "data-effect-ui-hydration-consumed";
export const streamHydrationScriptType = "application/json";
export const startHydrationChunkVersion = 1;

export interface StartHydrationPayload extends ResourceHydrationPayload {
  readonly collections?: CollectionHydrationPayload["collections"];
}

export interface StartHydrationChunk {
  readonly _tag: "StartHydrationChunk";
  readonly version: typeof startHydrationChunkVersion;
  readonly sequence: number;
  readonly payload: StartHydrationPayload;
}

export interface StartCollectionHydrationOptions {
  readonly collections?: Iterable<AnyCollection>;
}

export interface HydrateStartPayloadEffectOptions
  extends StartCollectionHydrationOptions, CollectionHydrateOptions {}

export interface HydrateStartPayloadOptions extends HydrateStartPayloadEffectOptions {
  readonly runtime?: EffectUiRuntime<any, any>;
}

export interface ReadStartHydrationChunksOptions {
  readonly includeConsumed?: boolean;
  readonly consumedAttribute?: string;
}

export interface HydrateStartHydrationChunksFromDocumentEffectOptions
  extends HydrateStartPayloadEffectOptions, ReadStartHydrationChunksOptions {
  readonly markConsumed?: boolean;
}

export interface HydrateStartHydrationChunksFromDocumentOptions
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {
  readonly runtime?: EffectUiRuntime<any, any>;
}

export interface HydrateFromDocumentEffectOptions
  extends HydrateStartHydrationChunksFromDocumentEffectOptions {}

export interface HydrateFromDocumentOptions extends HydrateFromDocumentEffectOptions {
  readonly runtime?: EffectUiRuntime<any, any>;
}

export interface PreloadRequestOptions extends StartCollectionHydrationOptions {}

export class StartHydrationChunkParseError extends Data.TaggedError(
  "StartHydrationChunkParseError"
)<{
  readonly sequence: number;
  readonly value: unknown;
  readonly guidance: string;
}> {}

export interface StartHydrationScriptElement {
  readonly textContent: string | null;
  getAttribute?(name: string): string | null;
  setAttribute?(name: string, value: string): void;
}

export interface StartHydrationChunkDocument {
  querySelectorAll?(
    selectors: string
  ): Iterable<StartHydrationScriptElement> | ArrayLike<StartHydrationScriptElement>;
}

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

const runHydrationSync = <A>(
  effect: Effect.Effect<A>,
  runtime: EffectUiRuntime<any, any> | undefined
): A =>
  (runtime ?? currentOrDefaultRuntime()).runSync(effect as Effect.Effect<A, never, any>);

export const collectionHydrationPayloadEffect = (
  options: StartCollectionHydrationOptions = {}
): Effect.Effect<CollectionHydrationPayload> =>
  options.collections
    ? Collection.dehydrateEffect(options.collections)
    : Effect.succeed(emptyCollectionHydrationPayload);

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

export const isStartHydrationChunk = (value: unknown): value is StartHydrationChunk =>
  isRecord(value) &&
  value._tag === "StartHydrationChunk" &&
  value.version === startHydrationChunkVersion &&
  typeof value.sequence === "number" &&
  Number.isSafeInteger(value.sequence) &&
  value.sequence >= 0 &&
  isStartHydrationPayload(value.payload);

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

  throw new StartHydrationChunkParseError({
    sequence: fallbackSequence,
    value,
    guidance: "Emit stream hydration chunks with createStreamHydrationScript or serializeStreamHydrationPayload."
  });
};

const startHydrationChunkFrom = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence: number
): StartHydrationChunk =>
  isStartHydrationChunk(input) ? input : makeStartHydrationChunk(input, sequence);

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

export const serializeHydrationPayload = (payload: StartHydrationPayload): string =>
  escapeJsonForHtml(JSON.stringify(payload));

export const createHydrationScript = (
  payload: StartHydrationPayload,
  id = hydrationScriptId
): string => `<script type="application/json" id="${id}">${serializeHydrationPayload(payload)}</script>`;

export const serializeStreamHydrationPayload = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => escapeJsonForHtml(JSON.stringify(startHydrationChunkFrom(input, sequence)));

export const createStreamHydrationScript = (
  input: StartHydrationPayload | StartHydrationChunk,
  sequence = 0
): string => {
  const chunk = startHydrationChunkFrom(input, sequence);
  return `<script type="${streamHydrationScriptType}" ${streamHydrationAttribute} ${streamHydrationSequenceAttribute}="${chunk.sequence}">${serializeStreamHydrationPayload(chunk)}</script>`;
};

export const readHydrationPayload = (
  document: Pick<Document, "getElementById"> = globalThis.document,
  id = hydrationScriptId
): StartHydrationPayload | undefined => {
  const element = document.getElementById(id);
  if (!element?.textContent) {
    return undefined;
  }

  return JSON.parse(element.textContent) as StartHydrationPayload;
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

    chunks.push({
      element,
      index,
      chunk: parseStartHydrationChunk(
        JSON.parse(element.textContent) as unknown,
        readElementSequence(element, index)
      )
    });
  });

  return sortStartHydrationChunkElements(chunks);
};

export const readStartHydrationChunks = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: ReadStartHydrationChunksOptions = {}
): ReadonlyArray<StartHydrationChunk> =>
  readStartHydrationChunkElements(document, options).map(({ chunk }) => chunk);

export const hydrateStartPayloadEffect = (
  payload: StartHydrationPayload,
  options: HydrateStartPayloadEffectOptions = {}
): Effect.Effect<void> =>
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

export const hydrateStartHydrationChunksEffect = (
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadEffectOptions = {}
): Effect.Effect<void> =>
  Effect.forEach(
    sortStartHydrationChunks(chunks),
    (chunk) => hydrateStartPayloadEffect(chunk.payload, streamCollectionHydrateOptions(options)),
    { discard: true }
  );

export const hydrateStartHydrationChunks = (
  chunks: Iterable<StartHydrationChunk>,
  options: HydrateStartPayloadOptions = {}
): ReadonlyArray<StartHydrationChunk> => {
  const sorted = sortStartHydrationChunks(chunks);
  runHydrationSync(hydrateStartHydrationChunksEffect(sorted, options), options.runtime);
  return sorted;
};

export const hydrateStartHydrationChunksFromDocumentEffect = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentEffectOptions = {}
): Effect.Effect<ReadonlyArray<StartHydrationChunk>> =>
  Effect.gen(function* () {
    const entries = readStartHydrationChunkElements(document, options);
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

export const hydrateStartHydrationChunksFromDocument = (
  document: StartHydrationChunkDocument = globalThis.document,
  options: HydrateStartHydrationChunksFromDocumentOptions = {}
): ReadonlyArray<StartHydrationChunk> =>
  runHydrationSync(
    hydrateStartHydrationChunksFromDocumentEffect(document, options),
    options.runtime
  );

export const hydrateStartPayload = (
  payload: StartHydrationPayload,
  options: HydrateStartPayloadOptions = {}
): StartHydrationPayload => {
  runHydrationSync(hydrateStartPayloadEffect(payload, options), options.runtime);
  return payload;
};

export const hydrateFromDocumentEffect = (
  document: StartHydrationDocument = globalThis.document,
  id = hydrationScriptId,
  options: HydrateFromDocumentEffectOptions = {}
): Effect.Effect<StartHydrationPayload | undefined> =>
  Effect.gen(function* () {
    const payload = readHydrationPayload(document, id);
    if (payload) {
      yield* hydrateStartPayloadEffect(payload, options);
    }

    const chunks = yield* hydrateStartHydrationChunksFromDocumentEffect(document, options);

    return payload ?? (chunks.length > 0
      ? mergeStartHydrationPayloads(chunks.map((chunk) => chunk.payload))
      : undefined);
  });

export const hydrateFromDocument = (
  document: StartHydrationDocument = globalThis.document,
  id = hydrationScriptId,
  options: HydrateFromDocumentOptions = {}
): StartHydrationPayload | undefined =>
  runHydrationSync(hydrateFromDocumentEffect(document, id, options), options.runtime);
