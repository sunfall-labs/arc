import { Data } from "effect";

type RouteParamTokenBase<S extends string> = S extends `${infer Base}.${string}` ? Base : S;

export type StripRouteParamName<S extends string> =
  RouteParamTokenBase<S> extends `${infer Name}?` ? Name : RouteParamTokenBase<S>;

type IsOptionalRouteParamToken<S extends string> =
  RouteParamTokenBase<S> extends `${string}?` ? true : false;

export type RoutePathParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? StripRouteParamName<Param> | RoutePathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? StripRouteParamName<Param>
      : never;

export type OptionalRoutePathParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ?
        | (IsOptionalRouteParamToken<Param> extends true ? StripRouteParamName<Param> : never)
        | OptionalRoutePathParamNames<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? IsOptionalRouteParamToken<Param> extends true
        ? StripRouteParamName<Param>
        : never
      : never;

export type RequiredRoutePathParamNames<Path extends string> = Exclude<
  RoutePathParamNames<Path>,
  OptionalRoutePathParamNames<Path>
>;

/**
 * Object shape inferred from a route path's `:param` grammar.
 *
 * Required params become required string fields and `:param?` segments become
 * optional string fields.
 */
export type ParamsForPath<Path extends string> = [RoutePathParamNames<Path>] extends [never]
  ? Record<string, never>
  : { readonly [K in RequiredRoutePathParamNames<Path>]: string } & {
      readonly [K in OptionalRoutePathParamNames<Path>]?: string;
    };

/** A parsed segment in the shared Sunfall Arc route path grammar. */
export type RoutePathSegment =
  | {
      readonly _tag: "Static";
      readonly value: string;
    }
  | {
      readonly _tag: "Dynamic";
      readonly name: string;
      readonly optional: boolean;
    };

/** Metadata for a dynamic `:param` route segment. */
export interface RoutePathParam {
  readonly name: string;
  readonly optional: boolean;
}

export class MissingRouteParam extends Data.TaggedError("MissingRouteParam")<{
  readonly route: string;
  readonly param: string;
}> {}

export class InvalidRouteParam extends Data.TaggedError("InvalidRouteParam")<{
  readonly route: string;
  readonly segment: string;
  readonly param: string;
}> {}

export class DuplicateRouteParam extends Data.TaggedError("DuplicateRouteParam")<{
  readonly route: string;
  readonly param: string;
}> {}

const splitPath = (path: string): ReadonlyArray<string> =>
  path.split("/").filter((part) => part.length > 0);

const routeParamTokenBase = (name: string): string => {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
};

const isOptionalRouteParamToken = (name: string): boolean =>
  routeParamTokenBase(name).endsWith("?");

const stripRouteParamName = (name: string): string => {
  const base = routeParamTokenBase(name);
  return base.endsWith("?") ? base.slice(0, -1) : base;
};

const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Returns true when a value is a valid route param identifier. */
export const isRouteParamName = (value: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

/** Parses and validates a `/:param` route path into normalized grammar segments. */
export const parseRoutePathSegments = (path: string): readonly RoutePathSegment[] => {
  const params = new Set<string>();
  return splitPath(path).map((part) => {
    if (!part.startsWith(":")) {
      return {
        _tag: "Static",
        value: part,
      };
    }

    const token = part.slice(1);
    const name = stripRouteParamName(token);
    if (!isRouteParamName(name)) {
      throw new InvalidRouteParam({
        route: path,
        segment: part,
        param: name,
      });
    }
    if (params.has(name)) {
      throw new DuplicateRouteParam({ route: path, param: name });
    }
    params.add(name);

    return {
      _tag: "Dynamic",
      name,
      optional: isOptionalRouteParamToken(token),
    };
  });
};

/** Builds a canonical route path from parsed route grammar segments. */
export const routePathFromSegments = (segments: readonly RoutePathSegment[]): string => {
  if (segments.length === 0) {
    return "/";
  }

  return segments
    .map((segment) =>
      segment._tag === "Static"
        ? `/${segment.value}`
        : `/:${segment.name}${segment.optional ? "?" : ""}`,
    )
    .join("");
};

/** Extracts dynamic param metadata from parsed route grammar segments. */
export const routeParamsFromSegments = (
  segments: readonly RoutePathSegment[],
): readonly RoutePathParam[] =>
  segments.flatMap((segment) =>
    segment._tag === "Dynamic"
      ? [
          {
            name: segment.name,
            optional: segment.optional,
          },
        ]
      : [],
  );

/** Stable identifier slug for generated route maps and file-route artifacts. */
export const routePathSlug = (routePath: string): string => {
  const slug = parseRoutePathSegments(routePath)
    .map((segment) =>
      segment._tag === "Static"
        ? segment.value
        : `$${segment.name}${segment.optional ? "_optional" : ""}`,
    )
    .join("_")
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "root";
};

/** Compares route segments with static segments before dynamic segments. */
export const compareRoutePathSegment = (
  left: RoutePathSegment | undefined,
  right: RoutePathSegment | undefined,
): number => {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  if (left._tag !== right._tag) {
    return left._tag === "Static" ? -1 : 1;
  }

  if (left._tag === "Static" && right._tag === "Static") {
    return compareString(left.value, right.value);
  }

  if (left._tag === "Dynamic" && right._tag === "Dynamic") {
    if (left.optional !== right.optional) {
      return left.optional ? 1 : -1;
    }
    return compareString(left.name, right.name);
  }

  return 0;
};

const routePathSpecificity = (
  segments: readonly RoutePathSegment[],
): {
  readonly staticCount: number;
  readonly requiredDynamicCount: number;
  readonly optionalDynamicCount: number;
} => {
  let staticCount = 0;
  let requiredDynamicCount = 0;
  let optionalDynamicCount = 0;

  for (const segment of segments) {
    if (segment._tag === "Static") {
      staticCount++;
    } else if (segment.optional) {
      optionalDynamicCount++;
    } else {
      requiredDynamicCount++;
    }
  }

  return {
    staticCount,
    requiredDynamicCount,
    optionalDynamicCount,
  };
};

/**
 * Compares route paths by match specificity while preserving caller order for
 * same-shape routes.
 */
export const compareRoutePathSpecificity = (
  left: readonly RoutePathSegment[],
  right: readonly RoutePathSegment[],
): number => {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (!leftSegment || !rightSegment) {
      continue;
    }

    if (leftSegment._tag !== rightSegment._tag) {
      return leftSegment._tag === "Static" ? -1 : 1;
    }

    if (
      leftSegment._tag === "Dynamic" &&
      rightSegment._tag === "Dynamic" &&
      leftSegment.optional !== rightSegment.optional
    ) {
      return leftSegment.optional ? 1 : -1;
    }
  }

  const leftSpecificity = routePathSpecificity(left);
  const rightSpecificity = routePathSpecificity(right);
  if (leftSpecificity.staticCount !== rightSpecificity.staticCount) {
    return rightSpecificity.staticCount - leftSpecificity.staticCount;
  }
  if (leftSpecificity.requiredDynamicCount !== rightSpecificity.requiredDynamicCount) {
    return rightSpecificity.requiredDynamicCount - leftSpecificity.requiredDynamicCount;
  }
  if (leftSpecificity.optionalDynamicCount !== rightSpecificity.optionalDynamicCount) {
    return leftSpecificity.optionalDynamicCount - rightSpecificity.optionalDynamicCount;
  }

  return 0;
};

