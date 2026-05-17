import { useResource } from "@sunfall/arc-solid";
import { WelcomeRef } from "./starter.js";
import "./styles.css";

export default function App() {
  const welcome = useResource(WelcomeRef);

  return (
    <main class="starterShell">
      <section class="starterPanel">
        <p class="starterEyebrow">Sunfall Arc Starter</p>
        {welcome.match({
          initial: () => <h1>Loading starter resource</h1>,
          pending: () => <h1>Loading starter resource</h1>,
          success: (value) => (
            <>
              <h1>{value.message}</h1>
              <p>Start with one route, one Resource preload, SSR, and browser hydration.</p>
            </>
          ),
          failure: () => <h1>Starter resource failed</h1>,
        })}
      </section>
    </main>
  );
}
