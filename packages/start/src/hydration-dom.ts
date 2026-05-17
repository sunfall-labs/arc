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
    selectors: string,
  ): Iterable<StartHydrationScriptElement> | ArrayLike<StartHydrationScriptElement>;
}

/** Minimal document shape required for root and streamed hydration. */
export interface StartHydrationDocument
  extends Pick<Document, "getElementById">, StartHydrationChunkDocument {}

/** Raw script element prepared for streamed hydration chunk parsing. */
export interface StartHydrationChunkScriptElement {
  /** DOM element that carried the streamed hydration chunk. */
  readonly element: StartHydrationScriptElement;
  /** DOM order used to preserve stable ordering when chunk sequences tie. */
  readonly index: number;
  /** Sequence read from the element attribute, or DOM order when missing/invalid. */
  readonly sequence: number;
  /** Raw JSON text to parse as a streamed hydration chunk or legacy root payload. */
  readonly text: string;
}

const readElementSequence = (element: StartHydrationScriptElement, fallback: number): number => {
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
  options: ReadStartHydrationChunksOptions,
): boolean => {
  const raw = element.getAttribute?.(consumedAttributeFrom(options));
  return raw !== undefined && raw !== null;
};

/** Read the raw JSON text from the root Start hydration script. */
export const readStartHydrationScriptText = (
  document: Pick<Document, "getElementById">,
  id = hydrationScriptId,
): string | undefined => {
  const element = document.getElementById(id);
  return element === null ? undefined : (element.textContent ?? "");
};

/** Read raw streamed hydration script elements without parsing their JSON. */
export const readStartHydrationChunkScriptElements = (
  document: StartHydrationChunkDocument,
  options: ReadStartHydrationChunksOptions = {},
): ReadonlyArray<StartHydrationChunkScriptElement> => {
  const elements = document.querySelectorAll?.(`[${streamHydrationAttribute}]`);
  if (!elements) {
    return [];
  }

  const chunks: Array<StartHydrationChunkScriptElement> = [];
  Array.from(elements).forEach((element, index) => {
    if (!options.includeConsumed && isConsumedElement(element, options)) {
      return;
    }

    chunks.push({
      element,
      index,
      sequence: readElementSequence(element, index),
      text: element.textContent ?? "",
    });
  });

  return chunks;
};

/** Mark a streamed hydration chunk element as consumed after a successful apply. */
export const markStartHydrationChunkElementConsumed = (
  element: StartHydrationScriptElement,
  options: ReadStartHydrationChunksOptions = {},
): void => {
  element.setAttribute?.(consumedAttributeFrom(options), "true");
};
