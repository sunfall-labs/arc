import { Timeline } from "@sunfall/arc-core";
import { Component } from "@sunfall/arc-solid";
import { Effect } from "effect";
import { For } from "solid-js";

export const TimelinePanel = Component.define("TimelinePanel", function* () {
  // Records every commit until this instance unmounts. E += TimelineAlreadyRecording.
  const recording = yield* Timeline.record({ limit: 500 });
  const travel = yield* Component.callback("travel", (sequence: number) =>
    recording.travel(sequence).pipe(Effect.ignore),
  );
  const resume = yield* Component.callback("resume", () => recording.resume());

  return () => (
    <aside>
      <button disabled={recording.position.get() === undefined} onClick={() => resume()}>
        Back to live
      </button>
      <ol>
        <For each={recording.entries.get()} keyed={(entry) => entry.sequence}>
          {(entry) => (
            <li>
              <button onClick={() => travel(entry().sequence)}>
                {Timeline.describe(entry().cause)}:{" "}
                {entry()
                  .changes.map((change) => change.name)
                  .join(", ")}
              </button>
            </li>
          )}
        </For>
      </ol>
    </aside>
  );
}).pipe(Component.catchAll(() => <p>Another Timeline recording is running.</p>));

/** Development only: mounts the panel beside the app. Run with `Effect.runFork`. */
export const launchTimelinePanel = (container: HTMLElement) =>
  Component.launch(TimelinePanel, container);
