import type { EffectInput } from "@effect-ui/core";
import { toEffect } from "@effect-ui/core";
import { Data, Effect, Stream } from "effect";
import {
  createStreamHydrationScript,
  type StartHydrationPayload
} from "./hydration.js";

export {
  createStreamHydrationScript,
  serializeStreamHydrationPayload,
  streamHydrationAttribute,
  streamHydrationConsumedAttribute,
  streamHydrationSequenceAttribute,
  streamHydrationScriptType
} from "./hydration.js";

export type HtmlStreamChunk =
  | {
      readonly _tag: "Html";
      readonly html: string;
    }
  | {
      readonly _tag: "Bytes";
      readonly bytes: Uint8Array;
    }
  | {
      readonly _tag: "Hydration";
      readonly payload: StartHydrationPayload;
      readonly sequence?: number;
    };

export type HtmlStreamInput = string | Uint8Array | HtmlStreamChunk;

export interface HtmlStreamOptions<E = never, R = never> {
  readonly shell: EffectInput<HtmlStreamInput, E, R>;
  readonly chunks?: Stream.Stream<HtmlStreamInput, E, R>;
  readonly tail?: EffectInput<HtmlStreamInput, E, R>;
}

export interface HtmlResponseOptions<E = never, R = never> extends HtmlStreamOptions<E, R> {
  readonly status?: number;
  readonly headers?: HeadersInit;
}

export class StartStreamError<E = never> extends Data.TaggedError("StartStreamError")<{
  readonly reason: "Shell" | "Chunk" | "Tail";
  readonly cause: E;
}> {}

const textEncoder = new TextEncoder();

export const htmlChunk = (html: string): HtmlStreamChunk => ({
  _tag: "Html",
  html
});

export const bytesChunk = (bytes: Uint8Array): HtmlStreamChunk => ({
  _tag: "Bytes",
  bytes
});

export const streamHydrationChunk = (
  payload: StartHydrationPayload,
  options: { readonly sequence?: number } = {}
): HtmlStreamChunk => ({
  _tag: "Hydration",
  payload,
  ...(options.sequence === undefined ? {} : { sequence: options.sequence })
});

const isHtmlStreamChunk = (input: HtmlStreamInput): input is HtmlStreamChunk =>
  typeof input === "object" &&
  input !== null &&
  "_tag" in input &&
  ((input as { readonly _tag?: unknown })._tag === "Html" ||
    (input as { readonly _tag?: unknown })._tag === "Bytes" ||
    (input as { readonly _tag?: unknown })._tag === "Hydration");

const encodeInput = (input: HtmlStreamInput, hydrationSequence = 0): Uint8Array => {
  if (input instanceof Uint8Array) {
    return input;
  }

  if (typeof input === "string") {
    return textEncoder.encode(input);
  }

  if (isHtmlStreamChunk(input)) {
    switch (input._tag) {
      case "Html":
        return textEncoder.encode(input.html);
      case "Bytes":
        return input.bytes;
      case "Hydration":
        return textEncoder.encode(
          createStreamHydrationScript(input.payload, input.sequence ?? hydrationSequence)
        );
    }
  }

  return textEncoder.encode(String(input));
};

const encodeInputWithHydrationSequence = (
  nextSequence: number,
  input: HtmlStreamInput
): readonly [nextSequence: number, chunks: ReadonlyArray<Uint8Array>] => {
  if (isHtmlStreamChunk(input) && input._tag === "Hydration") {
    const sequence = input.sequence ?? nextSequence;
    return [Math.max(nextSequence, sequence + 1), [encodeInput(input, sequence)]];
  }

  return [nextSequence, [encodeInput(input)]];
};

const streamFromEffectInput = <E, R>(
  reason: StartStreamError<E>["reason"],
  input: EffectInput<HtmlStreamInput, E, R>
): Stream.Stream<HtmlStreamInput, StartStreamError<E>, R> =>
  Stream.unwrap(
    toEffect(input).pipe(
      Effect.map((chunk) => Stream.make(chunk)),
      Effect.mapError((cause) => new StartStreamError({ reason, cause }))
    )
  );

const tailStream = <E, R>(
  options: HtmlStreamOptions<E, R>
): Stream.Stream<HtmlStreamInput, StartStreamError<E>, R> =>
  options.tail === undefined
    ? Stream.empty
    : streamFromEffectInput("Tail", options.tail);

export const createHtmlStream = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Stream.Stream<Uint8Array, StartStreamError<E>, R> => {
  const shell = streamFromEffectInput("Shell", options.shell);
  const chunks = (options.chunks ?? Stream.empty).pipe(
    Stream.mapError((cause) => new StartStreamError({ reason: "Chunk", cause }))
  );

  return shell.pipe(
    Stream.concat(chunks),
    Stream.concat(tailStream(options)),
    Stream.mapAccum(() => 0, encodeInputWithHydrationSequence)
  );
};

export const createHtmlStreamEffect = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Effect.Effect<Stream.Stream<Uint8Array, StartStreamError<E>, R>> =>
  Effect.succeed(createHtmlStream(options));

export const createReadableHtmlStreamEffect = <E = never, R = never>(
  options: HtmlStreamOptions<E, R>
): Effect.Effect<ReadableStream<Uint8Array>, never, R> =>
  Effect.flatMap(createHtmlStreamEffect(options), (stream) =>
    Stream.toReadableStreamEffect(stream)
  );

const htmlHeaders = (input: HeadersInit | undefined): Headers => {
  const headers = new Headers(input);
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return headers;
};

export const createHtmlResponseEffect = <E = never, R = never>(
  options: HtmlResponseOptions<E, R>
): Effect.Effect<Response, never, R> =>
  Effect.map(
    createReadableHtmlStreamEffect(options),
    (body) => {
      const init: ResponseInit = {
        headers: htmlHeaders(options.headers)
      };
      if (options.status !== undefined) {
        init.status = options.status;
      }

      return new Response(body, init);
    }
  );
