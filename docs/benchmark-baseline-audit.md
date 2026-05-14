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
| Project console streaming SSR | 1.8285 | 546.88 ms | 549.46 ms | 10 |
| Start route preload request | 9,623.08 | 0.1039 ms | 0.3685 ms | 4,812 |
| Resource cold plus cached prefetch | 12,027.82 | 0.0831 ms | 0.2747 ms | 6,014 |
| Collection live query materialization | 9,077.41 | 0.1102 ms | 0.3000 ms | 4,542 |
| Start RPC transport success | 10,413.64 | 0.0960 ms | 0.3088 ms | 5,207 |

## Follow-Up

- Add CI-friendly threshold checks only after several runs establish normal
  variance on the target development machine.
- Add browser navigation benchmarks after the first devtools UI panel gives a
  stable browser harness.
