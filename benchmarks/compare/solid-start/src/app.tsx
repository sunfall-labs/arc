import { MetaProvider, Title } from "@solidjs/meta";
import { A, Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "../../shared/styles.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>Items</Title>
          <div class="shell">
            <header class="topbar">
              <A class="brand" href="/">
                Inventory
              </A>
            </header>
            <main class="page">
              <Suspense>{props.children}</Suspense>
            </main>
          </div>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
