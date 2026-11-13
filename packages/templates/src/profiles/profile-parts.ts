// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each part of a style profile (LRN1-STY) from its members' typed structure: pacing, the hook, the mix, the overlay
 * style, the audio and the form. Pure: the same templates give the same parts in any order. See packages/templates
 * SPEC.md, "LRN1-STY", for what each number means.
 */
import {
  RationalTime,
  STYLE_ENERGY_POINTS,
  type StyleBand,
  type StyleProfile,
  type Template,
  type TextOverlay,
} from '@taalcut/core';
import { PROFILE_CONFIG } from './profile-config';
import { bandOf, medianOf, round, roundShare, tally } from './stats';

type Part<K extends keyof StyleProfile> = StyleProfile[K];

const seconds = (time: RationalTime): number => RationalTime.toSeconds(time);
const counts = (value: number): number => round(value, 3);

/** A band that can't be empty: every member has at least one slot. */
function band(values: readonly number[], rounding?: (value: number) => number): StyleBand {
  const found = bandOf(values, rounding);
  if (!found) throw new RangeError('a profile needs at least one member');
  return found;
}

/** The first slot in time (slots are stored in order; a template has at least one). */
export function firstSlot(template: Template): Template['slots'][number] {
  const [first] = template.slots;
  if (!first) throw new RangeError(`template ${template.id} has no slot`);
  return first;
}

/** The first text that starts inside slot 0's window (by start, then id), if any. */
export function hookText(template: Template): TextOverlay | null {
  const slot = firstSlot(template);
  const from = seconds(slot.start);
  const to = from + seconds(slot.duration);
  const inside = template.text
    .filter((overlay) => {
      const start = seconds(overlay.start);
      return start >= from && start < to;
    })
    .sort((a, b) => seconds(a.start) - seconds(b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return inside[0] ?? null;
}

/** An example text as kept on the profile: one line, at most `exampleChars`, cut at a word boundary. */
export function exampleText(text: string): string | null {
  const line = text.replace(/\s+/gu, ' ').trim();
  if (!line) return null;
  if (line.length <= PROFILE_CONFIG.exampleChars) return line;
  const cut = line.slice(0, PROFILE_CONFIG.exampleChars + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, PROFILE_CONFIG.exampleChars)).trim();
}

export function pacingPart(members: readonly Template[]): Part<'pacing'> {
  const shots = members.flatMap((template) => template.slots.map((slot) => seconds(slot.duration)));
  let onBeat = 0;
  let cuts = 0;
  for (const template of members) {
    if (!template.beatMap || template.pacing.cutsOnBeat === null) continue;
    const templateCuts = template.slots.length - 1;
    onBeat += template.pacing.cutsOnBeat * templateCuts;
    cuts += templateCuts;
  }
  const opening = members.map(
    (template) => template.slots.filter((slot) => seconds(slot.start) < PROFILE_CONFIG.openingSeconds).length,
  );
  return {
    shot: band(shots),
    cutsOnBeat: cuts > 0 ? roundShare(onBeat / cuts) : null,
    withBeats: members.filter((template) => template.beatMap !== null).length,
    shotsInFirst3s: band(opening, counts),
  };
}

export function hookPart(members: readonly Template[], exemplars: readonly Template[]): Part<'hook'> {
  const texts = members.flatMap((template) => {
    const text = hookText(template);
    return text ? [text] : [];
  });
  return {
    shotType: tally(members.map((template) => firstSlot(template).intent.shotType ?? 'unknown')),
    duration: band(members.map((template) => seconds(firstSlot(template).duration))),
    withText: texts.length,
    reveal: tally(texts.map((text) => text.reveal)),
    role: tally(texts.map((text) => text.role)),
    textExamples: exemplars.flatMap((template) => {
      const text = hookText(template);
      const example = text ? exampleText(text.text) : null;
      return example ? [example] : [];
    }),
  };
}

export function mixPart(members: readonly Template[]): Part<'mix'> {
  const slots = members.flatMap((template) => template.slots);
  const ramps = slots.flatMap((slot) => (slot.speedRamp ? [slot.speedRamp] : []));
  return {
    transitions: tally(
      members.flatMap((template) => template.slots.slice(1).map((slot) => slot.transitionIn?.kind ?? 'cut')),
    ),
    slots: slots.length,
    speedRamps: ramps.length,
    rampCurves: tally(ramps.map((ramp) => ramp.curve)),
  };
}

const positionOf = (overlay: TextOverlay) => {
  const centre = overlay.box.y + overlay.box.height / 2;
  return centre < 1 / 3 ? 'top' : centre < 2 / 3 ? 'middle' : 'bottom';
};

const sizeOf = (overlay: TextOverlay) => {
  const { size } = overlay.appearance;
  return size < PROFILE_CONFIG.textSize.small
    ? 'small'
    : size < PROFILE_CONFIG.textSize.medium
      ? 'medium'
      : 'large';
};

/** Words in each non-empty line of a text. */
export function wordsPerLine(text: string): number[] {
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/u).filter(Boolean).length)
    .filter((words) => words > 0);
}