/** Returns true when two route grammar segments describe the same path part. */
export const routePathSegmentsEqual = (
  left: RoutePathSegment,
  right: RoutePathSegment,
): boolean => {
  if (left._tag !== right._tag) {
    return false;
  }
  if (left._tag === "Static" && right._tag === "Static") {
    return left.value === right.value;
  }
  return (
    left._tag === "Dynamic" &&
    right._tag === "Dynamic" &&
    left.name === right.name &&
    left.optional === right.optional
  );
};

/** Returns true when one segment list is a route-grammar prefix of another. */
export const isRoutePathSegmentPrefix = (
  prefix: readonly RoutePathSegment[],
  value: readonly RoutePathSegment[],
): boolean =>
  prefix.length <= value.length &&
  prefix.every((segment, index) => {
    const target = value[index];
    return target !== undefined && routePathSegmentsEqual(segment, target);
  });

/** Matches a pathname against a route pattern and returns decoded params. */
export const matchRoutePath = (
  pattern: string,
  pathname: string,
): Record<string, string> | undefined => {
  const patternParts = parseRoutePathSegments(pattern);
  const currentParts = splitPath(pathname);

  const match = (
    patternIndex: number,
    currentIndex: number,
    params: Record<string, string>,
  ): Record<string, string> | undefined => {
    if (patternIndex === patternParts.length) {
      return currentIndex === currentParts.length ? params : undefined;
    }

    const patternPart = patternParts[patternIndex];
    const currentPart = currentParts[currentIndex];

    if (!patternPart) {
      return undefined;
    }

    if (patternPart._tag === "Static") {
      return currentPart === patternPart.value
        ? match(patternIndex + 1, currentIndex + 1, params)
        : undefined;
    }

    if (currentPart !== undefined) {
      const consumed = match(patternIndex + 1, currentIndex + 1, {
        ...params,
        [patternPart.name]: decodeURIComponent(currentPart),
      });
      if (consumed) {
        return consumed;
      }
    }

    return patternPart.optional ? match(patternIndex + 1, currentIndex, params) : undefined;
  };

  return match(0, 0, {});
};

/** Builds a pathname from a route pattern and path params. */
export const buildRoutePath = (path: string, params: Record<string, unknown>): string => {
  const parts = parseRoutePathSegments(path).flatMap((part) => {
    if (part._tag === "Static") {
      return [part.value];
    }

    const value = params[part.name];
    if (value === undefined || value === null) {
      if (part.optional) {
        return [];
      }
      throw new MissingRouteParam({ route: path, param: part.name });
    }

    return [encodeURIComponent(String(value))];
  });

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
};

/** Parses strings and URL objects with the same base URL used by route matching. */
export const parseRouteUrl = (input: string | URL): URL => {
  if (input instanceof URL) {
    return input;
  }

  return new URL(input, "http://sunfall-arc.local");
};

/** Preserves just the path and search components from a route input. */
export const hrefForRouteInput = (input: string | URL): string => {
  const url = parseRouteUrl(input);
  return `${url.pathname}${url.search}`;
};
