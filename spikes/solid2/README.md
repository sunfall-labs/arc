# Solid 2 Spike

Executable notes from evaluating Solid 2 (`2.0.0-rc.14`) as Arc's renderer and
reactive graph. Private workspace member; not published and not part of
`pnpm verify`.

```sh
pnpm --filter @sunfall/arc-spike-solid2 typecheck
pnpm --filter @sunfall/arc-spike-solid2 test
```

## Findings

| Probe                        | Result                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/signal.test.ts`        | Solid computations track external signals natively. Writes are **invisible to reads until `flush()`**, so a naive Arc Signal on raw Solid signals breaks read-after-write (`src/raw-solid-signal.ts`).                                                                                                                      |
| `test/sync-set.test.ts`      | `flush()` restores sync reads at top level but is a **no-op inside a reactive callback**; `latest()` does not expose pending writes.                                                                                                                                                                                        |
| `test/effect-commit.test.ts` | `flush()` from inside an Effect fiber (outside Solid computations) commits synchronously, even for fibers started from a Solid effect.                                                                                                                                                                                      |
| `test/effect-memo.test.ts`   | A Resource read as a fiber-backed async memo works: stale-while-revalidating with accurate `isPending`, superseded fibers are interrupted, typed failures keep their `Cause`, cached values return synchronously (no hydration flash), and owner disposal interrupts the fiber — **if the memo is created under an owner**. |

## Decisions

- **Writes are transactions** (implemented in `packages/core/src/signal.ts` and
  `signal-transaction.ts`). Arc's synchronous graph is committed state; each
  signal lazily projects into a Solid signal for rendering. Raw Solid signals
  would lose updates in the Program runtime when two messages land in one tick.
- **Keep `ResourceState` for now.** Effect's `AsyncResult` (stable in Effect 4
  as `effect/reactivity`) is lossy in both directions against it — it keeps
  errors while retrying and carries a full `Cause`. Revisit unifying on it now
  that it is stable.
- **Keep TSRX**; `@tsrx/solid@0.3.x` already targets Solid 2.

## Next

1. Port `@sunfall/arc-solid` and `@sunfall/arc-solid-db` to Solid 2: replace the
   thrown-Promise Suspense bridge and `createResource` with `src/effect-memo.ts`
   style async memos; drop the signal copy layer now that Arc signals track
   natively.
2. Done: the validated `Component` prototype is now the real module,
   `packages/solid/src/component.ts` (`Component` in `@sunfall/arc-solid`), with
   runtime tests in `packages/solid/test/component.test.ts` and type tests in
   `type-tests/component.test-d.ts`. See "Components" in
   `docs/architecture.md`.
