import { RouterProvider } from "@effect-ui/react";
import { HomePage } from "./HomePage.js";
import { routeTree } from "./routeTree.gen.js";
import "./styles.css";

export interface AppProps {
  readonly hydrating?: boolean;
}

export default function App(props: AppProps = {}) {
  return (
    <RouterProvider
      routes={routeTree}
      hydrating={props.hydrating ?? false}
      pending={() => <HomePage />}
      failure={() => <HomePage />}
      notFound={() => <HomePage />}
    />
  );
}