export function overlaysPart(members: readonly Template[]): Part<'overlays'> {
  const overlays = members.flatMap((template) => template.text);
  return {
    count: overlays.length,
    withText: members.filter((template) => template.text.length > 0).length,
    position: tally(overlays.map(positionOf)),
    size: tally(overlays.map(sizeOf)),
    reveal: tally(overlays.map((overlay) => overlay.reveal)),
    case: tally(overlays.map((overlay) => overlay.appearance.case)),
    background: tally(overlays.map((overlay) => overlay.appearance.background)),
    wordsPerLine: bandOf(
      overlays.flatMap((overlay) => wordsPerLine(overlay.text)),
      counts,
    ),
  };
}

/**
 * A waveform flattened by the clamp of templates broken down before REF1's fix (gate finding 7): the tracker's raw
 * onset strength clamped to 1, so most peaks are exactly 1 and no shape is left (663 of 666 in the gate's reel). A
 * waveform scaled to its loudest frame has 1 once, or a few times; a reel's own peaks are never mostly exactly 1.
 */
export function flattenedWaveform(peaks: readonly number[]): boolean {
  let ones = 0;
  for (const peak of peaks) if (peak >= 1) ones += 1;
  return peaks.length > 0 && ones * 2 > peaks.length;
}

/**
 * A waveform's shape: the mean peak in each of STYLE_ENERGY_POINTS equal parts, scaled to the loudest part. Null
 * for fewer peaks than parts, silence, or a waveform flattened before REF1 (it says nothing of the energy, and
 * read as all ones it would pull every profile's energy flat).
 */
export function energyShape(peaks: readonly number[]): number[] | null {
  if (peaks.length < STYLE_ENERGY_POINTS || flattenedWaveform(peaks)) return null;
  const parts = Array.from({ length: STYLE_ENERGY_POINTS }, (_, index) => {
    const from = Math.floor((index * peaks.length) / STYLE_ENERGY_POINTS);
    const to = Math.floor(((index + 1) * peaks.length) / STYLE_ENERGY_POINTS);
    const slice = peaks.slice(from, to);
    return slice.reduce((sum, peak) => sum + peak, 0) / slice.length;
  });
  const loudest = Math.max(...parts);
  return loudest > 0 ? parts.map((part) => part / loudest) : null;
}

export function audioPart(members: readonly Template[]): Part<'audio'> {
  const loudness = medianOf(
    members.flatMap((template) =>
      template.audio.loudnessLufs === null ? [] : [template.audio.loudnessLufs],
    ),
  );
  const shapes = members.flatMap((template) => {
    const shape = template.audio.waveform ? energyShape(template.audio.waveform.peaks) : null;
    return shape ? [shape] : [];
  });
  return {
    kind: tally(members.map((template) => template.audio.kind)),
    loudnessLufs: loudness === null ? null : round(loudness, 1),
    energy:
      shapes.length === 0
        ? null
        : Array.from({ length: STYLE_ENERGY_POINTS }, (_, index) =>
            roundShare(medianOf(shapes.map((shape) => shape[index] ?? 0)) ?? 0),
          ),
  };
}

const ASPECTS = [
  ['9:16', 9 / 16],
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
] as const;

export function aspectOf(width: number, height: number): Part<'form'>['aspect'][number]['value'] {
  const ratio = width / height;
  const near = ASPECTS.find(
    ([, target]) => Math.abs(ratio - target) / target <= PROFILE_CONFIG.aspectTolerance,
  );
  return near ? near[0] : 'other';
}

export function formPart(members: readonly Template[]): Part<'form'> {
  return {
    length: band(members.map((template) => seconds(template.duration))),
    aspect: tally(members.map((template) => aspectOf(template.canvas.width, template.canvas.height))),
  };
}
