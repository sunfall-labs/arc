import { Component } from "@sunfall/arc-solid";
import { WelcomeResource } from "./starter.js";
import "./styles.css";

/**
 * Reads the route-preloaded welcome Resource. The reader is the only way to
 * render its value: the first load suspends the `<Loading>` fallback (route
 * preload and hydration make it synchronous), and a failed first load renders
 * the `catchAll` view.
 */
const Welcome = Component.define("Welcome", function* () {
  const welcome = yield* Component.resource(WelcomeResource);
  return () => (
    <>
      <h1>{welcome("Sunfall Arc").message}</h1>
      <p>Start with one route, one Resource preload, SSR, and browser hydration.</p>
    </>
  );
}).pipe(
  Component.catchAll(() => <h1>Starter resource failed</h1>),
  Component.loading(() => <h1>Loading starter resource</h1>),
);

const App = Component.define("App", function* () {
  const Content = yield* Welcome;
  return () => (
    <main class="starterShell">
      <section class="starterPanel">
        <p class="starterEyebrow">Sunfall Arc Starter</p>
        <Content />
      </section>
    </main>
  );
});

export default App;
