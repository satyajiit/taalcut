// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Energy curve (P3-V12). A section keeps its span, so boundary cuts stay put. An unchanged
 * piece (same start and length) is copied whole, so the default curve round-trips.
 */
import {
  BEATS_PER_CLIP,
  err,
  ok,
  RationalTime,
  templateSchema,
  type EnergyCurve,
  type EnergySection,
  type EnergySlotMap,
  type FrameRate,
  type Result,
  type SlotId,
  type Template,
  type TemplateSlot,
  type Transition,
} from '@taalcut/core';
import { anchorAt, beatFrames, computePacing } from '../edits/timing';
import { EnergyCurveInvalid, NoBeatMap } from '../errors';
import { ENERGY_CONFIG, type EnergyConfig } from './energy-config';
import { beatIndexAt, beatInterval, mergeShort, pieceTooShort, sectionCutFrames } from './energy-grid';

export interface EnergyIds {
  slot(): SlotId;
}

const framesOf = (time: { readonly value: number; readonly rate: FrameRate }, rate: FrameRate) =>
  RationalTime.toFrames(time, rate);

function invalid(reason: string, detail?: string): Result<never> {
  return err(EnergyCurveInvalid({ reason }, detail ? { detail } : {}));
}

function roundBeats(value: number): EnergySection['beatsPerClip'] {
  let best: EnergySection['beatsPerClip'] = BEATS_PER_CLIP[0];
  let bestDist = Infinity;
  for (const candidate of BEATS_PER_CLIP) {
    const dist = Math.abs(candidate - value);
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && candidate < best)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const here = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return here;
  return ((sorted[mid - 1] ?? 0) + here) / 2;
}

/** Runs of the same role: median length in beats, mean intent energy, aligned to the beat. */
export function energyCurveOf(template: Template): EnergyCurve {
  const rate = template.canvas.rate;
  const beats = beatFrames(template.beatMap, rate);
  const sections: EnergySection[] = [];
  let index = 0;
  while (index < template.slots.length) {
    const first = template.slots[index];
    if (!first) break;
    let end = index;
    while (template.slots[end + 1]?.role === first.role) end += 1;
    const run = template.slots.slice(index, end + 1);
    const last = run[run.length - 1] ?? first;
    const lengths = run.map((slot) => {
      const start = framesOf(slot.start, rate);
      return framesOf(slot.duration, rate) / beatInterval(beats, beatIndexAt(beats, start));
    });
    const energy = run.reduce((sum, slot) => sum + slot.intent.energy, 0) / run.length;
    sections.push({
      fromSlotId: first.id,
      toSlotId: last.id,
      energy: Math.min(1, Math.max(0, energy)),
      beatsPerClip: roundBeats(median(lengths)),
      align: 'beat',
    });
    index = end + 1;
  }
  return { sections };
}

interface Span {
  readonly section: EnergySection;
  readonly slots: readonly TemplateSlot[];
  readonly start: number;
  readonly end: number;
}

function tile(template: Template, curve: EnergyCurve, rate: FrameRate): Result<Span[]> {
  const indexOf = new Map(template.slots.map((slot, index) => [slot.id, index]));
  const spans: Span[] = [];
  let cursor = 0;
  for (const section of curve.sections) {
    const from = indexOf.get(section.fromSlotId);
    const to = indexOf.get(section.toSlotId);
    if (from === undefined || to === undefined) return invalid('unknown-slot');
    if (from > to) return invalid('order');
    if (from < cursor) return invalid('overlap');
    if (from > cursor) return invalid('gap');
    const slots = template.slots.slice(from, to + 1);
    const first = slots[0];
    const last = slots[slots.length - 1];
    if (!first || !last) return invalid('gap');
    spans.push({
      section,
      slots,
      start: framesOf(first.start, rate),
      end: framesOf(last.start, rate) + framesOf(last.duration, rate),
    });
    cursor = to + 1;
  }
  if (cursor !== template.slots.length) return invalid('gap');
  return ok(spans);
}

function overlapOf(slot: TemplateSlot, start: number, end: number, rate: FrameRate): number {
  const slotStart = framesOf(slot.start, rate);
  const slotEnd = slotStart + framesOf(slot.duration, rate);
  return Math.min(end, slotEnd) - Math.max(start, slotStart);
}

function mostOverlap(
  slots: readonly TemplateSlot[],
  start: number,
  end: number,
  rate: FrameRate,
): TemplateSlot {
  let best = slots[0];
  let bestOverlap = -1;
  for (const slot of slots) {
    const overlap = overlapOf(slot, start, end, rate);
    if (best && overlap > bestOverlap) {
      best = slot;
      bestOverlap = overlap;
    }
  }
  if (!best) throw new Error('energy section has no slots');
  return best;
}

function fitTransition(
  transition: Transition | null,
  previous: number,
  duration: number,
  rate: FrameRate,
): Transition | null {
  if (!transition || previous < 1) return null;
  if (framesOf(transition.before, rate) > previous) return null;
  if (framesOf(transition.after, rate) > duration) return null;
  return transition;
}

interface Piece {
  readonly start: number;
  readonly end: number;
  readonly span: Span;
}

