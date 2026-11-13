// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text from OCR samples (SPEC "Text"): detections in successive
 * samples are one overlay when their normalised text is similar (≥ 0.85) and
 * their boxes overlap (IoU ≥ 0.5); a line that grows word by word across
 * samples is one overlay revealed `wordByWord`. A line seen in one sample only
 * is dropped unless the edge refinement (OCR on single frames, the second
 * method) confirms it. In screen recordings, text that stays for the whole
 * recording inside a platform's interface zones is chrome and is dropped.
 */
import type { Box } from '@taalcut/core';
import type { BreakdownConfig } from './config';
import type { OcrLine, OcrPage, OcrQuad } from './ports';

export interface TextTrack {
  /** The longest text seen (untrusted). */
  readonly text: string;
  readonly box: Box;
  /** First and last sample frames it was seen in. */
  readonly first: number;
  readonly last: number;
  /** Sample frames either side where it was not seen (the refinement searches between). */
  readonly before: number | null;
  readonly after: number | null;
  readonly samples: number;
  readonly confidence: number;
  readonly language: string | null;
  readonly wordByWord: boolean;
  /**
   * BRK1: how far the box moved across its samples, in box heights: up and down by its centre, across by whichever
   * of its left edge, centre or right edge moved least (a line growing word by word keeps its anchor).
   */
  readonly drift: number;
  /** FIX-SIGN: the quad of its longest reading, when the engine gave one. */
  readonly quad?: OcrQuad;
}

type TextConfig = BreakdownConfig['text'];

/** Lowercase, NFKC, no punctuation, single spaces: what "the same line" compares. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 1 − Levenshtein distance / the longer length, on code points. */
export function textSimilarity(a: string, b: string): number {
  const x = [...normaliseText(a)];
  const y = [...normaliseText(b)];
  if (x.length === 0 && y.length === 0) return 1;
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++)
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return 1 - previous[y.length]! / Math.max(x.length, y.length);
}

export function boxIou(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = x * y;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

/** `longer` continues `shorter` word by word, on the same line of the frame. */
function grows(shorter: OcrLine, longer: OcrLine): boolean {
  const a = normaliseText(shorter.text);
  const b = normaliseText(longer.text);
  const sameLine =
    Math.abs(shorter.box.y - longer.box.y) <= Math.max(shorter.box.height, longer.box.height) * 0.5;
  return (
    a.length > 0 &&
    b.length > a.length &&
    b.startsWith(`${a} `) &&
    sameLine &&
    boxIou(shorter.box, longer.box) > 0
  );
}

interface Open {
  line: OcrLine;
  first: number;
  last: number;
  before: number | null;
  missed: number;
  samples: number;
  confidence: number;
  wordByWord: boolean;
  origin: Box;
  drift: number;
}

/** How far `box` sits from `origin`, in heights (see TextTrack.drift). */
export function boxDrift(origin: Box, box: Box): number {
  const across = Math.min(
    Math.abs(box.x - origin.x),
    Math.abs(box.x + box.width / 2 - (origin.x + origin.width / 2)),
    Math.abs(box.x + box.width - (origin.x + origin.width)),
  );
  const down = Math.abs(box.y + box.height / 2 - (origin.y + origin.height / 2));
  return Math.hypot(across, down) / Math.max(origin.height, box.height, 1e-6);
}

function close(open: Open, after: number | null): TextTrack {
  return {
    text: open.line.text,
    box: open.line.box,
    first: open.first,
    last: open.last,
    before: open.before,
    after,
    samples: open.samples,
    confidence: open.confidence / open.samples,
    language: open.line.language ?? null,
    wordByWord: open.wordByWord,
    drift: open.drift,
    ...(open.line.quad ? { quad: open.line.quad } : {}),
  };
}

function stripLeadingOcrNoise(text: string): string {
  return normaliseText(text).replace(/^[1il|]\s+(?=[a-z]{2,})/u, '');
}

function cleanDisplayReading(a: string, b: string): string {
  const clean = (s: string) => s.replace(/^[1I|]\s+(?=[A-Za-z]{2,})/u, '');
  const ca = clean(a);
  const cb = clean(b);
  return normaliseText(cb).length >= normaliseText(ca).length ? cb : ca;
}

function isSameStaticTitle(a: TextTrack, b: TextTrack): boolean {
  if (b.first < a.last) return false;
  const maxGapFrames = a.after !== null ? Math.max(30, (a.after - a.last) * 3) : 30;
  if (b.first - a.last > maxGapFrames) return false;
  const aCentreY = a.box.y + a.box.height / 2;
  const bCentreY = b.box.y + b.box.height / 2;
  if (Math.abs(aCentreY - bCentreY) > Math.max(a.box.height, b.box.height) * 0.65) return false;
  const xOverlap = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x);
  if (xOverlap < Math.min(a.box.width, b.box.width) * 0.4) return false;
  const na = stripLeadingOcrNoise(a.text);
  const nb = stripLeadingOcrNoise(b.text);
  const numsA = na.match(/\d+/g)?.join(',') ?? '';
  const numsB = nb.match(/\d+/g)?.join(',') ?? '';
  if (numsA && numsB && numsA !== numsB) return false;
  if (textSimilarity(na, nb) >= 0.78) return true;
  return Math.min(na.length, nb.length) >= 12 && (na.includes(nb) || nb.includes(na));
}

