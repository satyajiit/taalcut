// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: the changes card's rows, from the timeline before and after a turn (edit-snapshot.ts). One row per item
 * and kind of change, in time order, the whole-video settings last; at most MAX_EDIT_CHANGES, the rest counted.
 *
 * Rules: an id only after is `added`, only before `removed`. A clip that changed place among the clips is `order`
 * only when it moved itself: the clips that kept their order (the longest run in order) don't, so one clip dragged
 * ahead isn't reported as every clip after it moving. Starts are reported for text, graphics and captions; a clip's
 * start follows from the ones before it. Lengths and starts count from a frame's difference. `other` only when
 * nothing else about the item changed. FIX-TRIM: `part` (a slip) only for a clip that plays the same footage, in
 * its place among the clips, for the same length, from another in-point. HFW1: `design` when a composition graphic is
 * drawn with another composition (or another version) than before; never for a snapshot from before HFW1.
 */
import { MAX_EDIT_CHANGES, type EditChange, type EditChangeRow } from '../cards/edit-changes-card';
import type { EditItemFacts, EditSnapshot } from './edit-snapshot';
import type { TimelineId } from '../basics/ids';
import type { EditItemTarget } from './edit-target';

/** Under a frame at 60 fps: a change smaller than this is rounding, not an edit. */
const EPSILON = 1 / 120;
const SETTING_ORDER = ['music', 'captions', 'look', 'voiceover', 'mix'] as const;

export interface EditDiff {
  readonly changes: EditChangeRow[];
  /** Rows beyond MAX_EDIT_CHANGES. */
  readonly more: number;
}

/** Indices (into `values`) of one longest strictly increasing run: the clips that kept their order. */
function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = new Array<number>(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < values[index]!) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const kept = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) kept.add(index);
  return kept;
}

/** The clips (ids) that moved among the clips, from their order before and after. */
function movedClips(before: readonly EditItemFacts[], after: readonly EditItemFacts[]): Set<string> {
  const afterIds = after.filter((item) => item.kind === 'clip').map((item) => item.id);
  const common = new Set(afterIds);
  const beforeOrder = before
    .filter((item) => item.kind === 'clip' && common.has(item.id))
    .map((item) => item.id);
  const shared = new Set(beforeOrder);
  const position = new Map(afterIds.filter((id) => shared.has(id)).map((id, index) => [id, index]));
  const kept = longestIncreasing(beforeOrder.map((id) => position.get(id)!));
  return new Set(beforeOrder.filter((_, index) => !kept.has(index)));
}

const differs = (a: number, b: number) => Math.abs(a - b) > EPSILON;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** What changed about one item that is on both timelines, in the card's order of importance. */
function itemChanges(before: EditItemFacts, after: EditItemFacts, moved: boolean): EditChange[] {
  const out: EditChange[] = [];
  if (before.media !== undefined && after.media !== undefined && before.media !== after.media)
    out.push({ kind: 'media' });
  if (moved) out.push({ kind: 'order', before: before.number, after: after.number });
  const longer = differs(before.length, after.length);
  if (longer) out.push({ kind: 'length', before: round(before.length), after: round(after.length) });
  if (
    before.part !== undefined &&
    after.part !== undefined &&
    before.media === after.media &&
    !moved &&
    !longer &&
    differs(before.part, after.part)
  )
    out.push({ kind: 'part', before: round(before.part), after: round(after.part) });
  const timed = after.kind === 'text' || after.kind === 'graphic' || after.kind === 'caption';
  if (timed && differs(before.start, after.start))
    out.push({ kind: 'start', before: round(before.start), after: round(after.start) });
  if (before.words !== undefined && after.words !== undefined && before.words !== after.words)
    out.push({ kind: 'words', before: before.words, after: after.words });
  if (before.place && after.place && before.place !== after.place)
    out.push({ kind: 'place', before: before.place, after: after.place });
  if (before.speed !== undefined && after.speed !== undefined && before.speed !== after.speed)
    out.push({ kind: 'speed', before: before.speed, after: after.speed });
  if (before.framing && after.framing && before.framing !== after.framing)
    out.push({ kind: 'framing', before: before.framing, after: after.framing });
  if (before.transition && after.transition && before.transition !== after.transition)
    out.push({ kind: 'transition', before: before.transition, after: after.transition });
  if (before.volume !== undefined && after.volume !== undefined && before.volume !== after.volume)
    out.push({ kind: 'volume', before: before.volume, after: after.volume });
  if (before.design && after.design && before.design.key !== after.design.key)
    out.push({
      kind: 'design',
      before: { name: before.design.name, version: before.design.version },
      after: { name: after.design.name, version: after.design.version },
      proposed: after.proposed === true,
    });
  if (out.length === 0 && before.rest !== after.rest) out.push({ kind: 'other' });
  return out;
}

function row(timelineId: TimelineId, item: EditItemFacts, change: EditChange): EditChangeRow {
  const target = { kind: 'item', timelineId, itemId: item.id, itemKind: item.kind } as EditItemTarget;
  return {
    target,
    number: item.number,
    ...(item.role ? { role: item.role } : {}),
    at: round(item.start),
    change,
  };
}

/** The rows of the changes card for a turn that took the timeline from `before` to `after`. */
export function diffEdits(before: EditSnapshot, after: EditSnapshot): EditDiff {
  const timelineId = after.timelineId as TimelineId;
  const earlier = new Map(before.items.map((item) => [item.id, item]));
  const later = new Set(after.items.map((item) => item.id));
  const moved = movedClips(before.items, after.items);
  const rows: EditChangeRow[] = [];
  for (const item of after.items) {
    const was = earlier.get(item.id);
    if (!was) rows.push(row(timelineId, item, { kind: 'added' }));
    else
      for (const change of itemChanges(was, item, moved.has(item.id)))
        rows.push(row(timelineId, item, change));
  }
  for (const item of before.items)
    if (!later.has(item.id)) rows.push(row(timelineId, item, { kind: 'removed' }));
  // In time order (a stable sort keeps one item's rows together); the whole-video settings after them.
  rows.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (const what of SETTING_ORDER)
    if (before.settings[what] !== after.settings[what])
      rows.push({
        target: { kind: 'timeline', timelineId },
        number: null,
        at: null,
        change: { kind: 'setting', what },
      });
  return { changes: rows.slice(0, MAX_EDIT_CHANGES), more: Math.max(0, rows.length - MAX_EDIT_CHANGES) };
}
