// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { DEFAULT_REEL_ID, reelById } from '#content/reels';

/**
 * The editor page's SAMPLE cut: the sample reel's music beats (#content/reels), seven clips the AI picked from the
 * owner's Vietnam footage, nights and day views both (the camera roll's clips, with their frames), cut on the beats, two caption lines word by
 * word, and one title the AI designed. The title and the captions are made up for the demo, and the page says so.
 * Clip edges are held as beat numbers, so a trim always lands on a beat: a trim moves the edge between a clip and
 * the next one (the next one gives up what this one takes), and the cut keeps the music's length.
 */

export interface EditorClip {
  readonly id: string;
  /** What it shows, in two words. */
  readonly word: string;
  /** The camera roll's clip whose frames it shows. */
  readonly clipId: string;
}

export interface CaptionWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export const CLIPS: readonly EditorClip[] = [
  { id: 'c1', word: 'Airport walkway', clipId: 'vietnam-01' },
  { id: 'c2', word: 'Hạ Long Bay', clipId: 'repeat-02' },
  { id: 'c3', word: 'Temple flags', clipId: 'vietnam-03' },
  { id: 'c4', word: 'Paper lanterns', clipId: 'repeat-06' },
  { id: 'c5', word: 'Jungle path', clipId: 'vietnam-06' },
  { id: 'c6', word: 'Train street', clipId: 'repeat-13' },
  { id: 'c7', word: 'Sunset pool', clipId: 'repeat-15' },
];

/** Where each clip starts, as a beat number; the last edge is the end of the music. */
export const FIRST_EDGES: readonly number[] = [0, 4, 7, 10, 14, 17, 20];

export interface Cut {
  readonly beats: readonly number[];
  readonly duration: number;
  /** Clip starts in beats, plus the end (beats.length stands for the end of the music). */
  readonly edges: readonly number[];
}

export function sampleCut(): Cut {
  const reel = reelById(DEFAULT_REEL_ID);
  const usable = FIRST_EDGES.filter((b) => b < reel.beats.length);
  return { beats: reel.beats, duration: reel.durationSec, edges: [...usable, reel.beats.length] };
}

/** An edge's time in seconds. */
export function edgeTime(cut: Cut, edge: number): number {
  if (edge <= 0) return 0;
  return edge >= cut.beats.length ? cut.duration : (cut.beats[edge] ?? cut.duration);
}

/** Clip `index`'s start and end in seconds. */
export function clipSpan(cut: Cut, index: number): readonly [number, number] {
  return [edgeTime(cut, cut.edges[index] ?? 0), edgeTime(cut, cut.edges[index + 1] ?? cut.beats.length)];
}

/** Whether clip `index` can get `by` beats longer (or shorter, when negative): each clip keeps at least one beat. */
export function canTrim(cut: Cut, index: number, by: number): boolean {
  const end = cut.edges[index + 1];
  const start = cut.edges[index];
  const next = cut.edges[index + 2];
  if (end === undefined || start === undefined || next === undefined) return false;
  const moved = end + by;
  return moved - start >= 1 && next - moved >= 1;
}

/** Clip `index` made `by` beats longer (or shorter): its end moves, and the next clip starts there. */
export function trimClip(cut: Cut, index: number, by: number): Cut {
  if (!canTrim(cut, index, by)) return cut;
  return { ...cut, edges: cut.edges.map((edge, i) => (i === index + 1 ? edge + by : edge)) };
}

/** Clip `index`'s length in beats. */
export function clipBeats(cut: Cut, index: number): number {
  return (cut.edges[index + 1] ?? 0) - (cut.edges[index] ?? 0);
}

/** The clip playing at a time. */
export function clipAt(cut: Cut, seconds: number): number {
  for (let i = cut.edges.length - 2; i >= 0; i -= 1) if (seconds >= edgeTime(cut, cut.edges[i] ?? 0)) return i;
  return 0;
}

/** Two caption lines, word by word (made up for the demo), each word until the next one starts. */
export const CAPTIONS: readonly (readonly CaptionWord[])[] = [
  words('We walked the whole way', 2.4, [0.5, 0.55, 0.4, 0.4, 1.1]),
  words('and never looked back.', 7.2, [0.45, 0.65, 0.4, 0.4, 1.2]),
];

function words(line: string, start: number, lengths: readonly number[]): CaptionWord[] {
  let at = start;
  return line.split(' ').map((text, i) => {
    const word = { text, start: at, end: at + (lengths[i] ?? 0.3) };
    at = word.end;
    return word;
  });
}

/** The line on screen at a time, and the word being said, if any. */
export function captionAt(seconds: number): { readonly line: readonly CaptionWord[]; readonly word: number } | null {
  for (const line of CAPTIONS) {
    const first = line[0];
    const last = line[line.length - 1];
    if (first && last && seconds >= first.start - 0.2 && seconds < last.end + 0.3)
      return { line, word: line.findIndex((w) => seconds >= w.start && seconds < w.end) };
  }
  return null;
}

/** The title the AI designed (its words made up for the demo), and the values it set, which you can change. */
export const TITLE = { text: 'Six days in Vietnam', size: 1, place: 'top' as Place };
export type Place = 'top' | 'middle' | 'bottom';
export const SIZE_RANGE = { min: 0.8, max: 1.3, step: 0.05 } as const;
