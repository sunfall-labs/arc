export type CodeLanguage = "diff" | "shellscript" | "text" | "tsx";

const languageAliases: Record<string, CodeLanguage> = {
  bash: "shellscript",
  console: "shellscript",
  diff: "diff",
  javascript: "tsx",
  js: "tsx",
  jsx: "tsx",
  shell: "shellscript",
  shellscript: "shellscript",
  sh: "shellscript",
  text: "text",
  ts: "tsx",
  tsx: "tsx",
  typescript: "tsx",
};

const tsxKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "readonly",
  "return",
  "satisfies",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "while",
  "yield",
]);

const normalizeCodeLanguage = (language: string | undefined): CodeLanguage => {
  const key = language?.trim().toLowerCase();
  if (!key) {
    return "tsx";
  }
  return languageAliases[key] ?? "text";
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Token colors live in the stylesheet, so one markup serves the light and dark themes. */
const span = (className: string, value: string): string =>
  `<span class="${className}">${escapeHtml(value)}</span>`;

const isIdentifierStart = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z_$]/u.test(char);

const isIdentifierPart = (char: string | undefined): boolean =>
  char !== undefined && /[\w$]/u.test(char);

const readQuotedToken = (line: string, start: number, quote: string): number => {
  let index = start + 1;
  let escaped = false;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      return index + 1;
    }
    index += 1;
  }
  return line.length;
};

const nextNonWhitespace = (line: string, index: number): string | undefined => {
  let current = index;
  while (/\s/u.test(line[current] ?? "")) {
    current += 1;
  }
  return line[current];
};

const highlightTsxLine = (line: string): string => {
  let html = "";
  let index = 0;

  while (index < line.length) {
    const char = line[index] ?? "";
    const next = line[index + 1];

    if (char === "/" && next === "/") {
      html += span("token comment", line.slice(index));
      break;
    }

    if (char === "/" && next === "*") {
      const closeIndex = line.indexOf("*/", index + 2);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      html += span("token comment", line.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedToken(line, index, char);
      html += span("token string", line.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/u.test(char)) {
      let end = index + 1;
      while (/[\d._]/u.test(line[end] ?? "")) {
        end += 1;
      }
      html += span("token number", line.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (isIdentifierPart(line[end])) {
        end += 1;
      }
      const word = line.slice(index, end);
      if (tsxKeywords.has(word)) {
        html += span("token keyword", word);
      } else if (nextNonWhitespace(line, end) === "(") {
        html += span("token function", word);
      } else if (/^[A-Z]/u.test(word)) {
        html += span("token class-name", word);
      } else {
        html += escapeHtml(word);
      }
      index = end;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
};

const highlightShellLine = (line: string): string => {
  let html = "";
  let index = 0;
  let commandSeen = false;

  while (index < line.length) {
    const char = line[index] ?? "";

    if (char === "#") {
      html += span("token comment", line.slice(index));
      break;
    }

    if (char === '"' || char === "'") {
      const end = readQuotedToken(line, index, char);
      html += span("token string", line.slice(index, end));
      index = end;
      continue;
    }

    if (char === "$") {
      let end = index + 1;
      if (line[end] === "{") {
        const close = line.indexOf("}", end + 1);
        end = close === -1 ? line.length : close + 1;
      } else {
        while (/[A-Za-z0-9_]/u.test(line[end] ?? "")) {
          end += 1;
        }
      }
      html += span("token variable", line.slice(index, end));
      index = end;
      continue;
    }

    if (!/\s/u.test(char)) {
      let end = index + 1;
      while (end < line.length && !/[\s"'#$]/u.test(line[end] ?? "")) {
        end += 1;
      }
      const word = line.slice(index, end);
      // The first word of a command is the program; the rest are its arguments.
      if (!commandSeen && isIdentifierStart(word[0]) && !word.includes("=")) {
        commandSeen = true;
        html += span("token command", word);
      } else if (word.startsWith("-")) {
        html += span("token flag", word);
      } else {
        if (word === "&&" || word === "||" || word === "|" || word === ";") {
          commandSeen = false;
        }
        html += span("token arg", word);
      }
      index = end;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
};

const highlightLine = (line: string, language: Exclude<CodeLanguage, "diff">): string => {
  switch (language) {
    case "shellscript":
      return highlightShellLine(line);
    case "text":
      return escapeHtml(line);
    case "tsx":
      return highlightTsxLine(line);
  }
};

/** A unified diff of TypeScript: `+`/`-` lines are marked, and their code is highlighted. */
const highlightDiffLine = (line: string): string => {
  if (line.startsWith("@@")) {
    return `<span class="line diff-hunk">${escapeHtml(line)}</span>`;
  }
  const marker = line[0];
  const kind = marker === "+" ? "diff-add" : marker === "-" ? "diff-remove" : "diff-context";
  const code = marker === "+" || marker === "-" || marker === " " ? line.slice(1) : line;
  const gutter = marker === "+" || marker === "-" ? marker : " ";
  return `<span class="line ${kind}"><span class="diff-marker" aria-hidden="true">${gutter}</span>${highlightTsxLine(code)}</span>`;
};

export const highlightCode = (code: string, language?: string): string => {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const lines = code
    .split("\n")
    .map((line) =>
      normalizedLanguage === "diff"
        ? highlightDiffLine(line)
        : `<span class="line">${highlightLine(line, normalizedLanguage)}</span>`,
    );

  return `<pre class="arcCode" data-language="${normalizedLanguage}" tabindex="0"><code>${lines.join("\n")}</code></pre>`;
};

export const codeLanguageLabel = (language?: string): string => {
  switch (normalizeCodeLanguage(language)) {
    case "diff":
      return "Diff";
    case "shellscript":
      return "Shell";
    case "text":
      return "Text";
    case "tsx":
      return "TypeScript";
  }
};
