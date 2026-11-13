// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Make a short, on one long video: the owner's clips from the camera roll (#content/reels: the flight out, then
 * Vietnam's nights and its bays and rivers) laid end to end as the scenes of one long trip video, with the creator's own
 * narration over them, plain and short. The app's rule (packages/shorts/SPEC.md, apps/renderer/src/features/shorts): whole transcript sentences and
 * scenes, a hook, the context and the payoff, never longer than the target and never padded to reach it, so the cut
 * may run shorter. test/unit/showcase-shorts.test.ts holds these numbers and words.
 */

export type Role = 'hook' | 'context' | 'payoff';

export interface Scene {
  /** The camera roll's clip, which places its frames in the atlas. */
  readonly clipId: string;
  /** Where it starts in the long video, in seconds. */
  readonly at: number;
  readonly seconds: number;
}

export interface Line {
  readonly id: string;
  /** What the creator says over these scenes. */
  readonly text: string;
  /** The scenes it is said over, by index: always next to each other. */
  readonly scenes: readonly number[];
  /** How long it runs in a short, in seconds: the sentence and its scenes, cut whole. */
  readonly seconds: number;
  /** The order the AI wants context in (1 first); the hook and the payoff always go in. */
  readonly rank: number;
  readonly role?: 'hook' | 'payoff';
}

/** The long video's name, as the library shows it. */
export const LONG_VIDEO = 'Trip, start to finish';

const ORDER = [
  ['airport-01', 52],
  ['airport-02', 31],
  ['airport-03', 28],
  ['airport-04', 35],
  ['airport-05', 44],
  ['airport-06', 26],
  ['airport-07', 48],
  ['airport-08', 39],
  ['airport-09', 57],
  ['vietnam-01', 41],
  ['vietnam-02', 38],
  ['repeat-13', 29],
  ['vietnam-10', 33],
  ['repeat-02', 40],
  ['repeat-05', 45],
  ['vietnam-07', 36],
  ['vietnam-08', 42],
  ['repeat-11', 27],
  ['repeat-07', 31],
  ['repeat-14', 39],
  ['repeat-09', 34],
  ['vietnam-13', 53],
] as const;

/** The long video's scenes, in order. */
export const SCENES: readonly Scene[] = ORDER.reduce<Scene[]>((list, [clipId, seconds]) => {
  const last = list[list.length - 1];
  return [...list, { clipId, at: last ? last.at + last.seconds : 0, seconds }];
}, []);

/** How long the long video runs, in seconds (14:08). */
export const LONG_SECONDS = SCENES.reduce((sum, s) => sum + s.seconds, 0);

/** What the creator says, scene by scene. */
export const LINES: readonly Line[] = [
  { id: 'l1', text: 'Six in the morning, and we’re already at the airport.', scenes: [0, 1], seconds: 7, rank: 0, role: 'hook' },
  { id: 'l2', text: 'Gate signs, trolleys and a very long walk.', scenes: [2, 3], seconds: 6, rank: 6 },
  { id: 'l3', text: 'Our plane was waiting right outside.', scenes: [4, 5], seconds: 6, rank: 3 },
  { id: 'l4', text: 'I got the window seat this time.', scenes: [6], seconds: 5, rank: 1 },
  { id: 'l5', text: 'Then the city fell away under the wing.', scenes: [7, 8], seconds: 8, rank: 2 },
  { id: 'l6', text: 'We landed, grabbed our bags and walked straight out.', scenes: [9], seconds: 8, rank: 7 },
  { id: 'l7', text: 'The first night was all red lanterns.', scenes: [10], seconds: 6, rank: 4 },
  { id: 'l8', text: 'At night, a train ran right down the street.', scenes: [11, 12], seconds: 6, rank: 8 },
  { id: 'l9', text: 'Then a boat out into Hạ Long Bay, cliffs all around.', scenes: [13, 14], seconds: 8, rank: 9 },
  { id: 'l10', text: 'When it rained, the whole city lit up.', scenes: [15, 16], seconds: 7, rank: 5 },
  { id: 'l11', text: 'Then Ninh Bình: green water, karst hills and an old stone gate.', scenes: [17, 18, 19, 20], seconds: 7, rank: 10 },
  { id: 'l12', text: 'Lanterns at dusk. I’d go back tomorrow.', scenes: [21], seconds: 8, rank: 0, role: 'payoff' },
];

