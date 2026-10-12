import {
  Action,
  ActionTransport,
  makeRuntime,
  ServerTransportError,
  Signal,
  type ActionTransportResponse,
} from "@sunfall/arc-core";
import { Cause, Effect, Exit, Layer, Option, Schedule, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import type { JSX } from "@solidjs/web";
import { describe, expect, it, vi } from "vitest";
import { Component } from "../src/index.js";

const waitForText = (container: Element, text: string) =>
  Effect.promise(() => vi.waitFor(() => expect(container.textContent).toBe(text)));

describe("durable Actions in Components", () => {
  it("reports ActionQueued through the handle and the pending count through Action.outbox", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const network = { online: false };
          const transport = Layer.succeed(ActionTransport)({
            submit: (_definition, input) =>
              Option.some(
                network.online
                  ? Effect.succeed({
                      exit: Exit.succeed(input),
                      apply: () => Effect.void,
                    } as ActionTransportResponse<any, any>)
                  : Effect.fail(
                      new ServerTransportError({ reason: "Network", message: "offline" }),
                    ),
              ),
          });
          const progress = Signal.make(0, { name: "SolidDurable.progress" });
          const Advance = Action.define({
            name: "SolidDurable.advance",
            input: Schema.Struct({ id: Schema.String }),
            durable: { maxAge: "1 hour" },
            optimistic: (_input, transaction) => transaction.set(progress, (value) => value + 8),
            run: ({ id }) => Effect.succeed(id),
          });
          const runtime = makeRuntime(
            Layer.mergeAll(
              transport,
              Action.outboxLayer({ retry: Schedule.spaced("5 millis") }).pipe(
                Layer.provide(KeyValueStore.layerMemory),
              ),
            ),
          );

          let submit: (() => void) | undefined;
          const Panel = Component.define("Panel", function* () {
            const advance = yield* Component.action(Advance);
            const outbox = yield* Action.outbox;
            submit = yield* Component.callback("advance", () =>
              advance.submit({ id: "atlas" }).pipe(Effect.ignore),
            );
            // A function child, as compiled JSX expressions are: it re-runs
            // when the Signals it reads change.
            const text = (): string => {
              const failure = advance.failure();
              const queued =
                failure !== undefined &&
                Cause.findErrorOption(failure).pipe(
                  Option.exists((error) => (error as { _tag?: string })._tag === "ActionQueued"),
                );
              return `${progress.get()}|${outbox.pending.get().length} waiting|${queued ? "queued" : "-"}`;
            };
            return () => text as unknown as JSX.Element;
          });

          const container = document.createElement("div");
          yield* Component.mount(Panel, container, { runtime });
          expect(container.textContent).toBe("0|0 waiting|-");

          submit!();
          yield* waitForText(container, "8|1 waiting|queued");

          network.online = true;
          yield* waitForText(container, "8|0 waiting|queued");
          yield* runtime.dispose;
        }),
      ),
    ));
});