function piecesOf(template: Template, spans: readonly Span[], rate: FrameRate): Piece[] {
  const beats = beatFrames(template.beatMap, rate);
  const downbeats = (template.beatMap?.downbeats ?? []).flatMap((index) => {
    const frame = beats[index];
    return frame === undefined ? [] : [frame];
  });
  const hookMax = RationalTime.toFrames(RationalTime.fromSeconds(1.5, rate), rate);
  const pieces: Piece[] = [];
  for (const span of spans) {
    const cuts = mergeShort(
      sectionCutFrames({
        start: span.start,
        end: span.end,
        beats,
        downbeats,
        beatsPerClip: span.section.beatsPerClip,
        align: span.section.align,
        hookMax: span.start === 0 ? hookMax : null,
      }),
      (start, length) => pieceTooShort(start, length, beats, span.section.beatsPerClip),
      (end) => span.start === 0 && end > hookMax,
    );
    for (let index = 0; index < cuts.length - 1; index += 1) {
      const start = cuts[index];
      const end = cuts[index + 1];
      if (start === undefined || end === undefined || end <= start) continue;
      pieces.push({ start, end, span });
    }
  }
  return pieces;
}

function buildSlots(template: Template, pieces: readonly Piece[], ids: EnergyIds, rate: FrameRate) {
  const beats = beatFrames(template.beatMap, rate);
  const byStart = new Map<number, TemplateSlot>();
  for (const slot of template.slots) {
    const start = framesOf(slot.start, rate);
    if (!byStart.has(start)) byStart.set(start, slot);
  }
  const opening = template.slots[0];
  const slots: TemplateSlot[] = [];
  const slotMap: EnergySlotMap = [];
  for (const piece of pieces) {
    const length = piece.end - piece.start;
    const kept = byStart.get(piece.start);
    const unchanged = kept !== undefined && framesOf(kept.duration, rate) === length;
    const from = piece.span.slots
      .filter((slot) => overlapOf(slot, piece.start, piece.end, rate) > 0)
      .map((slot) => slot.id);
    const source = mostOverlap(piece.span.slots, piece.start, piece.end, rate);
    const previous = slots[slots.length - 1];
    const previousLength = previous ? framesOf(previous.duration, rate) : 0;
    const slot: TemplateSlot = unchanged
      ? { ...kept }
      : {
          id: kept?.id ?? ids.slot(),
          name: kept?.name ?? null,
          role: piece.start === 0 && opening?.role === 'hook' ? 'hook' : source.role,
          start: RationalTime.of(piece.start, rate),
          duration: RationalTime.of(length, rate),
          intent: { ...source.intent, energy: piece.span.section.energy },
          beatAnchor: anchorAt(beats, piece.start, rate),
          transitionIn: fitTransition(kept?.transitionIn ?? null, previousLength, length, rate),
          speedRamp: null,
          cut: kept?.cut ?? { method: 'user', confidence: 1 },
          approved: false,
          frame: kept?.frame ?? null,
        };
    slots.push(slot);
    slotMap.push({ slotId: slot.id, from: from.length > 0 ? from : [source.id], unchanged });
  }
  return { slots, slotMap };
}

function holding(slots: readonly TemplateSlot[], frame: number, rate: FrameRate): SlotId {
  for (const slot of slots) {
    const start = framesOf(slot.start, rate);
    if (frame >= start && frame < start + framesOf(slot.duration, rate)) return slot.id;
  }
  const last = slots[slots.length - 1];
  if (!last) throw new Error('energy curve produced no slots');
  return last.id;
}

/** Re-split `template` on `curve`. The input is not mutated; version fields stay as they are. */
export function applyEnergyCurve(
  template: Template,
  curve: EnergyCurve,
  ids: EnergyIds,
  config: EnergyConfig = ENERGY_CONFIG,
): Result<{ readonly template: Template; readonly slotMap: EnergySlotMap }> {
  if (config.version < 1 || config.levels.length === 0) return invalid('config');
  if (!template.beatMap || template.beatMap.beats.length === 0) return err(NoBeatMap());
  const rate = template.canvas.rate;
  const spans = tile(template, curve, rate);
  if (!spans.ok) return spans;
  const built = buildSlots(template, piecesOf(template, spans.value, rate), ids, rate);
  const text = template.text.map((overlay) => ({
    ...overlay,
    slotId: overlay.slotId === null ? null : holding(built.slots, framesOf(overlay.start, rate), rate),
  }));
  const contactSheet = template.contactSheet
    ? {
        ...template.contactSheet,
        frames: template.contactSheet.frames.map((frame) =>
          frame.slotId === null
            ? frame
            : { ...frame, slotId: holding(built.slots, framesOf(frame.at, rate), rate) },
        ),
      }
    : null;
  const draft = {
    ...template,
    slots: built.slots,
    text,
    pacing: computePacing(built.slots, template.beatMap, rate),
    contactSheet,
  };
  const parsed = templateSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid('invariant', issue ? `${issue.path.join('.')}: ${issue.message}` : 'invariant');
  }
  return ok({ template: parsed.data, slotMap: built.slotMap });
}
