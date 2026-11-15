// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sequence's place read again (LYR1): the pure part. The whole-frame pass reads four times a second and reads a
 * word together with the print behind it, so of nine words that replaced each other in place it kept four. Once
 * readings chain (text-sequence.ts), their place is cut out and read on every frame, at more than one enlargement
 * (text-zone-read.ts runs it). From those pages:
 *
 * - **when** the words change comes from the picture first: the place's picture jumps where one word replaces
 *   another, read or not. The jumps and the cuts tile the time into stretches, and a stretch whose frames read one
 *   word and then an unrelated one is two (a busy picture can hide a jump);
 * - **what** each stretch says is the reading most of its frames agree on, each vote weighed by how sure the engine
 *   was and how much of the place its box covers (a reading of half a word covers less). Only a line on the words'
 *   own line, in their size, at their anchor and clear of the cut-out's sides is a vote: the rest is the scene;
 * - a cut changes the picture behind the words, not the words: across a cut, alike readings are one word;
 * - a stretch too short to be shown on its own is no piece: unread, it joins the stretch after it (the words
 *   entering, or not yet readable); read, it names the unread stretch beside it (words readable only for a moment,
 *   as when a cut changes the picture behind them near their end);
 * - a stretch inside the sequence that no frame read is kept as unread: a model reads it from the sequence's sheet
 *   (sequence-sheet.ts), and until then it is an overlay without words that the review asks about.
 *
 * text-zone-place.ts says where the words show and which line of a page is the word; text-zone-run.ts picks the
 * sequence's own pieces out of these.
 */
import type { Box } from '@taalcut/core';
import type { OcrLine, OcrQuad, OcrRegionPage } from './ports';
import { boxDrift, normaliseText, textSimilarity } from './text-track';
import { median, wordOn, type WordTest, type ZonePlace } from './text-zone-place';

/** What an unread piece carries as its words until a person or a model reads it. */
export const UNREAD_TEXT = '…';

export const TEXT_ZONE = {
  /** The place's picture changed at least this much (0–1) where a word is replaced. */
  changeFloor: 0.02,
  /** Frames either side a change is compared with. */
  neighbours: 4,
  /** Readings this alike, or sharing a run of letters half the shorter one long, are one word read twice. */
  alike: 0.4,
  /** The tracker's "same line". */
  same: 0.85,
  /** A stretch is read when this share of its frames agree, and two frames at least. */
  readShare: 0.2,
} as const;

/** One frame of the place: how much its picture changed from the frame before, and what each enlargement read. */
export interface ZoneFrame {
  readonly frame: number;
  readonly change: number;
  readonly readings: readonly (readonly OcrLine[])[];
}

/** The reads of one place (one list of pages per enlargement) as frames in order. */
export function zoneFrames(reads: readonly (readonly OcrRegionPage[])[]): ZoneFrame[] {
  const frames = new Map<number, { change: number; readings: (readonly OcrLine[])[] }>();
  for (const pages of reads)
    for (const page of pages) {
      const at = frames.get(page.frame) ?? { change: page.change, readings: [] };
      at.readings.push(page.lines);
      frames.set(page.frame, at);
    }
  return [...frames.entries()].sort(([a], [b]) => a - b).map(([frame, at]) => ({ frame, ...at }));
}

/** One stretch of the sequence's time: its words (null when too few frames read any) and where they showed. */
export interface ZonePiece {
  readonly text: string | null;
  /** Frames [start, end). */
  readonly start: number;
  readonly end: number;
  readonly box: Box;
  /** The engine's confidence over the readings that agreed; 0 when unread. */
  readonly confidence: number;
  /** Frames that read it. */
  readonly samples: number;
  readonly drift: number;
  readonly language: string | null;
  readonly quad?: OcrQuad;
  /** Every spelling of its words that was read (they differ in case), the heaviest first. */
  readonly spellings: readonly string[];
}

export interface ZoneOptions extends WordTest {
  /** The frames shots start at. */
  readonly cuts: readonly number[];
  readonly changeRatio: number;
  /** An unread stretch this short or shorter is no piece of its own (the rule's gap). */
  readonly tinyFrames: number;
}

/** Whether the place's picture jumps at `at`: well over what it does in the frames round it. */
function jumps(frames: readonly ZoneFrame[], at: number, ratio: number): boolean {
  const { change } = frames[at]!;
  if (change < TEXT_ZONE.changeFloor) return false;
  const around = frames
    .slice(Math.max(0, at - TEXT_ZONE.neighbours), at + TEXT_ZONE.neighbours + 1)
    .filter((frame) => frame !== frames[at])
    .map((frame) => frame.change);
  return around.length === 0 || change >= ratio * median(around);
}

/** The longest run of letters two readings share, as a share of the shorter one. */
function sharedRun(a: string, b: string): number {
  const x = [...normaliseText(a).replace(/ /g, '')];
  const y = [...normaliseText(b).replace(/ /g, '')];
  if (x.length === 0 || y.length === 0) return 0;
  let longest = 0;
  let previous = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++)
      if (x[i - 1] === y[j - 1]) longest = Math.max(longest, (row[j] = previous[j - 1]! + 1));
    previous = row;
  }
  return longest >= 2 ? longest / Math.min(x.length, y.length) : 0;
}

