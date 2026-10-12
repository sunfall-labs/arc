// Server-only dataset shared by all three benchmark apps. Deterministic: the
// same 1,000 items on every boot, every framework. Only server modules import
// this file; the apps' leak checks fail if it reaches a browser bundle
// (`prairie` is one of its nouns and appears nowhere else).
import { ITEM_COUNT, type Item } from "./model";

const adjectives = [
  "amber",
  "brisk",
  "cobalt",
  "dusty",
  "ember",
  "frosty",
  "golden",
  "hollow",
  "ivory",
  "jade",
  "keen",
  "lunar",
  "misty",
  "noble",
  "ochre",
  "proud",
  "quiet",
  "rusty",
  "silver",
  "tidal",
] as const;

const nouns = [
  "anchor",
  "beacon",
  "cinder",
  "delta",
  "engine",
  "falcon",
  "garden",
  "harbor",
  "island",
  "journey",
  "kernel",
  "lantern",
  "meadow",
  "nectar",
  "orbit",
  "prairie",
  "quartz",
  "river",
  "summit",
  "timber",
] as const;

const categories = ["tools", "garden", "kitchen", "office", "outdoor"] as const;

// mulberry32: a tiny deterministic PRNG.
const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const createItems = (): Item[] => {
  const next = random(42);
  const items: Item[] = [];
  for (let n = 1; n <= ITEM_COUNT; n++) {
    const adjective = adjectives[Math.floor(next() * adjectives.length)]!;
    const noun = nouns[Math.floor(next() * nouns.length)]!;
    items.push({
      id: String(n),
      name: `${capitalize(adjective)} ${noun} ${n}`,
      category: categories[Math.floor(next() * categories.length)]!,
      price: Math.round((1 + next() * 499) * 100) / 100,
      done: n % 3 === 0,
    });
  }
  return items;
};

/** The in-memory store one server process owns. */
export interface ItemStore {
  readonly list: () => ReadonlyArray<Item>;
  readonly get: (id: string) => Item | undefined;
  readonly toggle: (id: string) => Item | undefined;
}

export const createItemStore = (): ItemStore => {
  const items = createItems();
  const byId = new Map(items.map((item, index) => [item.id, index]));
  return {
    list: () => items,
    get: (id) => {
      const index = byId.get(id);
      return index === undefined ? undefined : items[index];
    },
    toggle: (id) => {
      const index = byId.get(id);
      if (index === undefined) {
        return undefined;
      }
      const next = { ...items[index]!, done: !items[index]!.done };
      items[index] = next;
      return next;
    },
  };
};

/** One store per server process, shared by every module that imports it. */
export const itemStore: ItemStore = createItemStore();
