import { useResource } from "@sunfall/arc-solid";
import { AsyncResult } from "effect/reactivity";
import { WelcomeRef } from "./starter.js";
import "./styles.css";

export default function App() {
  const welcome = useResource(WelcomeRef);

  return (
    <main class="starterShell">
      <section class="starterPanel">
        <p class="starterEyebrow">Sunfall Arc Starter</p>
        {AsyncResult.builder(welcome.result())
          .onInitial(() => <h1>Loading starter resource</h1>)
          .onFailure(() => <h1>Starter resource failed</h1>)
          .onSuccess((value) => (
            <>
              <h1>{value.message}</h1>
              <p>Start with one route, one Resource preload, SSR, and browser hydration.</p>
            </>
          ))
          .exhaustive()}
      </section>
    </main>
  );
}