/** One word read twice, as a busier picture behind it makes the engine do. */
const alike = (a: string, b: string) => textSimilarity(a, b) >= TEXT_ZONE.alike || sharedRun(a, b) >= 0.5;

interface Stretch {
  start: number;
  end: number;
  /** Each reading of the place's word, with the frame it was read on. */
  words: { readonly frame: number; readonly line: OcrLine }[];
  /** The frames its reading is judged over (the ones it covers, unless it took its words from a moment of them). */
  frames: number;
  /** It starts at a cut. */
  atCut: boolean;
}

const weightOf = (line: OcrLine) => line.confidence * line.box.width * line.box.height;

/** The reading most of a stretch's frames agree on, its lines and its spellings; null when too few frames read it. */
function agreed(
  stretch: Stretch,
): { text: string; lines: OcrLine[]; frames: number; spellings: string[] } | null {
  const votes = new Map<string, { weight: number; lines: OcrLine[]; frames: Set<number> }>();
  for (const { frame, line } of stretch.words) {
    const key = normaliseText(line.text);
    const vote = votes.get(key) ?? { weight: 0, lines: [], frames: new Set<number>() };
    vote.weight += weightOf(line);
    vote.lines.push(line);
    vote.frames.add(frame);
    votes.set(key, vote);
  }
  const won = [...votes.values()].sort((a, b) => b.weight - a.weight)[0];
  const needed = Math.min(stretch.frames, Math.max(2, Math.ceil(stretch.frames * TEXT_ZONE.readShare)));
  // Two readings at least: two frames, or one frame at two enlargements.
  if (!won || won.frames.size < needed || won.lines.length < 2) return null;
  const spelt = new Map<string, number>();
  for (const line of won.lines) {
    const text = line.text.trim();
    spelt.set(text, (spelt.get(text) ?? 0) + weightOf(line));
  }
  const spellings = [...spelt.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text);
  return { text: spellings[0]!, lines: won.lines, frames: won.frames.size, spellings };
}

/**
 * A stretch as the stretches its readings make it: where two frames or more in a row read one word and the next two
 * or more an unrelated one, the words changed between them, at the frame the picture changed most. The read's first
 * and last stretches (`ends`) began and ended with the read, not at a change: they are cut where their words begin
 * and end.
 */
function splitByWords(
  stretch: Stretch,
  frames: readonly ZoneFrame[],
  step: number,
  ends: { readonly first: boolean; readonly last: boolean; readonly tiny: number },
): Stretch[] {
  const heaviest = new Map<number, OcrLine>();
  for (const { frame, line } of stretch.words)
    if (weightOf(line) > weightOf(heaviest.get(frame) ?? { ...line, confidence: 0 }))
      heaviest.set(frame, line);
  const runs: { text: string; first: number; last: number; frames: number }[] = [];
  for (const [frame, line] of [...heaviest.entries()].sort(([a], [b]) => a - b)) {
    const run = runs[runs.length - 1];
    if (run && normaliseText(run.text) === normaliseText(line.text)) {
      run.last = frame;
      run.frames += 1;
    } else runs.push({ text: line.text, first: frame, last: frame, frames: 1 });
  }
  const steady = runs.filter((run) => run.frames >= 2);
  /** The frame the picture changed most at, after `after` and up to `upTo`. */
  const most = (after: number, upTo: number) =>
    frames
      .filter((frame) => frame.frame > after && frame.frame <= upTo)
      .reduce<ZoneFrame | undefined>(
        (best, frame) => (best && best.change >= frame.change ? best : frame),
        undefined,
      )?.frame;
  const starts: (number | undefined)[] = [];
  steady.slice(1).forEach((run, at) => {
    const before = steady[at]!;
    if (!alike(before.text, run.text)) starts.push(most(before.last, run.first));
  });
  const read = [...heaviest.keys()].sort((a, b) => a - b);
  const [firstRead, lastRead] = [read[0], read[read.length - 1]];
  if (ends.first && firstRead !== undefined && firstRead - stretch.start > ends.tiny)
    starts.push(most(stretch.start, firstRead));
  if (ends.last && lastRead !== undefined && stretch.end - step - lastRead > ends.tiny)
    starts.push(most(lastRead, stretch.end - step));
  const inside = starts.filter(
    (at): at is number => at !== undefined && at > stretch.start && at < stretch.end,
  );
  if (inside.length === 0) return [stretch];
  const bounds = [...new Set([stretch.start, ...inside, stretch.end])].sort((a, b) => a - b);
  return bounds.slice(0, -1).map((start, at) => {
    const end = bounds[at + 1]!;
    return {
      start,
      end,
      words: stretch.words.filter((word) => word.frame >= start && word.frame < end),
      frames: Math.round((end - start) / step),
      atCut: at === 0 && stretch.atCut,
    };
  });
}

