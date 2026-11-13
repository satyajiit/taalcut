// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template re-split by an energy curve (P3-V12), as @taalcut/templates' applyEnergyCurve does it: the sections
 * tile the slots in order, each section keeps its span (so the cuts between sections stay put) and is cut on the
 * beat grid every `beatsPerClip` beats; a piece with the same start and length as an old slot keeps that slot
 * whole, so the default curve gives the template back. Errors are the real ones (templates.no_beat_map,
 * templates.energy_curve_invalid). The fake's planEnergyCurve and applyEnergyCurve, and the template page's
 * preview, use it.
 */
import {
  err,
  ok,
  RationalTime,
  templateSchema,
  type EnergyCurve,
  type EnergySection,
  type EnergySlotMap,
  type FrameRate,
  type PacingStats,
  type Result,
  type SlotId,
  type TaalcutError,
  type Template,
  type TemplateSlot,
  type Transition,
} from '@taalcut/core';
import { anchorAt, beatFrames, mergeShort, onBeat, pieceTooShort, sectionCutFrames } from './energy-grid';

/** The templates package's errors, as values (that package defines the codes; a code is defined once). */
const templatesError = (code: string, params?: Record<string, string>): TaalcutError => ({
  code: `templates.${code}`,
  messageKey: `errors.templates.${code}`,
  retryable: false,
  ...(params ? { params } : {}),
});

/** Names the new slots: the same ids for the plan, the command and its redo. */
export interface EnergyIds {
  slot(): SlotId;
}

export interface EnergySplit {
  readonly template: Template;
  readonly slotMap: EnergySlotMap;
}

const HOOK_CAP_SECONDS = 3;
const framesOf = (time: RationalTime, rate: FrameRate) => RationalTime.toFrames(time, rate);
const invalid = (reason: string) => err(templatesError('energy_curve_invalid', { reason }));

interface Span {
  readonly section: EnergySection;
  readonly slots: readonly TemplateSlot[];
  readonly start: number;
  readonly end: number;
}

function tile(template: Template, curve: EnergyCurve, rate: FrameRate): Result<Span[]> {
  const indexOf = new Map<string, number>(template.slots.map((slot, index) => [slot.id, index]));
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
    const last = slots.at(-1);
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
  return Math.min(end, slotStart + framesOf(slot.duration, rate)) - Math.max(start, slotStart);
}

function mostOverlap(slots: readonly TemplateSlot[], start: number, end: number, rate: FrameRate) {
  let best: TemplateSlot | undefined;
  let bestOverlap = -1;
  for (const slot of slots) {
    const overlap = overlapOf(slot, start, end, rate);
    if (overlap > bestOverlap) {
      best = slot;
      bestOverlap = overlap;
    }
  }
  return best;
}

function fitTransition(transition: Transition | null, previous: number, duration: number, rate: FrameRate) {
  if (!transition || previous < 1) return null;
  if (framesOf(transition.before, rate) > previous || framesOf(transition.after, rate) > duration)
    return null;
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
      if (start !== undefined && end !== undefined && end > start) pieces.push({ start, end, span });
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
  const slotMap: { slotId: SlotId; from: SlotId[]; unchanged: boolean }[] = [];
  for (const piece of pieces) {
    const length = piece.end - piece.start;
    const kept = byStart.get(piece.start);
    const unchanged = kept !== undefined && framesOf(kept.duration, rate) === length;
    const from = piece.span.slots
      .filter((slot) => overlapOf(slot, piece.start, piece.end, rate) > 0)
      .map((slot) => slot.id);
    const source = mostOverlap(piece.span.slots, piece.start, piece.end, rate) ?? opening;
    if (!source) continue;
    const previous = slots.at(-1);
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
          transitionIn: fitTransition(
            kept?.transitionIn ?? null,
            previous ? framesOf(previous.duration, rate) : 0,
            length,
            rate,
          ),
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

/** The slot holding `frame` (the last one past the end). */
function holding(slots: readonly TemplateSlot[], frame: number, rate: FrameRate): SlotId | null {
  for (const slot of slots) {
    const start = framesOf(slot.start, rate);
    if (frame >= start && frame < start + framesOf(slot.duration, rate)) return slot.id;
  }
  return slots.at(-1)?.id ?? null;
}

/** PacingStats as templates' computePacing makes them. */
export function pacingOf(template: Template, slots: readonly TemplateSlot[]): PacingStats {
  const rate = template.canvas.rate;
  const lengths = slots.map((slot) => framesOf(slot.duration, rate));
  const sorted = [...lengths].sort((a, b) => a - b);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const middle = sorted.length >> 1;
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
  const hookCap = RationalTime.toFrames(RationalTime.fromSeconds(HOOK_CAP_SECONDS, rate), rate);
  const cuts = slots.slice(1).map((slot) => framesOf(slot.start, rate));
  const beats = beatFrames(template.beatMap, rate);
  const at = (frames: number) => RationalTime.of(frames, rate);
  return {
    shotCount: slots.length,
    meanShot: at(Math.round(total / Math.max(1, lengths.length))),
    medianShot: at(median),
    shortestShot: at(sorted[0] ?? 0),
    longestShot: at(sorted.at(-1) ?? 0),
    hookEnd: at(Math.min(lengths[0] ?? 0, hookCap)),
    cutsOnBeat:
      template.beatMap && cuts.length > 0
        ? cuts.filter((cut) => onBeat(beats, cut)).length / cuts.length
        : null,
  };
}

/** Re-splits `template` on `curve`; the input is not changed and its version fields stay as they are. */
export function splitOnCurve(template: Template, curve: EnergyCurve, ids: EnergyIds): Result<EnergySplit> {
  if (!template.beatMap || template.beatMap.beats.length === 0) return err(templatesError('no_beat_map'));
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
  const parsed = templateSchema.safeParse({
    ...template,
    slots: built.slots,
    text,
    pacing: pacingOf(template, built.slots),
    contactSheet,
  });
  if (!parsed.success) return invalid('invariant');
  return ok({ template: parsed.data, slotMap: built.slotMap });
}

/** Where each slot of `template` starts, then its end, in frames at its rate: the plan's `cuts`. */
export function cutsOf(template: Template): number[] {
  const rate = template.canvas.rate;
  return [...template.slots.map((slot) => framesOf(slot.start, rate)), framesOf(template.duration, rate)];
}
