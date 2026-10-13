import { Schema } from "effect";
import { type Action, Machine, Message, Model, State } from "../src/index.js";
import { defaultRuntime } from "../src/internal.js";

/** A one-variant model holding one value: the optimistic target Action tests patch. */
export interface Cell<A> {
  readonly _tag: "Cell";
  readonly value: A;
}

const CellModel = Model({ Cell: { value: Schema.Any } });
const CellEvent = Message({ ChangedValue: { value: Schema.Any } });

/** A running State holding `initial`. */
export const stateCell = <A>(
  initial: A,
  options: { readonly name: string },
): State.Instance<Cell<A>, { readonly _tag: "ChangedValue"; readonly value: A }> =>
  State.start(
    State.define({
      name: options.name,
      machine: Machine.make({
        state: CellModel,
        event: CellEvent,
        initial: CellModel.Cell({ value: initial }),
      }).onAny(CellEvent.ChangedValue, ({ event }) => CellModel.Cell({ value: event.value })),
    }),
    { runtime: defaultRuntime },
  ) as never;

/** The cell holding `value`, as a patch writes it. */
export const cell = <A>(value: A): Cell<A> => ({ _tag: "Cell", value });

/** Patches a cell's value: a new value, or a function of the current one. */
export const setCell = <A>(
  transaction: Action.OptimisticTransaction,
  target: State.Ref<Cell<A>>,
  update: A | ((value: A) => A),
) =>
  transaction.set(target, (current) =>
    cell(typeof update === "function" ? (update as (value: A) => A)(current.value) : update),
  );

const CounterModel = Model({ Counting: { count: Schema.Finite } });
const CounterEvent = Message({ Incremented: {} });

/** A counter State named `name`: `Incremented` adds one. */
export const counterState = (name: string) =>
  State.define({
    name,
    machine: Machine.make({
      state: CounterModel,
      event: CounterEvent,
      initial: CounterModel.Counting({ count: 0 }),
    }).onAny(CounterEvent.Incremented, ({ state }) =>
      CounterModel.Counting({ count: state.count + 1 }),
    ),
  });

/** The counter's message. */
export const Incremented = CounterEvent.Incremented;