function pieceOf(stretch: Stretch, place: ZonePlace): ZonePiece {
  const read = agreed(stretch);
  if (!read) {
    return {
      text: null,
      start: stretch.start,
      end: stretch.end,
      box: {
        x: place.left,
        y: place.centreY - place.height / 2,
        width: place.right - place.left,
        height: place.height,
      },
      confidence: 0,
      samples: 0,
      drift: 0,
      language: null,
      spellings: [],
    };
  }
  const { lines } = read;
  const left = median(lines.map((line) => line.box.x));
  const top = median(lines.map((line) => line.box.y));
  const right = median(lines.map((line) => line.box.x + line.box.width));
  const bottom = median(lines.map((line) => line.box.y + line.box.height));
  const box = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  const quad = lines.find((line) => line.quad)?.quad;
  return {
    text: read.text,
    start: stretch.start,
    end: stretch.end,
    box,
    confidence: lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length,
    samples: read.frames,
    drift: Math.max(0, ...lines.map((line) => boxDrift(box, line.box))),
    language: lines.find((line) => line.language)?.language ?? null,
    ...(quad ? { quad } : {}),
    spellings: read.spellings,
  };
}

/**
 * The frames' time as pieces, in order, tiling it: read stretches with their words, unread ones without. `frames`
 * are in order, evenly spaced.
 */
export function zonePieces(
  frames: readonly ZoneFrame[],
  place: ZonePlace,
  options: ZoneOptions,
): ZonePiece[] {
  if (frames.length === 0) return [];
  const step = frames.length > 1 ? Math.max(1, frames[1]!.frame - frames[0]!.frame) : 1;
  const whole: Stretch[] = [];
  frames.forEach((page, at) => {
    const before = frames[at - 1];
    const atCut = options.cuts.some((cut) => cut <= page.frame && before !== undefined && cut > before.frame);
    const current = whole[whole.length - 1];
    const starts = !current || atCut || jumps(frames, at, options.changeRatio);
    const stretch = starts ? { start: page.frame, end: page.frame, words: [], frames: 0, atCut } : current;
    if (starts) whole.push(stretch);
    stretch.end = page.frame + step;
    stretch.frames += 1;
    for (const lines of page.readings) {
      const line = wordOn(lines, place, options);
      if (line) stretch.words.push({ frame: page.frame, line });
    }
  });
  let stretches = whole.flatMap((stretch, at) =>
    splitByWords(stretch, frames, step, {
      first: at === 0,
      last: at === whole.length - 1,
      tiny: options.tinyFrames,
    }),
  );
  const join = (first: Stretch, second: Stretch): Stretch => ({
    start: first.start,
    end: second.end,
    words: [...first.words, ...second.words],
    frames: first.frames + second.frames,
    atCut: first.atCut,
  });
  // An unread stretch too short to be shown on its own joins the stretch after it: the words entering, or not yet
  // readable over the picture.
  const joined: Stretch[] = [];
  for (let at = 0; at < stretches.length; at++) {
    const stretch = stretches[at]!;
    const next = stretches[at + 1];
    const tiny = stretch.end - stretch.start <= options.tinyFrames && agreed(stretch) === null;
    if (tiny && next) stretches[at + 1] = join(stretch, next);
    else joined.push(stretch);
  }
  // The same words either side of a jump are one piece (the picture moved, the words stayed); across a cut, alike
  // readings are one word over two pictures.
  const sameWords = (list: readonly Stretch[]): Stretch[] => {
    const out: Stretch[] = [];
    for (const stretch of list) {
      const last = out[out.length - 1];
      const a = last ? agreed(last) : null;
      const b = agreed(stretch);
      const one =
        a !== null &&
        b !== null &&
        (textSimilarity(a.text, b.text) >= TEXT_ZONE.same || (stretch.atCut && alike(a.text, b.text)));
      if (one && last) out[out.length - 1] = join(last, stretch);
      else out.push(stretch);
    }
    return out;
  };
  stretches = sameWords(joined);
  // Words read for too short a time to be shown on their own name the unread stretch beside them (the one before
  // first), unless that is the first or the last of what was read: there the read began or ended, not the words.
  const named: Stretch[] = [];
  for (let at = 0; at < stretches.length; at++) {
    const stretch = stretches[at]!;
    const before = named.length > 1 ? named[named.length - 1] : undefined;
    const next = at + 2 < stretches.length ? stretches[at + 1] : undefined;
    const tiny = stretch.end - stretch.start <= options.tinyFrames && agreed(stretch) !== null;
    if (tiny && before && agreed(before) === null)
      named[named.length - 1] = { ...join(before, stretch), frames: stretch.frames };
    else if (tiny && next && agreed(next) === null)
      stretches[at + 1] = { ...join(stretch, next), frames: stretch.frames };
    else named.push(stretch);
  }
  return sameWords(named).map((stretch) => pieceOf(stretch, place));
}
