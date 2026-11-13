// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Picking clips in the Library (UX4): tick a tile's box, ⌘-click a tile or press Space on it to add or take it away;
 * Shift with any of them picks every clip from the last one ticked to this one; a day's box picks the day. Once one
 * is picked the grid is selecting: a plain click picks too, until Done or Escape. Changing the filters or the sort
 * starts again, since the picked clips may not be in the new grid.
 */
import type { AssetId } from '@taalcut/core';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface Picked {
  readonly ids: ReadonlySet<AssetId>;
  /** The index the next Shift range starts from: the last clip ticked or unticked on its own. */
  readonly anchor: number | null;
}

export const NOTHING_PICKED: Picked = { ids: new Set(), anchor: null };

/** One clip in or out; it becomes the anchor. */
export function toggleClip(picked: Picked, id: AssetId, index: number): Picked {
  const ids = new Set(picked.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: index };
}

/**
 * Every clip from the anchor to `index`, added (with no anchor, the clip alone). The anchor stays, so a second Shift
 * range from it reaches somewhere else, as in Finder. Clips not loaded yet are skipped.
 */
export function pickRange(picked: Picked, items: readonly { readonly id: AssetId }[], index: number): Picked {
  const from = picked.anchor ?? index;
  const [low, high] = from <= index ? [from, index] : [index, from];
  const ids = new Set(picked.ids);
  for (let i = low; i <= high; i += 1) {
    const item = items[i];
    if (item) ids.add(item.id);
  }
  return { ids, anchor: picked.anchor ?? index };
}

/** Every one of `ids` in (`on`) or out: a day's box. */
export function pickMany(picked: Picked, ids: readonly AssetId[], on: boolean): Picked {
  const next = new Set(picked.ids);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return { ids: next, anchor: picked.anchor };
}

export interface ClipSelection {
  readonly ids: ReadonlySet<AssetId>;
  /** True once a clip is picked: every tile shows its box and a plain click picks. */
  readonly selecting: boolean;
  /** Clip `index` in or out; with `range`, every clip from the anchor to it. */
  readonly pick: (index: number, range: boolean) => void;
  readonly pickMany: (ids: readonly AssetId[], on: boolean) => void;
  readonly clear: () => void;
}

/** The Library's picked clips, from the grid's clips so far; `resetKey` changing (filters, sort) clears them. */
export function useClipSelection(
  items: readonly { readonly id: AssetId }[],
  resetKey: string,
): ClipSelection {
  const [state, setState] = useState<{ key: string; picked: Picked }>({
    key: resetKey,
    picked: NOTHING_PICKED,
  });
  // Another grid: what was picked may not be in it. Set while rendering, so no frame shows the old picks.
  const picked = state.key === resetKey ? state.picked : NOTHING_PICKED;
  if (state.key !== resetKey) setState({ key: resetKey, picked: NOTHING_PICKED });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const update = useCallback(
    (next: (previous: Picked) => Picked) =>
      setState((previous) => ({
        key: previous.key,
        picked: next(previous.picked),
      })),
    [],
  );
  const pick = useCallback(
    (index: number, range: boolean) => {
      const item = itemsRef.current[index];
      if (!item) return;
      update((previous) =>
        range ? pickRange(previous, itemsRef.current, index) : toggleClip(previous, item.id, index),
      );
    },
    [update],
  );
  const many = useCallback(
    (ids: readonly AssetId[], on: boolean) => update((previous) => pickMany(previous, ids, on)),
    [update],
  );
  const clear = useCallback(() => update(() => NOTHING_PICKED), [update]);
  return useMemo(
    () => ({ ids: picked.ids, selecting: picked.ids.size > 0, pick, pickMany: many, clear }),
    [picked.ids, pick, many, clear],
  );
}
