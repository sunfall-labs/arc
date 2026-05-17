import { describe, expect, it } from "vitest";
import {
  extractStartStaticHtmlLinks,
  normalizeStartStaticPath,
  startStaticPageOutputPath,
  StartStaticPathError,
} from "../src/static-export.js";

describe("static export helpers", () => {
  it("normalizes root-relative page paths", () => {
    expect(normalizeStartStaticPath("/")).toBe("/");
    expect(normalizeStartStaticPath("/cookbook/semantic-invalidation/")).toBe(
      "/cookbook/semantic-invalidation",
    );
    expect(startStaticPageOutputPath("/")).toBe("index.html");
    expect(startStaticPageOutputPath("/cookbook/semantic-invalidation")).toBe(
      "cookbook/semantic-invalidation/index.html",
    );
    expect(
      startStaticPageOutputPath("/cookbook/semantic-invalidation", {
        autoSubfolderIndex: false,
      }),
    ).toBe("cookbook/semantic-invalidation.html");
  });

  it("rejects paths that do not map to one portable output file", () => {
    expect(() => normalizeStartStaticPath("cookbook")).toThrow(StartStaticPathError);
    expect(() => normalizeStartStaticPath("/cookbook?tag=resources")).toThrow(StartStaticPathError);
    expect(() => normalizeStartStaticPath("/cookbook#resources")).toThrow(StartStaticPathError);
    expect(() => normalizeStartStaticPath("https://example.com/cookbook")).toThrow(
      StartStaticPathError,
    );
    expect(() => normalizeStartStaticPath("/../secrets")).toThrow(StartStaticPathError);
  });

  it("extracts crawlable internal links from prerendered HTML", () => {
    const html = `
      <a href="/cookbook">Cookbook</a>
      <a href="/cookbook/resource-from-server-function#example">Recipe</a>
      <a href="semantic-invalidation">Relative</a>
      <a href="/cookbook?tag=resources">Query</a>
      <a href="https://example.com/external">External</a>
      <a href="mailto:hello@example.com">Email</a>
    `;

    expect(
      extractStartStaticHtmlLinks(html, {
        origin: "https://docs.test",
        fromPath: "/cookbook/",
      }),
    ).toEqual([
      "/cookbook",
      "/cookbook/resource-from-server-function",
      "/cookbook/semantic-invalidation",
    ]);
  });
});
