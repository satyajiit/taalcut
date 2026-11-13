// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pitches as kits write them (earshot forge/knobs.py `midi`, `hz`, `label`): a note name ('C5', 'Eb6', 'F#4', and
 * 'Fs4' with `s` for a sharp as in take file names), a number of Hz, or '440hz'; A4 = 440 Hz. `pitchLabel` is the one
 * canonical file-name label per pitch: the note when within 5 cents of one ('Db5' and 554.37 are 'Cs5'), else Hz.
 */

const PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** A note name as a MIDI number, or null when it is no note name. */
export function midiOf(pitch: string): number | null {
  const m = /^([A-Ga-g])([#sb]{0,2})(-?\d+)$/.exec(pitch.trim());
  if (!m) return null;
  const [, letter = 'C', acc = '', octave = '0'] = m;
  const count = (c: string) => acc.split('').filter((x) => x === c).length;
  return 12 * (Number(octave) + 1) + (PC[letter.toUpperCase()] ?? 0) + count('#') + count('s') - count('b');
}

/** Hz of a pitch, or null when it is none (or outside 8 Hz – 20 kHz). */
export function pitchHz(pitch: string | number): number | null {
  let f: number;
  if (typeof pitch === 'number') f = pitch;
  else {
    const n = midiOf(pitch);
    if (n !== null) f = 440 * 2 ** ((n - 69) / 12);
    else {
      const m = /^(\d+(?:\.\d+)?)\s*(?:hz)?$/i.exec(pitch.trim());
      if (!m) return null;
      f = Number(m[1]);
    }
  }
  return Number.isFinite(f) && f >= 8 && f <= 20_000 ? f : null;
}

/** Python's `round(f, 2):g` for the Hz label: no trailing zeros. */
const hzLabel = (f: number) => `${Number((Math.round(f * 100) / 100).toPrecision(6))}hz`;

/** The canonical take label of a pitch, or null when it is none. */
export function pitchLabel(pitch: string | number): string | null {
  const f = pitchHz(pitch);
  if (f === null) return null;
  const n = 69 + 12 * Math.log2(f / 440);
  const k = Math.round(n);
  if (Math.abs(n - k) < 0.05)
    return `${NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`.replace('#', 's');
  return hzLabel(f);
}

/** Semitones from `fromHz` to `toHz`. */
export const semitones = (fromHz: number, toHz: number): number => 12 * Math.log2(toHz / fromHz);
