// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * References → places in the conversation's latest template and timeline (P3-V15, SPEC section 23). A time in
 * a slot's half-open range is that slot; "the transition at t" is the cut on t (within 2 frames) or nearest
 * it within ±0.5 s, i.e. the slot that starts there; on the timeline a time is the clip on the main video track
 * and its slot. What can't be found is `unresolved` with the reason, so the model says so instead of guessing.
 * A selection chip the user added wins over a parsed reference to the same thing. Everything here is
 * RationalTime and TimeRange; core's pointer is built from the result in core-pointer.ts.
 */
import {
  RationalTime,
  TimeRange,
  type FrameRate,
  type ReferencePointer,
  type SelectionChip,
  type SlotId,
  type Template,
  type TemplateId,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import {
  cutAt,
  extent,
  mainTrackSpans,
  nearestCut,
  slotSpans,
  type ItemSpan,
  type Placed,
  type SlotSpan,
} from './layout';
import { LAST } from './lexicon';
import type { ParsedReferences, ReferenceTarget, TimeReference } from './parse';

/** Core keeps at most ten pointers per message. */
export const MAX_POINTERS = 10;
const MAX_SLOT_NUMBER = 200;

export type UnresolvedWhy = 'outOfRange' | 'noTemplate' | 'noTimeline' | 'noCut';

/** One reference, resolved: core's pointer fields with times as TimeRange, and what the note says beyond them. */
export interface ResolvedReference {
  readonly said: string;
  readonly basis: 'template' | 'timeline';
  readonly kind: ReferencePointer['kind'];
  readonly templateId: TemplateId | null;
  readonly timelineId: TimelineId | null;
  readonly slotId: SlotId | null;
  readonly slotNumber: number | null;
  readonly clipId: TimelineItemId | null;
  /** In the basis's time: the slot, clip or range; empty at a cut; what was said when unresolved. */
  readonly range: TimeRange | null;
  /** The basis's canvas rate (the template's or the timeline's), when that video is known. */
  readonly rate: FrameRate | null;
  readonly templateRange: TimeRange | null;
  readonly timelineRange: TimeRange | null;
  /** The slot's intent: template text, untrusted. */
  readonly intent: string | null;
  /** For cuts: the transition into the slot ('cut' when there is none). */
  readonly transition: string | null;
  /** For ranges: the slot numbers it covers. */
  readonly covers: readonly number[];
  readonly why: UnresolvedWhy | null;
  /** How many slots (or clips) the basis has, for an unresolved number. */
  readonly count: number | null;
  /** A reference place's slot in the user's own video, when the conversation has one: where to act. */
  readonly theirs: { readonly timelineId: TimelineId; readonly clipId: TimelineItemId | null } | null;
}

export interface PointerContext {
  /** The version the timeline uses, else the conversation's template. */
  readonly template?: Template;
  readonly timeline?: Timeline;
  readonly selections?: readonly SelectionChip[];
}

interface Layout {
  readonly template?: Template;
  readonly timeline?: Timeline;
  readonly slots: readonly SlotSpan[];
  readonly items: readonly ItemSpan[];
}

type Basis = ResolvedReference['basis'];
type Kind = ResolvedReference['kind'];

const NOTHING = {
  slotId: null,
  slotNumber: null,
  clipId: null,
  range: null,
  templateRange: null,
  timelineRange: null,
  intent: null,
  transition: null,
  covers: [],
  why: null,
  count: null,
  theirs: null,
};

function base(layout: Layout, reference: TimeReference, basis: Basis) {
  const video = basis === 'timeline' ? layout.timeline : layout.template;
  return {
    said: reference.said,
    basis,
    templateId: layout.template?.id ?? null,
    timelineId: basis === 'timeline' ? (layout.timeline?.id ?? null) : null,
    rate: video?.canvas.rate ?? null,
  };
}

/** What was said, as a range: an instant for a time, the range for a range, nothing for a slot. */
function saidRange(target: ReferenceTarget): TimeRange | null {
  if (target.kind === 'time') return TimeRange.of(target.at, RationalTime.zero(target.at.rate));
  return target.kind === 'range' ? target.range : null;
}

function unresolved(
  layout: Layout,
  reference: TimeReference,
  basis: Basis,
  why: UnresolvedWhy,
  count: number | null = null,
): ResolvedReference {
  const { target } = reference;
  const slotNumber =
    target.kind === 'slot' && target.index > 0 && target.index <= MAX_SLOT_NUMBER ? target.index : null;
  return {
    ...NOTHING,
    ...base(layout, reference, basis),
    kind: 'unresolved',
    slotNumber,
    range: saidRange(target),
    why,
    count,
  };
}

const slotNumberOf = (layout: Layout, slotId: string | null) =>
  layout.slots.find((s) => s.slot.id === slotId)?.number ?? null;
/** Core's pointer names slots 1–200; a track position past that has no number. */
const capped = (number: number | null) => (number !== null && number <= MAX_SLOT_NUMBER ? number : null);
const itemFor = (layout: Layout, slotId: string) => layout.items.find((item) => item.slotId === slotId);
const slotFor = (layout: Layout, slotId: string | null) => layout.slots.find((s) => s.slot.id === slotId);
const clipId = (item: ItemSpan | undefined) => (item?.kind === 'clip' ? item.id : null);
const theirs = (layout: Layout, item: ItemSpan | undefined) =>
  layout.timeline && item ? { timelineId: layout.timeline.id, clipId: clipId(item) } : null;
/** A cut is the instant its span starts; anything else is the whole span. */
const rangeOf = (span: Placed, kind: Kind): TimeRange => (kind === 'cut' ? cutAt(span) : span.range);
const intentOf = (slot: SlotSpan | undefined) => slot?.slot.intent.text.trim().slice(0, 60) || null;
const holding = <S extends Placed>(spans: readonly S[], t: RationalTime) =>
  spans.find((s) => TimeRange.contains(s.range, t));

function inTemplate(layout: Layout, reference: TimeReference): ResolvedReference {
  if (!layout.template) return unresolved(layout, reference, 'template', 'noTemplate');
  const { slots } = layout;
  const placeAt = (slot: SlotSpan, kind: 'slot' | 'cut'): ResolvedReference => {
    const item = itemFor(layout, slot.slot.id);
    const range = rangeOf(slot, kind);
    return {
      ...NOTHING,
      ...base(layout, reference, 'template'),
      kind,
      slotId: slot.slot.id,
      slotNumber: slot.number,
      range,
      templateRange: range,
      timelineRange: item ? rangeOf(item, kind) : null,
      intent: intentOf(slot),
      transition: kind === 'cut' ? (slot.slot.transitionIn?.kind ?? 'cut') : null,
      theirs: theirs(layout, item),
    };
  };
  const { target } = reference;
  if (target.kind === 'slot') {
    const slot = slots[(target.index === LAST ? slots.length : target.index) - 1];
    if (!slot) return unresolved(layout, reference, 'template', 'outOfRange', slots.length);
    return placeAt(slot, reference.cut && slot.number > 1 ? 'cut' : 'slot');
  }
  if (target.kind === 'time') {
    if (reference.cut) {
      const cut = nearestCut(slots, target.at);
      return cut ? placeAt(cut, 'cut') : unresolved(layout, reference, 'template', 'noCut');
    }
    const slot = holding(slots, target.at);
    return slot ? placeAt(slot, 'slot') : unresolved(layout, reference, 'template', 'outOfRange');
  }
  return rangeIn(layout, reference, target.range, 'template');
}

function inTimeline(layout: Layout, reference: TimeReference): ResolvedReference {
  if (!layout.timeline) return unresolved(layout, reference, 'timeline', 'noTimeline');
  const { items } = layout;
  const placeAt = (
    item: ItemSpan,
    kind: 'clip' | 'slot' | 'cut',
    number: number | null,
  ): ResolvedReference => {
    const slot = slotFor(layout, item.slotId);
    const range = rangeOf(item, kind);
    return {
      ...NOTHING,
      ...base(layout, reference, 'timeline'),
      kind,
      slotId: item.slotId,
      slotNumber: capped(slotNumberOf(layout, item.slotId) ?? number),
      clipId: clipId(item),
      range,
      templateRange: slot ? rangeOf(slot, kind) : null,
      timelineRange: range,
      intent: intentOf(slot),
      transition: kind === 'cut' ? (item.transitionIn ?? 'cut') : null,
    };
  };
  const kindOf = (item: ItemSpan) => (item.kind === 'clip' ? 'clip' : 'slot');
  const { target } = reference;
  if (target.kind === 'slot') {
    // By the template's slot order when there is one, else by the track's order.
    const count = layout.slots.length > 0 ? layout.slots.length : items.length;
    const number = target.index === LAST ? count : target.index;
    const slot = layout.slots[number - 1];
    const item = slot
      ? itemFor(layout, slot.slot.id)
      : layout.slots.length === 0
        ? items[number - 1]
        : undefined;
    if (!item) return unresolved(layout, reference, 'timeline', 'outOfRange', count);
    return placeAt(item, reference.cut && number > 1 ? 'cut' : kindOf(item), number);
  }
  if (target.kind === 'time') {
    if (reference.cut) {
      const cut = nearestCut(items, target.at);
      return cut
        ? placeAt(cut, 'cut', items.indexOf(cut) + 1)
        : unresolved(layout, reference, 'timeline', 'noCut');
    }
    const item = holding(items, target.at);
    return item
      ? placeAt(item, kindOf(item), items.indexOf(item) + 1)
      : unresolved(layout, reference, 'timeline', 'outOfRange');
  }
  return rangeIn(layout, reference, target.range, 'timeline');
}

function rangeIn(layout: Layout, reference: TimeReference, said: TimeRange, basis: Basis): ResolvedReference {
  const spans: readonly (SlotSpan | ItemSpan)[] = basis === 'template' ? layout.slots : layout.items;
  const covered = spans.filter((s) => TimeRange.overlaps(s.range, said));
  const first = covered[0];
  const whole = extent(spans);
  // What was said, cut to the video's end.
  const range = whole ? TimeRange.intersection(said, whole) : undefined;
  if (!first || !range) return unresolved(layout, reference, basis, 'outOfRange');
  const slotId = 'slot' in first ? first.slot.id : first.slotId;
  const slot = slotFor(layout, slotId);
  const item = 'slot' in first ? itemFor(layout, first.slot.id) : first;
  const numberOf = (s: SlotSpan | ItemSpan) =>
    'slot' in s ? s.number : (slotNumberOf(layout, s.slotId) ?? spans.indexOf(s) + 1);
  return {
    ...NOTHING,
    ...base(layout, reference, basis),
    kind: 'range',
    slotId,
    slotNumber: capped(numberOf(first)),
    clipId: basis === 'timeline' ? clipId(item) : null,
    range,
    templateRange: basis === 'template' ? range : slot ? slot.range : null,
    timelineRange: basis === 'timeline' ? range : item ? item.range : null,
    intent: intentOf(slot),
    covers: covered.map(numberOf),
    theirs: basis === 'template' ? theirs(layout, item) : null,
  };
}

/** A chip the user added names the same slot or clip: the chip says it already. */
function chosenByChip(place: ResolvedReference, selections: readonly SelectionChip[]): boolean {
  return selections.some(
    (chip) =>
      (chip.kind === 'slot' && place.slotId !== null && chip.slotId === place.slotId) ||
      (chip.kind === 'clip' && place.clipId !== null && chip.clipId === place.clipId) ||
      (chip.kind === 'item' && place.clipId !== null && chip.itemId === place.clipId),
  );
}

export function resolveReferences(parsed: ParsedReferences, context: PointerContext): ResolvedReference[] {
  const layout: Layout = {
    ...(context.template ? { template: context.template } : {}),
    ...(context.timeline ? { timeline: context.timeline } : {}),
    slots: context.template ? slotSpans(context.template) : [],
    items: context.timeline ? mainTrackSpans(context.timeline) : [],
  };
  const resolved = parsed.references.flatMap((reference) => {
    if (parsed.basis === 'template') return [inTemplate(layout, reference)];
    if (parsed.basis === 'timeline') return [inTimeline(layout, reference)];
    // Unclear: both videos, as far as the conversation has them.
    const both = [
      ...(layout.template ? [inTemplate(layout, reference)] : []),
      ...(layout.timeline ? [inTimeline(layout, reference)] : []),
    ];
    return both.length > 0 ? both : [inTemplate(layout, reference)];
  });
  const selections = context.selections ?? [];
  return resolved.filter((r) => !chosenByChip(r, selections)).slice(0, MAX_POINTERS);
}