function mergeStaticFragments(tracks: readonly TextTrack[]): TextTrack[] {
  const out: TextTrack[] = [];
  for (const track of tracks) {
    const prevIndex = out.findIndex((existing) => isSameStaticTitle(existing, track));
    if (prevIndex === -1) {
      out.push(track);
      continue;
    }
    const prev = out[prevIndex]!;
    const totalSamples = prev.samples + track.samples;
    const text = cleanDisplayReading(prev.text, track.text);
    const keepBox =
      normaliseText(track.text).length >= normaliseText(prev.text).length && track.samples >= prev.samples
        ? track.box
        : prev.box;
    out[prevIndex] = {
      ...prev,
      text,
      box: keepBox,
      last: track.last,
      after: track.after,
      samples: totalSamples,
      confidence: (prev.confidence * prev.samples + track.confidence * track.samples) / totalSamples,
      drift: Math.max(prev.drift, track.drift, boxDrift(prev.box, track.box)),
    };
  }
  return out;
}

/** Tracks every line across the samples (in frame order). */
export function trackText(pages: readonly OcrPage[], config: TextConfig): TextTrack[] {
  const done: TextTrack[] = [];
  let open: Open[] = [];
  const sorted = [...pages].sort((a, b) => a.frame - b.frame);
  sorted.forEach((page, index) => {
    const previousFrame = sorted[index - 1]?.frame ?? null;
    const seen = new Set<Open>();
    for (const line of page.lines) {
      if (line.confidence < config.minConfidence || normaliseText(line.text).length === 0) continue;
      const match = open.find(
        (track) =>
          !seen.has(track) &&
          ((textSimilarity(track.line.text, line.text) >= config.similarity &&
            boxIou(track.line.box, line.box) >= config.iou) ||
            grows(track.line, line)),
      );
      if (match) {
        if (grows(match.line, line)) match.wordByWord = true;
        if (normaliseText(line.text).length >= normaliseText(match.line.text).length) match.line = line;
        match.last = page.frame;
        match.missed = 0;
        match.samples += 1;
        match.confidence += line.confidence;
        match.drift = Math.max(match.drift, boxDrift(match.origin, line.box));
        seen.add(match);
      } else {
        const track: Open = {
          line,
          first: page.frame,
          last: page.frame,
          before: previousFrame,
          missed: 0,
          samples: 1,
          confidence: line.confidence,
          wordByWord: false,
          origin: line.box,
          drift: 0,
        };
        open.push(track);
        seen.add(track);
      }
    }
    open = open.filter((track) => {
      if (seen.has(track)) return true;
      track.missed += 1;
      if (track.missed <= config.maxGapSamples) return true;
      // Closed: the first sample after its last sighting is where it was gone.
      const after = sorted.find((p) => p.frame > track.last)?.frame ?? null;
      done.push(close(track, after));
      return false;
    });
  });
  for (const track of open) done.push(close(track, null));
  return mergeStaticFragments(done.sort((a, b) => a.first - b.first || a.box.y - b.box.y));
}

