import { isPlainLeftClick, useRouter } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { codeLanguageLabel, highlightCode } from "./code-highlighting.js";

export const githubUrl = "https://github.com/sunfall-labs/arc";

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/gu;

/** Renders the inline Markdown docs text uses: `code`, **strong**, and [links](href). */
export function InlineText(props: { readonly text: string }) {
  return (
    <>
      {props.text.split(inlinePattern).map((part) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
          return <code class="inlineCode">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
          return (
            <strong>
              <InlineText text={part.slice(2, -2)} />
            </strong>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(part);
        if (link) {
          return (
            <InlineLink href={link[2] ?? ""}>
              <InlineText text={link[1] ?? ""} />
            </InlineLink>
          );
        }
        return part;
      })}
    </>
  );
}

/**
 * A link inside docs prose. Site-relative links (`/docs/...`) get the base
 * path and navigate through the router; everything else opens as written.
 */
function InlineLink(props: { readonly href: string; readonly children: JSX.Element }) {
  const router = useRouter();
  const internal = () => props.href.startsWith("/") && !props.href.startsWith("//");
  return (
    <a
      href={internal() ? router.createHref(props.href) : props.href}
      onClick={(event) => {
        if (internal() && isPlainLeftClick(event)) {
          event.preventDefault();
          router.navigateHref(props.href);
        }
      }}
    >
      {props.children}
    </a>
  );
}

export function CodeBlock(props: {
  readonly code: string;
  readonly language?: string | undefined;
  readonly title?: string | undefined;
  readonly class?: string;
}) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimeout: number | undefined;

  const copyCode = () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      return;
    }
    Effect.runFork(
      Effect.tryPromise(() => clipboard.writeText(props.code)).pipe(
        Effect.map(() => {
          window.clearTimeout(copiedTimeout);
          setCopied(true);
          copiedTimeout = window.setTimeout(() => setCopied(false), 1600);
        }),
        Effect.ignore,
      ),
    );
  };

  return (
    <figure class={["codeFrame", props.class]}>
      <figcaption class="codeToolbar">
        {props.title === undefined ? (
          <span class="codeLanguage">{codeLanguageLabel(props.language)}</span>
        ) : (
          <span class="codeFile">{props.title}</span>
        )}
        <button
          type="button"
          class="codeCopyButton"
          onClick={copyCode}
          aria-label={copied() ? "Copied" : "Copy code"}
        >
          {copied() ? <CheckIcon /> : <CopyIcon />}
          <span>{copied() ? "Copied" : "Copy"}</span>
        </button>
      </figcaption>
      <div class="codeBody" innerHTML={highlightCode(props.code, props.language)} />
    </figure>
  );
}

export function Callout(props: { readonly title?: string | undefined; readonly text: string }) {
  return (
    <aside class="callout" role="note">
      {props.title === undefined ? null : <p class="calloutTitle">{props.title}</p>}
      <p>
        <InlineText text={props.text} />
      </p>
    </aside>
  );
}

export function TableBlock(props: { readonly rows: ReadonlyArray<ReadonlyArray<string>> }) {
  const header = () => props.rows[0] ?? [];
  const body = () => props.rows.slice(1);
  return (
    <div class="tableScroll" tabindex="0" role="region" aria-label="Table">
      <table>
        <thead>
          <tr>
            {header().map((cell) => (
              <th scope="col">
                <InlineText text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body().map((row) => (
            <tr>
              {row.map((cell) => (
                <td>
                  <InlineText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A heading with a hover anchor; `text` may hold inline code. */
export function AnchoredHeading(props: {
  readonly level: 2 | 3;
  readonly id: string | undefined;
  readonly text: string;
}) {
  const content = () => (
    <>
      <InlineText text={props.text} />
      {props.id === undefined ? null : (
        <a class="headingAnchor" href={`#${props.id}`} aria-label="Link to this section">
          #
        </a>
      )}
    </>
  );
  return (
    <>
      {props.level === 3 ? <h3 id={props.id}>{content()}</h3> : <h2 id={props.id}>{content()}</h2>}
    </>
  );
}

// The stored theme choice; without one the page follows `prefers-color-scheme`.
const themeStorageKey = "sunfall-arc-theme";

/**
 * Runs before the first paint (it is the first node in the body), so a stored
 * theme applies without a flash of the other one.
 */
export const themeBootScript = `try{var t=localStorage.getItem("${themeStorageKey}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const toggleTheme = () => {
  const root = document.documentElement;
  const current =
    root.dataset.theme ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {
    // Storage can be unavailable (private windows); the choice lasts for this page.
  }
};

/** The icon follows the theme in CSS, so server and client render the same button. */
export function ThemeToggle() {
  return (
    <button type="button" class="iconButton themeToggle" onClick={toggleTheme} title="Toggle theme">
      <span class="srOnly">Toggle color theme</span>
      <MoonIcon />
      <SunIcon />
    </button>
  );
}

const iconProps = {
  width: "16",
  height: "16",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.8",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

export const ArcMark = () => (
  <svg class="arcMark" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4.5 16.5a7.5 7.5 0 0 1 15 0"
      stroke="var(--accent)"
      stroke-width="2.2"
      stroke-linecap="round"
    />
    <path d="M2.5 20h19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...iconProps} width="14" height="14">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...iconProps} width="14" height="14">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const MoonIcon = () => (
  <svg {...iconProps} class="iconMoon">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const SunIcon = () => (
  <svg {...iconProps} class="iconSun">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...iconProps} width="18" height="18">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...iconProps} width="18" height="18">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ArrowIcon = () => (
  <svg {...iconProps} width="14" height="14" class="arrowIcon">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
