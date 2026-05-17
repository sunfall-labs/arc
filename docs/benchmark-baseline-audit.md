# Benchmark Baseline Audit

Last updated: 2026-05-17.

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

Run on May 17, 2026, from `/Users/alee/Developer/Personal/sunfall-arc`.
Environment: Node v25.9.0, pnpm 10.33.2, Vitest 4.1.6.

Command:

```sh
pnpm benchmark
```

| Benchmark                             |        hz |      mean |       p99 | samples |
| ------------------------------------- | --------: | --------: | --------: | ------: |
| Project console streaming SSR         |    1.8173 | 550.27 ms | 552.70 ms |      10 |
| Start route preload request           | 10,265.69 | 0.0974 ms | 0.2936 ms |   5,133 |
| Resource cold plus cached prefetch    | 13,371.10 | 0.0748 ms | 0.2066 ms |   6,686 |
| Collection live query materialization |  6,790.91 | 0.1473 ms | 0.3849 ms |   3,396 |
| Start RPC transport success           | 11,199.82 | 0.0893 ms | 0.2775 ms |   5,600 |

## Follow-Up

- Add CI-friendly threshold checks only after several runs establish normal
  variance on the target development machine.
- Add browser navigation benchmarks after the devtools panel app shell grows a
  stable browser automation harness.
