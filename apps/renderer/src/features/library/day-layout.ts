// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip grid's layout by day (UX4): clips sorted by when they were shot (or added) fall into one block per day,
 * each under its own heading, each block starting on a new row. Pure arithmetic over the clips loaded so far, so it
 * is unit tested apart from the DOM. Clips not loaded yet are one block of bones at the end, without a heading: their
 * days aren't known until their page arrives. Sorted by length or quality there are no days, so one block holds
 * every clip with no heading, as the grid always was.
 *
 * LIB1-PLACE: a clip shot where its file names the time zone (LIB1-OEM's captureOffset) counts on that place's
 * calendar, so an evening in São Paulo stays that evening's day. Sorted by when they were shot, the first day of a trip
 * in the grid's order carries the trip's band above its heading (TRIP_BAND), once per trip.
 */
import type { Trip } from '@taalcut/core';
import type { GridMetrics } from './virtual-grid';

/** The heading band above a day's first row: 12 px over the words, a 24 px line, 8 px under them. */
export const DAY_HEADING = 44;
/** A trip's band above its first day's heading: 28 px over it, the name's 24 px line, a 16 px line of counts, 4 px under. */
export const TRIP_BAND = 72;

/** What the layout reads of a clip. */
export interface DayClip {
  readonly capturedAt: number | null;
  readonly addedAt: number;
  readonly captureOffset?: { readonly minutes: number } | null;
  readonly trip?: Trip | null;
}

/** What the days are counted from: the time a clip was shot (its add time when it has none), or its add time. */
export type DayBasis = 'captured' | 'added';

export interface DayGroup {
  /** The day's key (`2026-10-12`, local time), or `rest` for the clips still to load, or `all` with no days. */
  readonly key: string;
  /** Midnight at the start of the day, local time; null for `rest` and `all`. */
  readonly day: number | null;
  /** The first clip's index in the grid. */
  readonly start: number;
  readonly count: number;
  /** The block's top, px from the grid's top: its heading's top, or its first row's when it has no heading. */
  readonly top: number;
  /** The heading band's height: DAY_HEADING (and TRIP_BAND when a trip starts here), or 0. */
  readonly heading: number;
  /** The trip whose band sits above this day: the first day of it in the grid's order; null otherwise. */
  readonly trip: Trip | null;
  readonly rows: number;
  /** The block's height: heading and rows (the last row's gap included, so blocks sit a gap apart). */
  readonly height: number;
}

export interface DayLayout {
  readonly groups: readonly DayGroup[];
  /** Every block's height together, less the last row's gap. */
  readonly height: number;
  readonly columns: number;
  readonly row: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A local day's key: the same calendar day on this computer is the same key. */
export function dayKeyOf(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight at the start of the local day `epochMs` falls in. */
export function dayStartOf(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The time a clip's day is counted from. */
export function dayTimeOf(
  clip: { readonly capturedAt: number | null; readonly addedAt: number },
  basis: DayBasis,
): number {
  return basis === 'added' ? clip.addedAt : (clip.capturedAt ?? clip.addedAt);
}

/**
 * The calendar day a clip falls on: where it was shot when its file names the time zone (counted from the
 * capture), else this computer's. Its key and its midnight on this computer, for the heading's words.
 */
export function clipDay(clip: DayClip, basis: DayBasis): { key: string; start: number } {
  const at = dayTimeOf(clip, basis);
  const offset = basis === 'captured' && clip.capturedAt !== null ? clip.captureOffset?.minutes : undefined;
  if (offset === undefined) return { key: dayKeyOf(at), start: dayStartOf(at) };
  const there = new Date(at + offset * 60_000);
  const [year, month, day] = [there.getUTCFullYear(), there.getUTCMonth(), there.getUTCDate()];
  return { key: `${year}-${pad(month + 1)}-${pad(day)}`, start: new Date(year, month, day).getTime() };
}

function block(
  key: string,
  day: number | null,
  start: number,
  count: number,
  top: number,
  heading: number,
  metrics: Pick<GridMetrics, 'columns' | 'row'>,
  trip: Trip | null = null,
): DayGroup {
  const rows = Math.ceil(count / metrics.columns);
  return { key, day, start, count, top, heading, trip, rows, height: heading + rows * metrics.row };
}

/**
 * The blocks for `items` (the clips loaded so far, in the grid's order) out of `total`. `basis` null: no days, one
 * block without a heading.
 */
export function layoutDays(
  items: readonly DayClip[],
  total: number,
  metrics: Pick<GridMetrics, 'columns' | 'row' | 'gap'>,
  basis: DayBasis | null,
): DayLayout {
  const groups: DayGroup[] = [];
  let top = 0;
  const push = (group: DayGroup) => {
    groups.push(group);
    top += group.height;
  };
  const loaded = Math.min(items.length, total);
  if (basis === null) {
    if (total > 0) push(block('all', null, 0, total, 0, 0, metrics));
  } else {
    let start = 0;
    const keys = new Set<string>();
    const banded = new Set<string>();
    while (start < loaded) {
      const first = clipDay(items[start]!, basis);
      let end = start + 1;
      while (end < loaded && clipDay(items[end]!, basis).key === first.key) end += 1;
      // A day can come round again when clips shot in different time zones interleave: its block keeps a key of
      // its own.
      let key = first.key;
      for (let n = 2; keys.has(key); n += 1) key = `${first.key}~${n}`;
      keys.add(key);
      const trip = basis === 'captured' ? tripOfDay(items, start, end) : null;
      const band = trip !== null && !banded.has(trip.id);
      if (band) banded.add(trip.id);
      const heading = DAY_HEADING + (band ? TRIP_BAND : 0);
      push(block(key, first.start, start, end - start, top, heading, metrics, band ? trip : null));
      start = end;
    }
    if (total > loaded) push(block('rest', null, loaded, total - loaded, top, 0, metrics));
  }
  return {
    groups,
    height: Math.max(0, top - (groups.length > 0 ? metrics.gap : 0)),
    columns: metrics.columns,
    row: metrics.row,
  };
}

/** The trip most of a day's clips are in, or null. */
function tripOfDay(items: readonly DayClip[], start: number, end: number): Trip | null {
  const counts = new Map<string, { trip: Trip; n: number }>();
  for (let i = start; i < end; i += 1) {
    const trip = items[i]!.trip;
    if (!trip) continue;
    const entry = counts.get(trip.id) ?? { trip, n: 0 };
    entry.n += 1;
    counts.set(trip.id, entry);
  }
  let best: { trip: Trip; n: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best && best.n * 2 >= end - start ? best.trip : null;
}

/** The block that holds clip `index`. */
export function groupOf(layout: DayLayout, index: number): DayGroup | undefined {
  const { groups } = layout;
  let low = 0;
  let high = groups.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const group = groups[mid]!;
    if (index < group.start) high = mid - 1;
    else if (index >= group.start + group.count) low = mid + 1;
    else return group;
  }
  return undefined;
}

/** Where clip `index` sits in the grid: its column, and its row's top in px. */
export function placeOf(layout: DayLayout, index: number): { column: number; top: number } | null {
  const group = groupOf(layout, index);
  if (!group) return null;
  const offset = index - group.start;
  return {
    column: offset % layout.columns,
    top: group.top + group.heading + Math.floor(offset / layout.columns) * layout.row,
  };
}

/** The first block whose bottom is below `y`. */
function firstBelow(groups: readonly DayGroup[], y: number): number {
  let low = 0;
  let high = groups.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const group = groups[mid]!;
    if (group.top + group.height <= y) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface DayWindow {
  /** The first clip to draw. */
  readonly first: number;
  /** One past the last clip to draw. */
  readonly last: number;
  /** The blocks that have a clip drawn. */
  readonly groups: readonly DayGroup[];
}

/**
 * The clips whose rows meet the band from `top` to `bottom` (px from the grid's top), with `overscan` rows either
 * side, so a fast scroll never shows a gap before React catches up. Clips are in order, so they are one range.
 */
export function windowOf(layout: DayLayout, top: number, bottom: number, overscan = 3): DayWindow {
  const { groups, row, columns } = layout;
  const margin = overscan * row;
  const from = Math.max(0, top - margin);
  const to = bottom + margin;
  let g = firstBelow(groups, from);
  const drawn: DayGroup[] = [];
  let first = -1;
  let last = -1;
  for (; g < groups.length; g += 1) {
    const group = groups[g]!;
    if (group.top >= to) break;
    const rowsTop = group.top + group.heading;
    const startRow = Math.max(0, Math.floor((from - rowsTop) / row));
    const endRow = Math.min(group.rows, Math.ceil((to - rowsTop) / row));
    if (endRow <= startRow) continue;
    const a = group.start + startRow * columns;
    const b = Math.min(group.start + group.count, group.start + endRow * columns);
    if (first < 0) first = a;
    last = b;
    drawn.push(group);
  }
  return first < 0 ? { first: 0, last: 0, groups: [] } : { first, last, groups: drawn };
}

/**
 * The clip an arrow, Home, End, Page Up or Page Down moves to from `index`, among the first `count` clips (those
 * loaded); null for any other key. Up and down keep the column, held to the length of a short last row, and step
 * from one day's last row to the next day's first.
 */
export function moveInDays(
  key: string,
  index: number,
  count: number,
  layout: DayLayout,
  pageRows: number,
): number | null {
  if (count === 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(count - 1, n));
  const step = (from: number, direction: 1 | -1): number => {
    const group = groupOf(layout, from);
    if (!group) return from;
    const { columns } = layout;
    const offset = from - group.start;
    const column = offset % columns;
    const row = Math.floor(offset / columns) + direction;
    // Within the day, or into the next or last day's nearest row.
    const target =
      row >= 0 && row < group.rows
        ? group
        : direction > 0
          ? groupOf(layout, group.start + group.count)
          : groupOf(layout, group.start - 1);
    if (!target) return from;
    const targetRow = target === group ? row : direction > 0 ? 0 : target.rows - 1;
    const rowStart = target.start + targetRow * columns;
    const rowEnd = Math.min(target.start + target.count, rowStart + columns) - 1;
    return clamp(Math.min(rowStart + column, rowEnd));
  };
  const repeat = (direction: 1 | -1, times: number) => {
    let at = index;
    for (let i = 0; i < times; i += 1) at = step(at, direction);
    return at;
  };
  switch (key) {
    case 'ArrowRight':
      return clamp(index + 1);
    case 'ArrowLeft':
      return clamp(index - 1);
    case 'ArrowDown':
      return repeat(1, 1);
    case 'ArrowUp':
      return repeat(-1, 1);
    case 'PageDown':
      return repeat(1, Math.max(1, pageRows));
    case 'PageUp':
      return repeat(-1, Math.max(1, pageRows));
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
