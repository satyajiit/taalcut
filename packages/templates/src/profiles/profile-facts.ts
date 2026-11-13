// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A style profile in plain English for models (LRN1-STY): the lines the vision model summarises and the guide the
 * agent's tool returns to the Editor. Built from the numbers alone, never from media text (the hook texts go to a
 * model separately, fenced), so these lines are trusted. Deterministic: the same profile gives the same lines. Not
 * for people: the card formats the same numbers with Intl and Lingui.
 */
import type { StyleBand, StyleProfile } from '@taalcut/core';
import { modeOf, type TallyRow } from './stats';

const secondsText = (value: number): string => `${Number(value.toFixed(2))} s`;
const percent = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;
const spread = (band: StyleBand): string =>
  band.n > 1 ? ` (middle half ${secondsText(band.q1)} to ${secondsText(band.q3)})` : '';

/** "cut 80%, whip 12%, dissolve 8%": the first `limit` rows of a tally with their shares. */
function shares<V extends string>(rows: readonly TallyRow<V>[], limit = 3): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows
    .slice(0, limit)
    .map((row) => `${row.value} ${percent(row.count, total)}`)
    .join(', ');
}

const mostly = <V extends string>(rows: readonly TallyRow<V>[]): string => modeOf(rows) ?? 'none';

function energyWords(energy: readonly number[] | null): string {
  if (!energy) return 'no waveform to read the energy from';
  const third = (from: number, to: number) =>
    energy.slice(from, to).reduce((sum, v) => sum + v, 0) / (to - from);
  const start = third(0, 3);
  const end = third(7, 10);
  const shape =
    end - start > 0.15
      ? 'builds towards the end'
      : start - end > 0.15
        ? 'starts loud and eases off'
        : 'stays even';
  return `the sound ${shape} (energy by tenth: ${energy.map((v) => v.toFixed(2)).join(' ')})`;
}

/** The profile's facts, one sentence per part. */
export function profileFacts(profile: StyleProfile): string[] {
  const { pacing, hook, mix, overlays, audio, form, members } = profile;
  const lines = [
    `Videos profiled: ${members}.`,
    `Length: median ${secondsText(form.length.median)}${spread(form.length)}; shape ${mostly(form.aspect)}.`,
    `Shots: median ${secondsText(pacing.shot.median)} long${spread(pacing.shot)}; a median of ` +
      `${pacing.shotsInFirst3s.median} shots start in the first 3 s.`,
    pacing.cutsOnBeat === null
      ? 'Cuts on the beat: no video has a beat map.'
      : `Cuts on the beat: ${Math.round(pacing.cutsOnBeat * 100)}% of cuts, over the ${pacing.withBeats} ` +
        `video(s) with a beat map.`,
    `Hook (the first shot): mostly ${mostly(hook.shotType)} shots, median ${secondsText(hook.duration.median)}; ` +
      `${hook.withText} of ${members} open with text` +
      (hook.withText > 0 ? `, mostly ${mostly(hook.role)} text revealed by ${mostly(hook.reveal)}.` : '.'),
    mix.transitions.length === 0
      ? 'Transitions: none (single-shot videos).'
      : `Transitions between shots: ${shares(mix.transitions)}; speed ramps on ` +
        `${percent(mix.speedRamps, mix.slots)} of shots` +
        (mix.speedRamps > 0 ? `, mostly ${mostly(mix.rampCurves)} curves.` : '.'),
    overlays.count === 0
      ? 'On-screen text: none.'
      : `On-screen text: ${overlays.count} overlays in ${overlays.withText} of ${members} videos; mostly at the ` +
        `${mostly(overlays.position)} of the frame, ${mostly(overlays.size)} size, ${mostly(overlays.case)} case, ` +
        `${mostly(overlays.background)} background, revealed by ${mostly(overlays.reveal)}` +
        (overlays.wordsPerLine ? `, a median of ${overlays.wordsPerLine.median} words per line.` : '.'),
    `Sound: mostly ${mostly(audio.kind)}` +
      (audio.loudnessLufs === null ? '' : `, median loudness ${audio.loudnessLufs} LUFS`) +
      `; ${energyWords(audio.energy)}.`,
  ];
  return lines;
}
