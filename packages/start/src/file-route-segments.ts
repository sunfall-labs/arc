import {
  isRouteParamName,
  routeParamsFromSegments,
  routePathFromSegments,
  routePathSlug,
  type RoutePathParam,
  type RoutePathSegment
} from "@effect-ui/core";
import { Data, Effect, Exit } from "effect";

export type ParsedFileRouteSegment =
  | { readonly _tag: "Ignored" }
  | { readonly _tag: "Valid"; readonly segment: RoutePathSegment }
  | { readonly _tag: "Invalid"; readonly reason: "InvalidParamName" };

export interface DecodedFileRoutePath {
  readonly routeId: string;
  readonly routePath: string;
  readonly segments: readonly RoutePathSegment[];
  readonly params: readonly RoutePathParam[];
}

export class FileRoutePathDecodeInvalidSegment extends Data.TaggedError(
  "FileRoutePathDecodeInvalidSegment"
)<{
  readonly segment: string;
  readonly reason: "InvalidParamName";
}> {}

export class SerializedFileRoutePathDecodeError extends Data.TaggedError(
  "SerializedFileRoutePathDecodeError"
)<{
  readonly message: string;
}> {}

export interface SerializedFileRoutePathFields {
  readonly routeId: string;
  readonly routePath: string;
  readonly segments: readonly unknown[];
  readonly params: readonly unknown[];
}

export interface SerializedFileRoutePathDecodeOptions {
  readonly owner: string;
}

export const isFileRouteGroupSegment = (segment: string): boolean =>
  segment.startsWith("(") && segment.endsWith(")") && segment.length > 2;

export const isFileRoutePathlessSegment = (segment: string): boolean =>
  segment.startsWith("_") && segment.length > 1;

export const parseFileRouteSegment = (segment: string): ParsedFileRouteSegment => {
  if (isFileRouteGroupSegment(segment) || isFileRoutePathlessSegment(segment)) {
    return { _tag: "Ignored" };
  }

  if (!segment.startsWith("$")) {
    return {
      _tag: "Valid",
      segment: {
        _tag: "Static",
        value: segment
      }
    };
  }

  const raw = segment.slice(1);
  const optional = raw.endsWith("?");
  const name = optional ? raw.slice(0, -1) : raw;
  return isRouteParamName(name)
    ? {
        _tag: "Valid",
        segment: {
          _tag: "Dynamic",
          name,
          optional
        }
      }
    : {
        _tag: "Invalid",
        reason: "InvalidParamName"
      };
};

export const fileRouteIdFromRoutePath = (routePath: string): string =>
  routePath === "/"
    ? "route_root"
    : `route_${routePathSlug(routePath)}`;

const decodedPathFromSegments = (
  segments: readonly RoutePathSegment[]
): DecodedFileRoutePath => {
  const routePath = routePathFromSegments(segments);

  return {
    routeId: fileRouteIdFromRoutePath(routePath),
    routePath,
    segments,
    params: routeParamsFromSegments(segments)
  };
};

const decodeFileRoutePathSegmentEffect = (
  segment: string
): Effect.Effect<RoutePathSegment | undefined, FileRoutePathDecodeInvalidSegment> => {
  const parsed = parseFileRouteSegment(segment);
  switch (parsed._tag) {
    case "Ignored":
      return Effect.succeed(undefined);
    case "Valid":
      return Effect.succeed(parsed.segment);
    case "Invalid":
      return Effect.fail(
        new FileRoutePathDecodeInvalidSegment({
          segment,
          reason: parsed.reason
        })
      );
  }
};

export const decodeFileRoutePathEffect = (
  rawSegments: readonly string[]
): Effect.Effect<DecodedFileRoutePath, FileRoutePathDecodeInvalidSegment> =>
  Effect.forEach(rawSegments, decodeFileRoutePathSegmentEffect).pipe(
    Effect.map((segments) =>
      decodedPathFromSegments(
        segments.filter((segment): segment is RoutePathSegment => segment !== undefined)
      )
    )
  );

export const decodeFileRoutePath = (
  rawSegments: readonly string[]
): DecodedFileRoutePath | undefined => {
  const exit = Effect.runSyncExit(decodeFileRoutePathEffect(rawSegments));
  return Exit.isSuccess(exit) ? exit.value : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const decodeSerializedSegment = (
  value: unknown,
  index: number
): Effect.Effect<RoutePathSegment, SerializedFileRoutePathDecodeError> => {
  if (!isRecord(value)) {
    return Effect.fail(
      new SerializedFileRoutePathDecodeError({
        message: `Expected file route segment ${index} to be a record.`
      })
    );
  }

  if (value._tag === "Static" && isNonEmptyString(value.value)) {
    return Effect.succeed({
      _tag: "Static",
      value: value.value
    });
  }

  if (
    value._tag === "Dynamic" &&
    isNonEmptyString(value.name) &&
    isRouteParamName(value.name) &&
    typeof value.optional === "boolean"
  ) {
    return Effect.succeed({
      _tag: "Dynamic",
      name: value.name,
      optional: value.optional
    });
  }

  return Effect.fail(
    new SerializedFileRoutePathDecodeError({
      message: `File route segment ${index} is invalid.`
    })
  );
};

const decodeSerializedParam = (
  value: unknown,
  index: number
): Effect.Effect<RoutePathParam, SerializedFileRoutePathDecodeError> => {
  if (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isRouteParamName(value.name) &&
    typeof value.optional === "boolean"
  ) {
    return Effect.succeed({
      name: value.name,
      optional: value.optional
    });
  }

  return Effect.fail(
    new SerializedFileRoutePathDecodeError({
      message: `File route param ${index} is invalid.`
    })
  );
};

export const decodeSerializedFileRoutePathEffect = (
  value: SerializedFileRoutePathFields,
  options: SerializedFileRoutePathDecodeOptions
): Effect.Effect<DecodedFileRoutePath, SerializedFileRoutePathDecodeError> =>
  Effect.gen(function* () {
    const segments = yield* Effect.forEach(value.segments, decodeSerializedSegment);
    const params = yield* Effect.forEach(value.params, decodeSerializedParam);
    const decoded = decodedPathFromSegments(segments);

    if (
      value.routePath !== decoded.routePath ||
      value.routeId !== decoded.routeId ||
      JSON.stringify(params) !== JSON.stringify(decoded.params)
    ) {
      return yield* Effect.fail(
        new SerializedFileRoutePathDecodeError({
          message: `${options.owner} does not match its segments.`
        })
      );
    }

    return decoded;
  });
