import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  EffectInputCallbackError,
  EffectInputPromiseRejected,
  invokeEffectInput,
  toEffect
} from "../src/index.js";

describe("EffectInput", () => {
  it("accepts pure values", () =>
    Effect.runPromise(
      Effect.map(toEffect({ ok: true }), (value) => {
        expect(value).toEqual({ ok: true });
      })
    ));

  it("preserves explicitly wrapped Effect values as domain values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const domainEffect = Effect.succeed(42);
        const value = yield* toEffect<Effect.Effect<number>>(Effect.succeed(domainEffect));

        expect(value).toBe(domainEffect);
        expect(yield* value).toBe(42);
      })
    ));

  it("rejects thenables at runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(toEffect({
          then: (_resolve: (value: string) => void) => undefined
        }));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
          expect(defect).toBeInstanceOf(EffectInputPromiseRejected);
          expect((defect as EffectInputPromiseRejected).guidance).toContain("Effect.tryPromise");
        }
      })
    ));

  it("rejects values with throwing then getters as Promise-shaped values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const thenGetterCause = new Error("then getter failed");
        const value = Object.defineProperty({}, "then", {
          get: () => {
            throw thenGetterCause;
          }
        });
        const exit = yield* Effect.exit(toEffect(value));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
          expect(defect).toBeInstanceOf(EffectInputPromiseRejected);
          expect((defect as EffectInputPromiseRejected).guidance).toContain("Effect.tryPromise");
        }
      })
    ));

  it("rejects Effect successes that are thenables at runtime", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(toEffect(Effect.succeed({
          then: (_resolve: (value: string) => void) => undefined
        })));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect;
          expect(defect).toBeInstanceOf(EffectInputPromiseRejected);
          expect((defect as EffectInputPromiseRejected).guidance).toContain("Effect.tryPromise");
        }
      })
    ));

  it("turns Promise-shaped Effect callback successes into typed failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          invokeEffectInput("test.promiseSuccess", () =>
            Effect.succeed({
              then: (_resolve: (value: string) => void) => undefined
            })
          )
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe("test.promiseSuccess");
          expect((failure as EffectInputCallbackError).cause).toBeInstanceOf(EffectInputPromiseRejected);
        }
      })
    ));

  it("captures synchronous callback throws as typed Effect failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          invokeEffectInput("test.callback", () => {
            throw new Error("boom");
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
          expect(failure).toBeInstanceOf(EffectInputCallbackError);
          expect((failure as EffectInputCallbackError).operation).toBe("test.callback");
          expect((failure as EffectInputCallbackError).cause).toBeInstanceOf(Error);
        }
      })
    ));
});