/** The dialog's lengths (the app's Segmented: 30, 60 and 90 seconds, then Custom). */
export const LENGTHS = [30, 60, 90] as const;
export const DEFAULT_LENGTH = 60;
export const MIN_LENGTH = 15;
export const MAX_LENGTH = 179;

/** "30 sec": a length as the app's choice says it (Intl's short unit). */
export function lengthWords(seconds: number): string {
  return new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(seconds);
}

/** A custom length, as the app reads it: a whole number of seconds from 15 to 179, or null. */
export function customLength(value: string): number | null {
  const seconds = Number(value);
  return value.trim() !== '' && Number.isInteger(seconds) && seconds >= MIN_LENGTH && seconds <= MAX_LENGTH ? seconds : null;
}

export interface Pick {
  readonly line: Line;
  readonly role: Role;
}

/**
 * The short for a target: the hook and the payoff, then context in the AI's order while the whole still fits, each
 * line whole. In the long video's order, so the story runs as it was told; never longer than the target.
 */
export function pickShort(target: number): Pick[] {
  const hook = LINES.filter((l) => l.role === 'hook');
  const payoff = LINES.filter((l) => l.role === 'payoff');
  let total = [...hook, ...payoff].reduce((sum, l) => sum + l.seconds, 0);
  const chosen = new Set([...hook, ...payoff].map((l) => l.id));
  for (const line of [...LINES].filter((l) => !l.role).sort((a, b) => a.rank - b.rank)) {
    if (total + line.seconds > target) continue;
    total += line.seconds;
    chosen.add(line.id);
  }
  return LINES.filter((l) => chosen.has(l.id)).map((line) => ({ line, role: line.role ?? 'context' }));
}

/** How long a short runs, in seconds. */
export function shortSeconds(picks: readonly Pick[]): number {
  return picks.reduce((sum, p) => sum + p.line.seconds, 0);
}

/** Where a line sits in the long video: its first scene's start to its last scene's end, in seconds. */
export function lineSpan(line: Line): readonly [number, number] {
  const first = SCENES[line.scenes[0] ?? 0];
  const last = SCENES[line.scenes[line.scenes.length - 1] ?? 0];
  return [first?.at ?? 0, (last?.at ?? 0) + (last?.seconds ?? 0)];
}

/** "14:08", "0:59". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What plays `t` seconds into a short: the pick, the clip on screen and how far into it, and the word being said. */
export function playAt(picks: readonly Pick[], t: number) {
  let start = 0;
  for (const [index, pick] of picks.entries()) {
    const end = start + pick.line.seconds;
    if (t < end || index === picks.length - 1) {
      const local = Math.min(Math.max(0, t - start), pick.line.seconds);
      const scenes = pick.line.scenes;
      const each = pick.line.seconds / scenes.length;
      const k = Math.min(scenes.length - 1, Math.floor(local / each));
      const words = pick.line.text.split(' ');
      // The words are said from 0.2 s in to 0.6 s before the end, evenly.
      const talk = Math.max(0.1, pick.line.seconds - 0.8);
      const word = Math.min(words.length - 1, Math.max(0, Math.floor(((local - 0.2) / talk) * words.length)));
      return { index, start, pick, clipId: SCENES[scenes[k] ?? 0]?.clipId ?? '', inClip: local - k * each, words, word };
    }
    start = end;
  }
  return null;
}

/** When each part of making a short happens, in ms after Create short (the run the page plays once, then rests). */
export function runTimes(count: number) {
  const marks = Array.from({ length: count }, (_, i) => 250 + Math.round((i * 1100) / Math.max(1, count)));
  const gathers = Array.from({ length: count }, (_, i) => 1500 + Math.round((i * 650) / Math.max(1, count)));
  return { marks, gathers, checking: 2300, passed: 3000, end: 3100 };
}
