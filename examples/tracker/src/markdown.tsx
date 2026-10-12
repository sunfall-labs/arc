import { For } from "solid-js";
import type { JSX } from "@solidjs/web";

/*
 * A small Markdown renderer for issue descriptions and comments. It builds
 * JSX, never HTML strings, so text a user typed can never become markup:
 * headings, paragraphs, lists, fenced code, `code`, **bold**, _emphasis_, and
 * http(s) links.
 */

type Block =
  | { readonly _tag: "Heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly _tag: "Paragraph"; readonly text: string }
  | { readonly _tag: "List"; readonly ordered: boolean; readonly items: ReadonlyArray<string> }
  | { readonly _tag: "Code"; readonly text: string };

export const parseBlocks = (source: string): ReadonlyArray<Block> => {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        code.push(lines[index]!);
        index++;
      }
      index++;
      blocks.push({ _tag: "Code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        _tag: "Heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      index++;
      continue;
    }
    const bullet = /^\s*(?:[-*]|(\d+)\.)\s+/;
    const first = bullet.exec(line);
    if (first !== null) {
      const ordered = first[1] !== undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const match = bullet.exec(lines[index]!);
        if (match === null) {
          break;
        }
        items.push(lines[index]!.slice(match[0].length));
        index++;
      }
      blocks.push({ _tag: "List", ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== "" &&
      !lines[index]!.startsWith("```") &&
      !/^#{1,3}\s/.test(lines[index]!) &&
      !bullet.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push({ _tag: "Paragraph", text: paragraph.join(" ") });
  }
  return blocks;
};

type Inline =
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "Code"; readonly text: string }
  | { readonly _tag: "Strong"; readonly text: string }
  | { readonly _tag: "Emphasis"; readonly text: string }
  | { readonly _tag: "Link"; readonly text: string; readonly href: string };

const inlinePattern =
  /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export const parseInline = (text: string): ReadonlyArray<Inline> => {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) {
      parts.push({ _tag: "Text", text: text.slice(last, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ _tag: "Code", text: match[1] });
    } else if (match[2] !== undefined) {
      parts.push({ _tag: "Strong", text: match[2] });
    } else if (match[3] !== undefined) {
      parts.push({ _tag: "Emphasis", text: match[3] });
    } else {
      parts.push({ _tag: "Link", text: match[4]!, href: match[5]! });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ _tag: "Text", text: text.slice(last) });
  }
  return parts;
};

function InlineText(props: { readonly text: string }): JSX.Element {
  return (
    <For each={parseInline(props.text)}>
      {(value) => {
        switch (value._tag) {
          case "Text":
            return <>{value.text}</>;
          case "Code":
            return <code>{value.text}</code>;
          case "Strong":
            return <strong>{value.text}</strong>;
          case "Emphasis":
            return <em>{value.text}</em>;
          case "Link":
            return (
              <a href={value.href} rel="noopener noreferrer nofollow" target="_blank">
                {value.text}
              </a>
            );
        }
      }}
    </For>
  );
}

/** Renders Markdown `source` as safe JSX. */
export function Markdown(props: { readonly source: string; readonly class?: string }) {
  return (
    <div class={["markdown", props.class]}>
      <For each={parseBlocks(props.source)}>
        {(value) => {
          switch (value._tag) {
            case "Heading":
              return value.level === 1 ? (
                <h3>
                  <InlineText text={value.text} />
                </h3>
              ) : value.level === 2 ? (
                <h4>
                  <InlineText text={value.text} />
                </h4>
              ) : (
                <h5>
                  <InlineText text={value.text} />
                </h5>
              );
            case "Paragraph":
              return (
                <p>
                  <InlineText text={value.text} />
                </p>
              );
            case "Code":
              return (
                <pre>
                  <code>{value.text}</code>
                </pre>
              );
            case "List":
              return value.ordered ? (
                <ol>
                  <For each={value.items}>
                    {(item) => (
                      <li>
                        <InlineText text={item} />
                      </li>
                    )}
                  </For>
                </ol>
              ) : (
                <ul>
                  <For each={value.items}>
                    {(item) => (
                      <li>
                        <InlineText text={item} />
                      </li>
                    )}
                  </For>
                </ul>
              );
          }
        }}
      </For>
    </div>
  );
}
