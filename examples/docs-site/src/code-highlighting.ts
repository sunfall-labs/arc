export type CodeLanguage = "shellscript" | "text" | "tsx";

const languageAliases: Record<string, CodeLanguage> = {
  bash: "shellscript",
  console: "shellscript",
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

const span = (className: string, color: string, value: string): string =>
  `<span class="${className}" style="color:${color}">${escapeHtml(value)}</span>`;

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
      html += span("token comment", "#8b949e", line.slice(index));
      break;
    }

    if (char === "/" && next === "*") {
      const closeIndex = line.indexOf("*/", index + 2);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      html += span("token comment", "#8b949e", line.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      const end = readQuotedToken(line, index, char);
      html += span("token string", "#a5d6ff", line.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/u.test(char)) {
      let end = index + 1;
      while (/[\d._]/u.test(line[end] ?? "")) {
        end += 1;
      }
      html += span("token number", "#79c0ff", line.slice(index, end));
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
        html += span("token keyword", "#ff7b72", word);
      } else if (nextNonWhitespace(line, end) === "(") {
        html += span("token function", "#d2a8ff", word);
      } else if (/^[A-Z]/u.test(word)) {
        html += span("token class-name", "#ffa657", word);
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

  while (index < line.length) {
    const char = line[index] ?? "";

    if (char === "#") {
      html += span("token comment", "#8b949e", line.slice(index));
      break;
    }

    if (char === '"' || char === "'") {
      const end = readQuotedToken(line, index, char);
      html += span("token string", "#a5d6ff", line.slice(index, end));
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
      html += span("token variable", "#7ee787", line.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9_:-]/u.test(line[end] ?? "")) {
        end += 1;
      }
      const word = line.slice(index, end);
      html += span("token command", "#d2a8ff", word);
      index = end;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
};

const highlightLine = (line: string, language: CodeLanguage): string => {
  switch (language) {
    case "shellscript":
      return highlightShellLine(line);
    case "text":
      return escapeHtml(line);
    case "tsx":
      return highlightTsxLine(line);
  }
};

export const highlightCode = (code: string, language?: string): string => {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const lines = code
    .split("\n")
    .map((line) => `<span class="line">${highlightLine(line, normalizedLanguage)}</span>`);

  return `<pre class="shiki github-dark-default" style="background-color:#0d1117;color:#e6edf3" tabindex="0"><code>${lines.join("\n")}</code></pre>`;
};

export const codeLanguageLabel = (language?: string): string => {
  switch (normalizeCodeLanguage(language)) {
    case "shellscript":
      return "Shell";
    case "text":
      return "Text";
    case "tsx":
      return "TypeScript";
  }
};
