// The "Start here" page renders the repository's docs/golden-path.md, so the
// site and the repo show one guide. Its snippets are type-checked in
// type-tests/golden-path by the workspace `pnpm typecheck`.
import goldenPathMarkdown from "../../../docs/golden-path.md?raw";
import type { DocsBlock } from "./docs-content.js";

const repositoryBlobUrl = "https://github.com/sunfall-labs/arc/blob/main/";
const docsDirectory = ["docs"];

/** Resolves a link relative to docs/ into a repository URL; absolute links pass through. */
const resolveRepositoryLink = (href: string): string => {
  if (/^[a-z]+:/u.test(href) || href.startsWith("#")) {
    return href;
  }
  const [path = "", hash] = href.split("#");
  const segments = [...docsDirectory];
  for (const segment of path.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return `${repositoryBlobUrl}${segments.join("/")}${hash === undefined ? "" : `#${hash}`}`;
};

const resolveLinks = (text: string): string =>
  text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/gu,
    (_, label: string, href: string) => `[${label}](${resolveRepositoryLink(href)})`,
  );

const tableCells = (line: string): readonly string[] =>
  line
    .trim()
    .replace(/^\||\|$/gu, "")
    .split("|")
    .map((cell) => resolveLinks(cell.trim()));

/** Converts the guide's Markdown subset (headings, paragraphs, lists, tables, fences) to blocks. */
export const markdownToDocsBlocks = (markdown: string): readonly DocsBlock[] => {
  const blocks: DocsBlock[] = [];
  const lines = markdown.replace(/\r\n/gu, "\n").split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ _tag: "Paragraph", text: resolveLinks(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== "```") {
        code.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ _tag: "Code", language, code: code.join("\n") });
      continue;
    }

    if (trimmed === "" || trimmed.startsWith("<!--")) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/u.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 2;
      // The page header shows the title; the H1 is not repeated.
      if (level > 1) {
        blocks.push({ _tag: "Heading", level: level === 2 ? 2 : 3, text: heading[2] ?? "" });
      }
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushParagraph();
      const rows: (readonly string[])[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        const row = lines[index] ?? "";
        if (!/^\|[\s:|-]+\|$/u.test(row.trim())) {
          rows.push(tableCells(row));
        }
        index += 1;
      }
      index -= 1;
      blocks.push({ _tag: "Table", rows });
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index] ?? "";
        if (item.trim().startsWith("- ")) {
          items.push(item.trim().slice(2));
        } else if (item.startsWith("  ") && item.trim() !== "" && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${item.trim()}`;
        } else {
          break;
        }
        index += 1;
      }
      index -= 1;
      blocks.push({ _tag: "List", items: items.map(resolveLinks) });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
};

export const goldenPathBlocks = markdownToDocsBlocks(goldenPathMarkdown);
