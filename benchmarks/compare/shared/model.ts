// Client-safe item model shared by all three benchmark apps: types and the
// two pure helpers every list renders with. No dataset code lives here, so a
// browser bundle that imports it ships a few hundred bytes.

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly price: number;
  readonly done: boolean;
}

export const ITEM_COUNT = 1000;

/** `$12.34` */
export const formatPrice = (price: number): string => `$${price.toFixed(2)}`;

/** Case-insensitive substring match on the item name; an empty query matches all. */
export const matchesQuery = (item: Item, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  return needle === "" || item.name.toLowerCase().includes(needle);
};

/** `412 of 1000 items` */
export const countLabel = (visible: number, total: number): string =>
  `${visible} of ${total} items`;

export const statusLabel = (done: boolean): string => (done ? "Done" : "Open");
