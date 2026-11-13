// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which parts of an asset's view a stage reads (index-stage-reads.test.ts): the view behind proxies that record
 * every path read, and a copy of the view with the value at one of those paths changed.
 */
import type { AssetIndexView } from '@taalcut/core';

export type ViewPath = readonly (string | number)[];

const isIndex = (target: object, key: string) => Array.isArray(target) && /^\d+$/.test(key);

/** Every path of `view` that `read` reads: values, and objects (an analysis checked for null, a whole output). */
export function readPaths(view: AssetIndexView, read: (view: AssetIndexView) => unknown): ViewPath[] {
  const seen = new Map<string, ViewPath>();
  const wrap = (value: unknown, path: ViewPath): unknown => {
    if (value === null || typeof value !== 'object') return value;
    return new Proxy(value, {
      get(target, key, receiver) {
        const field: unknown = Reflect.get(target, key, receiver);
        // Methods and an array's length say nothing about which stored value was read.
        if (typeof key === 'symbol' || typeof field === 'function' || key === 'length') return field;
        const at = [...path, isIndex(target, key) ? Number(key) : key];
        seen.set(JSON.stringify(at), at);
        return wrap(field, at);
      },
    });
  };
  read(wrap(view, []) as AssetIndexView);
  return [...seen.values()];
}

function changed(value: unknown): { value: unknown } | undefined {
  if (typeof value === 'number') return { value: Number.isInteger(value) ? value + 1 : value + 0.25 };
  if (typeof value === 'string') return { value: `${value}x` };
  if (typeof value === 'boolean') return { value: !value };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return { value: null };
  return undefined;
}

/** A copy of `view` with the value at `path` changed (an object becomes null), or undefined when it can't be. */
export function mutatedAt(view: AssetIndexView, path: ViewPath): AssetIndexView | undefined {
  // The containers every stage walks: changing them whole says nothing about one stage's output.
  if (path.length === 1 && ['outputs', 'shots', 'derived'].includes(String(path[0]))) return undefined;
  const copy = structuredClone(view);
  let parent: unknown = copy;
  for (const key of path.slice(0, -1)) {
    if (parent === null || typeof parent !== 'object') return undefined;
    parent = (parent as Record<string | number, unknown>)[key];
  }
  if (parent === null || typeof parent !== 'object') return undefined;
  const last = path.at(-1) ?? '';
  const value = (parent as Record<string | number, unknown>)[last];
  // An array's element as a whole (a shot, a cut) only through its fields: its fields are paths of their own.
  if (typeof last === 'number' && value !== null && typeof value === 'object') return undefined;
  const next = changed(value);
  if (!next) return undefined;
  (parent as Record<string | number, unknown>)[last] = next.value;
  return copy;
}
