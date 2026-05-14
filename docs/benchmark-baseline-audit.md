# Benchmark Baseline Audit

Last updated: 2026-05-14.

This audit establishes the first in-repo performance baseline for the release
candidate checklist. The goal is not to set pass/fail thresholds yet; it is to
make the hot paths measurable and repeatable before deeper optimization work.

## Benchmark Coverage

The new `pnpm benchmark` command runs `benchmarks/framework-baseline.bench.ts`
with Vitest bench mode. It covers:

- project console streaming SSR, including route preload, Solid SSR rendering,
  streamed hydration chunks, and response text consumption;
- Start route preload request planning and request-runtime teardown;
- Resource cold load followed by cached prefetch on the same runtime;
- DB live query materialization over a runtime-local Collection Store;
- Start RPC transport success through the JSON endpoint.

## Current Baseline

Run on May 14, 2026, from `/Users/alee/Developer/Personal/effect-ui`.
Environment: Node v25.9.0, pnpm 10.33.2, Vitest 4.1.6.

Command:

```sh
pnpm benchmark
```

| Benchmark | hz | mean | p99 | samples |
| --- | ---: | ---: | ---: | ---: |
| Project console streaming SSR | 1.8275 | 547.21 ms | 548.68 ms | 10 |
| Start route preload request | 11,106.16 | 0.0900 ms | 0.2975 ms | 5,554 |
| Resource cold plus cached prefetch | 13,467.57 | 0.0743 ms | 0.2435 ms | 6,734 |
| Collection live query materialization | 8,743.64 | 0.1144 ms | 0.3080 ms | 4,372 |
| Start RPC transport success | 8,901.93 | 0.1123 ms | 0.3447 ms | 4,451 |

## Follow-Up

- Add CI-friendly threshold checks only after several runs establish normal
  variance on the target development machine.
- Add browser navigation benchmarks after the devtools panel app shell grows a
  stable browser automation harness.
