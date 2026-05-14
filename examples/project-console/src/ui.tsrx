import type { PresenceEvent, ProjectHealth } from "./domain.js";

export component PresencePill(props: { readonly presence: PresenceEvent }) {
  <div class="presencePill">
    <span class={`buildDot ${props.presence.build}`} />
    <span>{props.presence.activeUsers}{" active"}</span>
    <span>{String(props.presence.latency) + "ms"}</span>
  </div>
}

export component HealthBadge(props: {
  readonly health: ProjectHealth;
  readonly label: string;
}) {
  <span class={`healthBadge ${props.health}`}>{props.label}</span>
}

export component Metric(props: {
  readonly label: string;
  readonly value: string;
  readonly tone: "blue" | "amber" | "green" | "slate";
}) {
  <div class={`metric ${props.tone}`}>
    <span>{props.label}</span>
    <strong>{props.value}</strong>
  </div>
}
