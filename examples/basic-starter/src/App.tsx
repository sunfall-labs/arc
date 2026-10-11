import { useResource } from "@sunfall/arc-solid";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Show } from "solid-js";
import { WelcomeRef } from "./starter.js";
import "./styles.css";

export default function App() {
  const welcome = useResource(WelcomeRef);
  // Current or stale value: the content mounts once and refreshes update it in place.
  const current = () => Option.getOrUndefined(AsyncResult.value(welcome.result()));

  return (
    <main class="starterShell">
      <section class="starterPanel">
        <p class="starterEyebrow">Sunfall Arc Starter</p>
        <Show
          when={current()}
          fallback={AsyncResult.builder(welcome.result())
            .onFailure(() => <h1>Starter resource failed</h1>)
            .orElse(() => (
              <h1>Loading starter resource</h1>
            ))}
        >
          {(value) => (
            <>
              <h1>{value().message}</h1>
              <p>Start with one route, one Resource preload, SSR, and browser hydration.</p>
            </>
          )}
        </Show>
      </section>
    </main>
  );
}
