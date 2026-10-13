import { Result, Schema, SchemaIssue } from "effect";
import type { KeyValueStore } from "effect/persistence";
import type {
  StateDefinition,
  StateFailure,
  StateHistory,
  StateMachine,
  StatePersistOptions,
  StatePhase,
  StateScope,
  StateTagged,
} from "./state-contract.js";
import type { TimelineEntry } from "./timeline.js";

export const makeStateFailure = <Message, E>(
  phase: StatePhase,
  error: E,
  message?: Message,
): StateFailure<Message, E> => ({
  _tag: "StateFailure",
  phase,
  ...(message === undefined ? {} : { message }),
  error,
});

type Validator = (value: unknown) => Schema.SchemaError | undefined;

const validators = new WeakMap<object, Validator>();

/** Checks a value against the type side of `schema` without copying it. */
const validatorFor = (schema: Schema.Top): Validator => {
  const cached = validators.get(schema);
  if (cached !== undefined) {
    return cached;
  }
  const is = Schema.is(schema);
  const explain = Schema.decodeUnknownResult(Schema.toType(schema) as Schema.Decoder<unknown>);
  const validator: Validator = (value) => {
    if (is(value)) {
      return undefined;
    }
    const result = explain(value);
    return Result.isFailure(result)
      ? result.failure
      : new Schema.SchemaError(
          new SchemaIssue.InvalidValue({ message: "Expected a value of the schema's type" }, value),
        );
  };
  validators.set(schema, validator);
  return validator;
};

/** The SchemaError for a message the machine's event schema rejects, if any. */
export const validateStateMessage = (
  definition: StateDefinition<any, any, any>,
  message: unknown,
): Schema.SchemaError | undefined =>
  validatorFor(definition.machine.eventSchema as unknown as Schema.Top)(message);

/** The message tags a State's machine accepts. */
export const stateMessageTags = (
  definition: StateDefinition<any, any, any>,
): ReadonlyArray<string> => Object.keys(definition.machine.eventSchema.variants);

/**
 * Builds the message `tag` from its fields with the machine's own event
 * constructor (a message without fields is the constructor's value).
 */
export const makeStateMessage = <Message>(
  definition: StateDefinition<any, Message, any>,
  tag: string,
  fields: Readonly<Record<string, unknown>> | undefined,
): Message => {
  const constructor = (definition.machine.eventSchema as unknown as Record<string, unknown>)[tag];
  return (
    typeof constructor === "function"
      ? (constructor as (fields: unknown) => Message)(fields ?? {})
      : constructor
  ) as Message;
};

type PersistRequirements<Persist> = [Persist] extends [StatePersistOptions]
  ? KeyValueStore.KeyValueStore
  : never;

/** Input to `State.define`. */
export interface StateDefineInput<Model, Message, R, Persist> {
  /** Stable name: labels the model on the `Timeline` and names its `State` causes. */
  readonly name: string;
  /** Who owns a bound instance: each Component instance (the default) or the runtime (`"app"`). */
  readonly scope?: StateScope;
  /** The machine (`Machine.make({ state, event, initial })` and its transitions). */
  readonly machine: StateMachine<Model, Message, R>;
  /** Persist the model in the runtime's `KeyValueStore` and restore it on start. */
  readonly persist?: Persist;
}

/** Defines a State over a machine. See `State.define`. */
export const defineState = <
  Model extends StateTagged,
  Message extends StateTagged,
  R = never,
  Persist extends StatePersistOptions | undefined = undefined,
>(
  definition: StateDefineInput<Model, Message, R, Persist>,
): StateDefinition<Model, Message, R | PersistRequirements<Persist>> => {
  if (definition.machine.initial === undefined) {
    throw new TypeError(
      `State "${definition.name}": its machine takes Input; a State's machine starts from a fixed initial state.`,
    );
  }
  return {
    name: definition.name,
    scope: definition.scope ?? "component",
    machine: definition.machine as StateMachine<Model, Message, R | PersistRequirements<Persist>>,
    persist: definition.persist,
  };
};

/** Each recorded instance of `definition`: the model it started from and its messages. */
export const stateHistory = <Model, Message, R>(
  definition: StateDefinition<Model, Message, R>,
  entries: Iterable<TimelineEntry>,
): ReadonlyArray<StateHistory<Model, Message>> => {
  const instances = new Map<
    number,
    {
      readonly instance: number;
      from: Model;
      readonly messages: Array<StateHistory<Model, Message>["messages"][number]>;
    }
  >();
  for (const entry of entries) {
    const cause = entry.cause;
    if (cause._tag !== "State" || cause.state !== definition.name) {
      continue;
    }
    const recorded = instances.get(cause.instance);
    switch (cause.event) {
      case "start":
        instances.set(cause.instance, {
          instance: cause.instance,
          from: cause.model as Model,
          messages: [],
        });
        break;
      case "restore":
        if (recorded !== undefined && recorded.messages.length === 0) {
          recorded.from = cause.model as Model;
        }
        break;
      case "message":
      case "ignored":
        recorded?.messages.push({
          sequence: entry.sequence,
          message: cause.message as Message,
          ignored: cause.event === "ignored",
        });
        break;
    }
  }
  return Array.from(instances.values());
};
