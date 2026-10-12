import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  initials,
  priorityLabel,
  statusLabel,
  type IssuePriority,
  type IssueStatus,
  type Label,
  type LabelId,
  type User,
} from "./model.js";

/*
 * Presentational leaves: plain Solid functions, no Arc bindings.
 */

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Dates render in UTC so the server and the hydrating browser print the same text. */
export const formatDate = (iso: string): string => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string): string =>
  `${dateTimeFormat.format(new Date(iso))} UTC`;

const avatarHues = [18, 200, 152, 280, 330, 45, 100];

const hueOf = (id: string): number => {
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return avatarHues[hash % avatarHues.length]!;
};

export function Avatar(props: { readonly user: User | undefined; readonly size?: "sm" | "md" }) {
  return (
    <Show
      when={props.user}
      fallback={
        <span
          class={["avatar", "unassigned", props.size ?? "sm"]}
          title="Unassigned"
          aria-label="Unassigned"
        />
      }
    >
      {(user) => (
        <span
          class={["avatar", props.size ?? "sm"]}
          style={{ "--hue": String(hueOf(user().id)) }}
          title={user().name}
          aria-label={user().name}
        >
          {initials(user().name)}
        </span>
      )}
    </Show>
  );
}

export function StatusIcon(props: { readonly status: IssueStatus }) {
  return (
    <span
      class={["statusIcon", props.status]}
      title={statusLabel(props.status)}
      aria-hidden="true"
    />
  );
}

export function PriorityIcon(props: { readonly priority: IssuePriority }) {
  const bars = () => {
    switch (props.priority) {
      case "urgent":
        return 4;
      case "high":
        return 3;
      case "medium":
        return 2;
      case "low":
        return 1;
      case "none":
        return 0;
    }
  };
  return (
    <span
      class={["priorityIcon", props.priority]}
      title={priorityLabel(props.priority)}
      aria-label={priorityLabel(props.priority)}
    >
      <Show
        when={props.priority === "urgent"}
        fallback={<For each={[1, 2, 3]}>{(bar) => <i class={{ on: bar <= bars() }} />}</For>}
      >
        !
      </Show>
    </span>
  );
}

export function LabelChips(props: {
  readonly ids: ReadonlyArray<LabelId>;
  readonly labels: ReadonlyArray<Label>;
}) {
  const chosen = () => props.labels.filter((label) => props.ids.includes(label.id));
  return (
    <For each={chosen()}>
      {(label) => (
        <span class="labelChip" style={{ "--label": label.color }}>
          {label.name}
        </span>
      )}
    </For>
  );
}

export function EmptyState(props: { readonly title: string; readonly children?: JSX.Element }) {
  return (
    <div class="emptyState">
      <p class="emptyTitle">{props.title}</p>
      {props.children}
    </div>
  );
}

export const Icon = {
  board: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </svg>
  ),
  list: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  ),
  plus: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  filter: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16l-6 8v5l-4 2v-7z" />
    </svg>
  ),
  comment: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  ),
  left: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  right: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  trash: () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  ),
};
