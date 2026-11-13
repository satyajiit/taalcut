// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The energy curve as the Pacing tab edits it (P3-V12). A template's own curve (templates' energyCurveOf: runs of
 * the same role, their median length in beats, their mean energy), energy → beats per cut (config
 * energy.v1.json), and the edits a band takes: a new energy (which sets the pacing, as a drag does), beats per
 * cut typed from the menu, Faster and Slower (a drag's equal: one pacing step), split at a slot boundary and
 * merge with the next. Pure; every edit returns a new curve.
 */
import {
  BEATS_PER_CLIP,
  RationalTime,
  type EnergyCurve,
  type EnergySection,
  type Template,
} from '@taalcut/core';
import { beatFrames, beatIndexAt, beatInterval } from './energy-grid';

export type BeatsPerClip = EnergySection['beatsPerClip'];

/** config/energy.v1.json: the highest `minEnergy` at or under the energy sets the pacing. */
const LEVELS: readonly { readonly minEnergy: number; readonly beatsPerClip: BeatsPerClip }[] = [
  { minEnergy: 0.85, beatsPerClip: 1 },
  { minEnergy: 0.65, beatsPerClip: 2 },
  { minEnergy: 0.4, beatsPerClip: 4 },
  { minEnergy: 0.2, beatsPerClip: 8 },
  { minEnergy: 0, beatsPerClip: 16 },
];

export const BEAT_CHOICES: readonly BeatsPerClip[] = BEATS_PER_CLIP;

/** The beats per cut a drag sets. */
export function beatsForEnergy(energy: number): BeatsPerClip {
  return LEVELS.find((level) => energy >= level.minEnergy)?.beatsPerClip ?? 16;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Whole percent steps, so arrows land on 5 %, 10 %… and two curves compare equal. */
const round = (value: number) => Math.round(clamp01(value) * 100) / 100;

function roundBeats(value: number): BeatsPerClip {
  let best: BeatsPerClip = BEATS_PER_CLIP[0];
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
  return sorted.length % 2 === 1 ? here : ((sorted[mid - 1] ?? 0) + here) / 2;
}

/** The template's own curve: one section per run of slots with the same role. */
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
    const last = run.at(-1) ?? first;
    const lengths = run.map((slot) => {
      const start = RationalTime.toFrames(slot.start, rate);
      return RationalTime.toFrames(slot.duration, rate) / beatInterval(beats, beatIndexAt(beats, start));
    });
    sections.push({
      fromSlotId: first.id,
      toSlotId: last.id,
      energy: clamp01(run.reduce((sum, slot) => sum + slot.intent.energy, 0) / run.length),
      beatsPerClip: roundBeats(median(lengths)),
      align: 'beat',
    });
    index = end + 1;
  }
  return { sections };
}

const replace = (curve: EnergyCurve, index: number, section: EnergySection): EnergyCurve => ({
  sections: curve.sections.map((each, at) => (at === index ? section : each)),
});

/** A new energy for one band: the pacing follows it, as a drag sets it. */
export function withEnergy(curve: EnergyCurve, index: number, energy: number): EnergyCurve {
  const section = curve.sections[index];
  if (!section) return curve;
  const next = round(energy);
  return replace(curve, index, { ...section, energy: next, beatsPerClip: beatsForEnergy(next) });
}

/** Beats per cut picked from the band's menu: the energy stays. */
export function withBeats(curve: EnergyCurve, index: number, beatsPerClip: BeatsPerClip): EnergyCurve {
  const section = curve.sections[index];
  return section ? replace(curve, index, { ...section, beatsPerClip }) : curve;
}

/** Faster: up to the next pacing step's energy (1 at the top); null when it can't go faster. */
export function fasterEnergy(energy: number): number | null {
  if (energy >= 1) return null;
  const above = [...LEVELS].reverse().find((level) => level.minEnergy > energy + 1e-9);
  return above ? above.minEnergy : 1;
}

/** Slower: down to the start of the pacing step below this one (0 at the bottom); null at 0. */
export function slowerEnergy(energy: number): number | null {
  if (energy <= 0) return null;
  const current = LEVELS.find((level) => energy >= level.minEnergy - 1e-9)?.minEnergy ?? 0;
  return LEVELS.find((level) => level.minEnergy < current - 1e-9)?.minEnergy ?? 0;
}

/** The slot indices each section covers, in the template's order. */
export function sectionSlots(template: Template, curve: EnergyCurve): { from: number; to: number }[] {
  const indexOf = new Map<string, number>(template.slots.map((slot, index) => [slot.id, index]));
  return curve.sections.map((section) => ({
    from: indexOf.get(section.fromSlotId) ?? -1,
    to: indexOf.get(section.toSlotId) ?? -1,
  }));
}

/** Splits band `index` after slot `after` (an index into the template's slots inside the band); null if it can't. */
export function splitAt(
  template: Template,
  curve: EnergyCurve,
  index: number,
  after: number,
): EnergyCurve | null {
  const section = curve.sections[index];
  const span = sectionSlots(template, curve)[index];
  const end = template.slots[after];
  const next = template.slots[after + 1];
  if (!section || !span || !end || !next || after < span.from || after >= span.to) return null;
  return {
    sections: [
      ...curve.sections.slice(0, index),
      { ...section, toSlotId: end.id },
      { ...section, fromSlotId: next.id },
      ...curve.sections.slice(index + 1),
    ],
  };
}

/** Where S splits band `index`: the slot boundary nearest its middle; null for a one-slot band. */
export function middleSplit(template: Template, curve: EnergyCurve, index: number): number | null {
  const span = sectionSlots(template, curve)[index];
  if (!span || span.to <= span.from) return null;
  return Math.floor((span.from + span.to - 1) / 2);
}

/** Merges band `index` with the next one: the energy is their mean and sets the pacing. */
export function mergeNext(curve: EnergyCurve, index: number): EnergyCurve | null {
  const section = curve.sections[index];
  const next = curve.sections[index + 1];
  if (!section || !next) return null;
  const energy = round((section.energy + next.energy) / 2);
  return {
    sections: [
      ...curve.sections.slice(0, index),
      { ...section, toSlotId: next.toSlotId, energy, beatsPerClip: beatsForEnergy(energy) },
      ...curve.sections.slice(index + 2),
    ],
  };
}

export const sameCurve = (a: EnergyCurve, b: EnergyCurve) => JSON.stringify(a) === JSON.stringify(b);
