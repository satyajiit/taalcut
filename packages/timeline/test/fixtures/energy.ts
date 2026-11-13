// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A reference for the template half of the energy curve (templates SPEC, P3-V12) until @taalcut/templates ships
 * applyEnergyCurve: each section keeps its span; inside, a cut every `beatsPerClip` whole beats from its first
 * beat, a last piece under one beat merging into the one before; a new slot keeps the id (and, when its length is
 * the same, everything) of the old slot that started on its frame; intents from the old slot it overlaps most,
 * with the section's energy; overlays move to the slot holding their start. Whole beats only (enough here).
 */
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  templateSchema,
  ValidationError,
  type EnergyCurve,
  type EnergySlotMap,
  type Result,
  type SlotId,
  type Template,
  type TemplateSlot,
} from '@taalcut/core';

type Section = EnergyCurve['sections'][number];
type Entry = EnergySlotMap[number];

const overlap = (a: TemplateSlot, start: number, end: number) =>
  Math.max(0, Math.min(a.start.value + a.duration.value, end) - Math.max(a.start.value, start));

/** A section's old slots and its new cut frames: every `beatsPerClip` beats, a last piece under a beat merged. */
function sectionCuts(
  template: Template,
  beats: readonly number[],
  section: Section,
): Result<{ olds: TemplateSlot[]; bounds: number[] }> {
  const from = template.slots.findIndex((slot) => slot.id === section.fromSlotId);
  const to = template.slots.findIndex((slot) => slot.id === section.toSlotId);
  if (from < 0 || to < from) return err(ValidationError({ field: 'curve' }));
  const olds = template.slots.slice(from, to + 1);
  const start = olds[0]?.start.value ?? 0;
  const last = olds.at(-1);
  const end = last ? last.start.value + last.duration.value : start;
  const first = beats.findIndex((beat) => beat >= start);
  const step = Math.max(1, Math.round(section.beatsPerClip));
  const bounds = [start];
  for (let index = first + step; index < beats.length && (beats[index] ?? end) < end; index += step)
    bounds.push(beats[index] as number);
  const beatFrames = (beats[1] ?? 0) - (beats[0] ?? 0);
  if (bounds.length > 1 && end - (bounds.at(-1) as number) < beatFrames) bounds.pop();
  bounds.push(end);
  return ok({ olds, bounds });
}

interface PieceContext {
  readonly rate: Template['canvas']['rate'];
  readonly beats: readonly number[];
  readonly section: Section;
  readonly ids: { slot(): SlotId };
}

/** The new slot for frames [a, b) of a section: the old one when it starts there with the same length. */
function pieceSlot(olds: readonly TemplateSlot[], a: number, b: number, context: PieceContext) {
  const at = (frames: number) => RationalTime.of(frames, context.rate);
  const same = olds.find((slot) => slot.start.value === a);
  const sources = olds.filter((slot) => overlap(slot, a, b) > 0);
  const main = [...sources].sort((x, y) => overlap(y, a, b) - overlap(x, a, b))[0] as TemplateSlot;
  const unchanged = !!same && same.duration.value === b - a;
  const beatIndex = context.beats.indexOf(a);
  const slot: TemplateSlot =
    unchanged && same
      ? same
      : {
          ...main,
          id: same?.id ?? context.ids.slot(),
          start: at(a),
          duration: at(b - a),
          intent: { ...main.intent, energy: context.section.energy },
          beatAnchor: beatIndex >= 0 ? { beatIndex, offset: at(0) } : null,
          transitionIn: same?.transitionIn ?? null,
          speedRamp: null,
          approved: false,
        };
  const entry: Entry = { slotId: slot.id, from: sources.map((source) => source.id), unchanged };
  return { slot, entry };
}

/** Overlays move to the slot holding their start; the pacing counts the new slots and the hook. */
function finished(template: Template, slots: readonly TemplateSlot[]): Template {
  const rate = template.canvas.rate;
  const holding = (frame: number) =>
    slots.find((slot) => frame >= slot.start.value && frame < slot.start.value + slot.duration.value);
  const text = template.text.map((overlay) =>
    overlay.slotId ? { ...overlay, slotId: holding(overlay.start.value)?.id ?? overlay.slotId } : overlay,
  );
  const hook = Math.min(slots[0]?.duration.value ?? 0, Math.round(FrameRate.toNumber(rate) * 3));
  const pacing = { ...template.pacing, shotCount: slots.length, hookEnd: RationalTime.of(hook, rate) };
  return templateSchema.parse({ ...template, slots, text, pacing });
}

export function referenceApplier(
  template: Template,
  curve: EnergyCurve,
  ids: { slot(): SlotId },
): Result<{ readonly template: Template; readonly slotMap: EnergySlotMap }> {
  const rate = template.canvas.rate;
  if (!template.beatMap) return err(ValidationError({ field: 'beatMap' }));
  const beats = template.beatMap.beats.map((beat) => RationalTime.rescale(beat, rate, 'round').value);
  const slots: TemplateSlot[] = [];
  const slotMap: EnergySlotMap = [];
  for (const section of curve.sections) {
    const cuts = sectionCuts(template, beats, section);
    if (!cuts.ok) return cuts;
    const { olds, bounds } = cuts.value;
    for (let piece = 0; piece + 1 < bounds.length; piece++) {
      const made = pieceSlot(olds, bounds[piece] as number, bounds[piece + 1] as number, {
        rate,
        beats,
        section,
        ids,
      });
      slots.push(made.slot);
      slotMap.push(made.entry);
    }
  }
  return ok({ template: finished(template, slots), slotMap });
}
