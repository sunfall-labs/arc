import { RouterProvider } from "@effect-ui/react";
import { HomePage } from "./HomePage.js";
import { routeTree } from "./routeTree.gen.js";
import "./styles.css";

export default function App() {
  return (
    <RouterProvider
      routes={routeTree}
      pending={() => <HomePage />}
      failure={() => <HomePage />}
      notFound={() => <HomePage />}
    />
  );
}
