import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  makeRequestContext,
  makeResponseContext,
  ResponseCookieSerializationError,
  serializeResponseCookie,
  type ResponseCookieOptions,
} from "../src/index.js";

const serialize = (name: string, value: string, options?: ResponseCookieOptions) =>
  Effect.runSync(serializeResponseCookie(name, value, options));

const serializeFailure = (
  name: string,
  value: string,
  options?: ResponseCookieOptions,
): ResponseCookieSerializationError => {
  const exit = Effect.runSyncExit(Effect.flip(serializeResponseCookie(name, value, options)));
  if (Exit.isFailure(exit)) {
    throw new Error("expected a typed cookie serialization failure");
  }
  return exit.value;
};

const requestCookies = (cookie: string) =>
  Effect.runSync(makeRequestContext(new Request("https://example.com/", { headers: { cookie } })))
    .cookies;

describe("RequestContext cookies", () => {
  it("parses, decodes, and unquotes Cookie header values", () => {
    const cookies = requestCookies('a=1; b=hello%20world; c="quoted"; d=x=y');
    expect([...cookies]).toEqual([
      ["a", "1"],
      ["b", "hello world"],
      ["c", "quoted"],
      ["d", "x=y"],
    ]);
  });

  it("keeps the first value for duplicate cookie names", () => {
    expect(requestCookies("session=first; session=second").get("session")).toBe("first");
  });

  it("skips empty names and pairs without '='", () => {
    expect([...requestCookies("=orphan; flag; ok=1")]).toEqual([["ok", "1"]]);
  });

  it("returns no cookies without a Cookie header", () => {
    const context = Effect.runSync(makeRequestContext(new Request("https://example.com/")));
    expect(context.cookies.size).toBe(0);
  });
});

describe("serializeResponseCookie", () => {
  it("serializes every supported attribute in Set-Cookie order", () => {
    expect(
      serialize("session", "a b", {
        maxAge: 60,
        domain: "example.com",
        path: "/app",
        priority: "high",
        expires: new Date(Date.UTC(2030, 0, 1)),
        httpOnly: true,
        secure: true,
        partitioned: true,
        sameSite: "None",
      }),
    ).toBe(
      "session=a%20b; Max-Age=60; Domain=example.com; Path=/app; Priority=High; Expires=Tue, 01 Jan 2030 00:00:00 GMT; HttpOnly; Secure; Partitioned; SameSite=None",
    );
  });

  it("normalizes SameSite casing", () => {
    expect(serialize("a", "1", { sameSite: "strict" })).toBe("a=1; SameSite=Strict");
    expect(serialize("a", "1", { sameSite: "Lax" })).toBe("a=1; SameSite=Lax");
    expect(serialize("a", "1", { sameSite: "none" })).toBe("a=1; SameSite=None");
  });

  it("omits false boolean attributes", () => {
    expect(serialize("a", "1", { httpOnly: false, secure: false, partitioned: false })).toBe("a=1");
  });

  it("truncates fractional Max-Age seconds", () => {
    expect(serialize("a", "1", { maxAge: 1.9 })).toBe("a=1; Max-Age=1");
    expect(serialize("a", "1", { maxAge: 0 })).toBe("a=1; Max-Age=0");
  });

  it.each([
    ["a b", "1", {}, "Name"],
    ["a;b", "1", {}, "Name"],
    ["", "1", {}, "Name"],
    ["a", "\uD800", {}, "Value"],
    ["a", "1", { domain: "example.com; Secure" }, "Domain"],
    ["a", "1", { path: "/; HttpOnly" }, "Path"],
    ["a", "1", { path: "/\n" }, "Path"],
    ["a", "1", { maxAge: Number.POSITIVE_INFINITY }, "Max-Age"],
    ["a", "1", { maxAge: Number.NaN }, "Max-Age"],
    ["a", "1", { expires: new Date(Number.NaN) }, "Expires"],
    ["a", "1", { sameSite: "Loose" as never }, "SameSite"],
    ["a", "1", { sameSite: "constructor" as never }, "SameSite"],
  ] satisfies ReadonlyArray<readonly [string, string, ResponseCookieOptions, string]>)(
    "rejects %j=%j %j as a %s error",
    (name, value, options, attribute) => {
      const failure = serializeFailure(name, value, options);
      expect(failure).toBeInstanceOf(ResponseCookieSerializationError);
      expect(failure.attribute).toBe(attribute);
    },
  );

  it("percent-encodes values that contain separators", () => {
    expect(serialize("a", "x;y=z")).toBe("a=x%3By%3Dz");
  });
});

describe("ResponseContext cookies", () => {
  it("accumulates setCookie and deleteCookie headers", () => {
    const context = makeResponseContext();
    Effect.runSync(context.setCookie("theme", "dark", { path: "/" }));
    Effect.runSync(context.deleteCookie("session", { path: "/", sameSite: "lax" }));
    expect(context.cookies).toEqual([
      "theme=dark; Path=/",
      "session=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax",
    ]);
  });
});
