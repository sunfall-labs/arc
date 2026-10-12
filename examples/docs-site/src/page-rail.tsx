import { Show, createSignal, onSettled, untrack } from "solid-js";
import { InlineText } from "./ui.js";

export interface HeadingSource {
  readonly blockIndex: number;
  readonly level: 2 | 3;
  readonly text: string;
}

export interface PageRailItem extends HeadingSource {
  readonly id: string;
}

/** A heading's anchor id: inline code and punctuation drop out, words join with dashes. */
export const slugifyHeading = (text: string): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return slug.length > 0 ? slug : "section";
};

export const createPageRailItems = (
  headings: ReadonlyArray<HeadingSource>,
): readonly PageRailItem[] => {
  const seen = new Map<string, number>();

  return headings.map((heading) => {
    const slug = slugifyHeading(heading.text);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);

    return {
      ...heading,
      id: count === 0 ? slug : `${slug}-${count + 1}`,
    };
  });
};

export const pageRailIdsByBlockIndex = (
  items: ReadonlyArray<PageRailItem>,
): ReadonlyMap<number, string> => new Map(items.map((item) => [item.blockIndex, item.id] as const));

/** "On this page": the article's headings, with the one in view highlighted. */
export function PageRail(props: { readonly items: ReadonlyArray<PageRailItem> }) {
  const [activeId, setActiveId] = createSignal(untrack(() => props.items[0]?.id ?? ""));

  onSettled(() => {
    const headings = props.items
      .map((item) => document.getElementById(item.id))
      .filter((heading): heading is HTMLElement => heading !== null);
    const firstHeading = headings[0];

    if (firstHeading === undefined) {
      return;
    }

    const updateActiveHeading = () => {
      const current = headings.reduce<HTMLElement>((active, heading) => {
        const top = heading.getBoundingClientRect().top;
        return top <= 140 ? heading : active;
      }, firstHeading);

      setActiveId(current.id);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);

    // Solid 2: settled callbacks return their cleanup (onCleanup is forbidden here).
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  });

  return (
    <Show when={props.items.length > 0}>
      <aside class="pageRail" aria-label="On this page">
        <p class="pageRailTitle">On this page</p>
        <nav class="pageRailNav">
          {props.items.map((item) => (
            <a
              href={`#${item.id}`}
              class={[
                "pageRailLink",
                {
                  active: activeId() === item.id,
                  nested: item.level > 2,
                },
              ]}
              aria-current={activeId() === item.id ? "location" : undefined}
            >
              <InlineText text={item.text} />
            </a>
          ))}
        </nav>
      </aside>
    </Show>
  );
}
