import { Timeline } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { For, Show } from "solid-js";

/**
 * A State message's fields, as data (`{"text":"atl"}`): messages are
 * schema-checked plain values, so the Timeline can show what each one said.
 */
const messageFields = (cause: Timeline.Cause): string | undefined => {
  if (cause._tag !== "State" || typeof cause.message !== "object" || cause.message === null) {
    return undefined;
  }
  const fields = Object.entries(cause.message).filter(
    ([key, value]) => key !== "_tag" && typeof value !== "function",
  );
  return fields.length === 0 ? undefined : JSON.stringify(Object.fromEntries(fields));
};

/**
 * Development aid: every commit the app makes, newest first, by name, with
 * each State message's fields. Click one to render the app as it was then;
 * "Back to live" returns.
 */
export const TimelinePanel = Component.define("TimelinePanel", function* () {
  const recording = yield* Timeline.record({ limit: 300 });
  const travel = yield* Component.callback("travel", (sequence: number) =>
    recording.travel(sequence).pipe(Effect.ignore),
  );
  const resume = yield* Component.callback("resume", () => recording.resume());
  const entries = () => [...recording.entries.get()].reverse();

  return () => (
    <aside class="timelinePanel" aria-label="Timeline">
      <header>
        <strong>Timeline</strong>
        <span>{recording.entries.get().length} commits</span>
        <button
          type="button"
          class="ghostButton small"
          disabled={recording.position.get() === undefined}
          onClick={() => resume()}
        >
          Back to live
        </button>
      </header>
      <ol>
        <For each={entries()} keyed={(entry) => entry.sequence}>
          {(entry) => (
            <li class={{ current: recording.position.get() === entry().sequence }}>
              <button type="button" onClick={() => travel(entry().sequence)}>
                <span class="timelineCause">{Timeline.describe(entry().cause)}</span>
                <Show when={messageFields(entry().cause)}>
                  {(fields) => <code class="timelineMessage">{fields()}</code>}
                </Show>
                <span class="timelineChanges">
                  {entry()
                    .changes.map((change) => change.name)
                    .join(", ")}
                </span>
              </button>
            </li>
          )}
        </For>
      </ol>
    </aside>
  );
}).pipe(Component.catchAll(() => <p class="timelinePanel">Another Timeline is recording.</p>));
