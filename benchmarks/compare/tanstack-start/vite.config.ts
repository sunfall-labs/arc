import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// The Node hosting setup from the TanStack Start docs: Start, Nitro (Node
// server output in .output/), and React.
export default defineConfig({
  plugins: [tanstackStart(), nitro(), viteReact()],
});
