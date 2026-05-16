const maxFactTextDepth = 4;
const maxFactTextEntries = 64;
const maxFactTextLength = 4096;
const maxFactTextPartLength = 256;

interface FactTextState {
  readonly seen: WeakSet<object>;
  readonly parts: string[];
  entries: number;
  length: number;
  truncated: boolean;
}

const appendFactTextPart = (
  state: FactTextState,
  part: string
): void => {
  if (state.length >= maxFactTextLength) {
    state.truncated = true;
    return;
  }

  const boundedPart = part.length > maxFactTextPartLength
    ? part.slice(0, maxFactTextPartLength)
    : part;
  const remaining = maxFactTextLength - state.length;
  const text = boundedPart.length > remaining
    ? boundedPart.slice(0, remaining)
    : boundedPart;
  if (text.length < boundedPart.length) {
    state.truncated = true;
  }
  state.parts.push(text);
  state.length += text.length + 1;
};

const visitFactText = (
  state: FactTextState,
  value: unknown,
  depth: number
): void => {
  if (state.length >= maxFactTextLength) {
    state.truncated = true;
    return;
  }

  if (value === null || value === undefined) {
    appendFactTextPart(state, String(value));
    return;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
      appendFactTextPart(state, String(value));
      return;
    case "function":
      appendFactTextPart(state, value.name.length > 0 ? value.name : "[Function]");
      return;
    case "object":
      break;
  }

  if (state.seen.has(value)) {
    appendFactTextPart(state, "[Circular]");
    return;
  }
  if (depth >= maxFactTextDepth) {
    appendFactTextPart(state, "[Object]");
    return;
  }

  state.seen.add(value);

  if (Array.isArray(value)) {
    appendFactTextPart(state, "Array");
    for (let index = 0; index < value.length && index < maxFactTextEntries; index++) {
      if (state.entries >= maxFactTextEntries) {
        state.truncated = true;
        break;
      }
      state.entries++;
      visitFactText(state, value[index], depth + 1);
    }
    if (value.length > maxFactTextEntries) {
      state.truncated = true;
    }
    return;
  }

  try {
    appendFactTextPart(state, Object.prototype.toString.call(value));
    for (const key in value as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (state.entries >= maxFactTextEntries) {
        state.truncated = true;
        break;
      }
      state.entries++;
      appendFactTextPart(state, key);
      visitFactText(state, (value as Record<string, unknown>)[key], depth + 1);
    }
  } catch {
    appendFactTextPart(state, "[Uninspectable]");
  }
};

export const startAgentGraphFactText = (
  value: unknown
): string => {
  const state: FactTextState = {
    seen: new WeakSet(),
    parts: [],
    entries: 0,
    length: 0,
    truncated: false
  };
  visitFactText(state, value, 0);
  if (state.truncated) {
    state.parts.push("[Truncated]");
  }
  return state.parts.join(" ");
};
