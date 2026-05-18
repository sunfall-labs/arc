import shellscript from "@shikijs/langs/shellscript";
import tsx from "@shikijs/langs/tsx";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type CodeLanguage = "shellscript" | "text" | "tsx";

const codeTheme = "github-dark-default";

const highlighter = createHighlighterCoreSync({
  themes: [githubDarkDefault],
  langs: [tsx, shellscript],
  engine: createJavaScriptRegexEngine(),
});

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

const plainCodeToHtml = (code: string): string => {
  const lines = code.split("\n").map((line) => `<span class="line">${escapeHtml(line)}</span>`);
  return `<pre class="shiki plain" style="background-color:#0d1117;color:#e6edf3" tabindex="0"><code>${lines.join("\n")}</code></pre>`;
};

export const highlightCode = (code: string, language?: string): string => {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (normalizedLanguage === "text") {
    return plainCodeToHtml(code);
  }

  return highlighter.codeToHtml(code, {
    lang: normalizedLanguage,
    theme: codeTheme,
  });
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
