// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Small collection helpers every package can share. */

/** `items` in order, keeping only the first item for each key. */
export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `items` in order, cut into runs of `size` (the last one shorter). Throws on a size below 1 (a bug). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError(`chunk size ${size} is not a positive integer`);
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/** Each of `keys` summed over `items` (0 for none), as a record of the same shape. */
export function sumFields<K extends string>(
  items: readonly Readonly<Record<K, number>>[],
  keys: readonly K[],
): Record<K, number> {
  const total = {} as Record<K, number>;
  for (const key of keys) total[key] = 0;
  for (const item of items) for (const key of keys) total[key] += item[key];
  return total;
}
