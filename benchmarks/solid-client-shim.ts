// Host shim for client render benchmarks. Solid 2 commits writes at flush, so
// benchmarks settle each step before measuring the DOM.
export { For, createRoot, createSignal, flush } from "solid-js";
export { createComponent, insert, render } from "@solidjs/web";
export const solidMajor: 1 | 2 = 2;