/** Interface zones of the platforms' players: top bar, bottom caption and buttons, right-hand action rail. */
function inChromeZone(box: Box): boolean {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  return centreY < 0.12 || centreY > 0.8 || centreX > 0.85;
}

/** Screen recordings: drop text that sits in an interface zone for (nearly) the whole recording. */
export function dropChrome(
  tracks: readonly TextTrack[],
  sampleCount: number,
  config: TextConfig,
): TextTrack[] {
  return tracks.filter(
    (track) => !(inChromeZone(track.box) && track.samples >= config.chromeShare * sampleCount),
  );
}

/**
 * The frame where a track starts (or ends), between the last sample without
 * it and the first with it, by binary search over single-frame OCR. `present`
 * answers for one frame. Returns the first frame it is present.
 */
export async function refineEdge(
  without: number,
  withIt: number,
  present: (frame: number) => Promise<boolean>,
): Promise<number> {
  let low = without;
  let high = withIt;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (await present(mid)) high = mid;
    else low = mid;
  }
  return high;
}

/** Does any OCR line on a frame match the track? */
export function matchesTrack(
  track: Pick<TextTrack, 'text' | 'box'>,
  lines: readonly OcrLine[],
  config: TextConfig,
): boolean {
  return lines.some(
    (line) =>
      line.confidence >= config.minConfidence &&
      boxIou(track.box, line.box) > 0 &&
      (textSimilarity(track.text, line.text) >= config.similarity ||
        normaliseText(track.text).startsWith(normaliseText(line.text))),
  );
}

/** The writing system a reading is mostly in, coarsely: enough to tell an English line from a sign in another script. */
function scriptOf(text: string): string {
  const counts = new Map<string, number>();
  for (const char of text) {
    const script = /\p{Script=Latin}/u.test(char)
      ? 'latin'
      : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)
        ? 'cjk'
        : /\p{Script=Hangul}/u.test(char)
          ? 'hangul'
          : /\p{Script=Devanagari}/u.test(char)
            ? 'devanagari'
            : /\p{L}/u.test(char)
              ? 'other'
              : null;
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
}

/**
 * FIX-SIGN: how many other readings sit right beside a track while it shows, in another size (half again as tall
 * or more) or another script: signage is a block of lines of every size and script on one plane; an editor's title
 * rarely is. Every reading counts, however faint.
 */
export function blockAround(track: TextTrack, pages: readonly OcrPage[]): number {
  const { box } = track;
  const h = Math.max(box.height, 1e-6);
  const script = scriptOf(track.text);
  const near = new Set<string>();
  for (const page of pages) {
    if (page.frame < track.first || page.frame > track.last) continue;
    for (const line of page.lines) {
      const text = normaliseText(line.text);
      if (text.length === 0 || textSimilarity(line.text, track.text) >= 0.4) continue;
      const other = line.box;
      const gapY = Math.max(other.y - (box.y + box.height), box.y - (other.y + other.height), 0);
      const gapX = Math.max(other.x - (box.x + box.width), box.x - (other.x + other.width), 0);
      if (gapY > 1.5 * h || gapX > h) continue;
      const ratio = Math.max(other.height, 1e-6) / h;
      if (ratio >= 1.5 || ratio <= 1 / 1.5 || scriptOf(line.text) !== script) near.add(text);
    }
  }
  return near.size;
}
