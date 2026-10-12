/**
 * Bench options for a measured run (`pnpm benchmark`), or one iteration of
 * each bench when `ARC_BENCH_SMOKE=1` (`pnpm verify` runs the benchmarks
 * that way), so a bench that drifts from the framework fails the gate.
 */
export const benchOptions = (time: number, warmupTime: number) =>
  process.env.ARC_BENCH_SMOKE === "1"
    ? { throws: true, time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 }
    : { throws: true, time, warmupTime };
