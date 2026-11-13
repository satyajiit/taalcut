// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a finished text track stores (SPEC "De-duplication and timing"): its
 * text (the most frequent variant, or a reveal's full last one), its median
 * box, its reveal style, its language, and its range once the edges are
 * refined. `draftTrack` says which edges need refining; `assembleTrack` builds
 * the OnScreenText from the refined edges, so the tracker can refine every
 * track's edges together.
 */
import {
  RationalTime,
  TimeRange,
  type FrameRate,
  type NormalisedBox,
  type OnScreenText,
} from '@taalcut/core';
import { isCounter } from './counter-text';
import { clampBox, normaliseText, scriptOf } from './text';
import type { EdgeResult, EdgeSearch } from './track-refine';
import type { OcrObservation, OcrPage } from './types';

export interface Seen {
  readonly sample: number;
  readonly frame: number;
  readonly observation: OcrObservation;
}

type Reveal = OnScreenText['reveal'];

/** A track before its edges are refined. */
export interface TrackDraft {
  readonly text: string;
  readonly box: NormalisedBox;
  readonly reveal: Reveal;
  readonly seenCount: number;
  readonly first: number;
  readonly last: number;
  readonly confidence: number;
  readonly language?: string;
  /** Edges to bisect: the gap before the first sample and after the last, when there is one. */
  readonly start?: EdgeSearch;
  readonly end?: EdgeSearch;
}

/** Distinct texts in order of appearance, and whether each step grew the last one. */
function revealOf(seen: readonly Seen[]): Reveal {
  const variants: string[] = [];
  for (const { observation } of seen) {
    const text = normaliseText(observation.text);
    if (variants[variants.length - 1] !== text) variants.push(text);
  }
  if (variants.length < 2) return 'none';
  let wholeWords = true;
  for (let i = 1; i < variants.length; i++) {
    const before = variants[i - 1] ?? '';
    const after = variants[i] ?? '';
    if (!(after.length > before.length && after.startsWith(before))) return 'none';
    if (after[before.length] !== ' ') wholeWords = false;
  }
  return wholeWords ? 'wordByWord' : 'typewriter';
}

/** Most frequent variant; ties go to the higher confidence. A reveal's text is its last, full variant. */
function chooseText(seen: readonly Seen[], reveal: Reveal): string {
  if (reveal !== 'none') return normaliseText(seen[seen.length - 1]?.observation.text ?? '');
  const counts = new Map<string, { count: number; confidence: number }>();
  for (const { observation } of seen) {
    const text = normaliseText(observation.text);
    const entry = counts.get(text) ?? { count: 0, confidence: 0 };
    entry.count++;
    entry.confidence = Math.max(entry.confidence, observation.confidence);
    counts.set(text, entry);
  }
  let best = '';
  let bestEntry = { count: -1, confidence: -1 };
  for (const [text, entry] of counts) {
    if (
      entry.count > bestEntry.count ||
      (entry.count === bestEntry.count && entry.confidence > bestEntry.confidence)
    ) {
      best = text;
      bestEntry = entry;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function medianBox(observations: readonly OcrObservation[]): NormalisedBox {
  return clampBox({
    x: median(observations.map((o) => o.box.x)),
    y: median(observations.map((o) => o.box.y)),
    width: median(observations.map((o) => o.box.width)),
    height: median(observations.map((o) => o.box.height)),
  });
}

function mostCommon(values: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The track's text, box and the edges to refine. `pages` are the samples in
 * frame order; `endFrame` is the grid's exclusive end (a text still showing
 * at the last sample is bisected up to it, and that last frame is read
 * first: text that runs to the end is the common case, and one read then
 * places the edge exactly).
 */
export function draftTrack(
  seen: readonly Seen[],
  pages: readonly OcrPage[],
  endFrame: number | undefined,
): TrackDraft | null {
  const first = seen[0];
  const last = seen[seen.length - 1];
  if (!first || !last) return null;
  // A counter's readings differ by ticks, not by a growing reveal.
  const counter = seen.every((s) => isCounter(s.observation.text));
  const reveal = counter ? 'none' : revealOf(seen);
  const text = chooseText(seen, reveal);
  if (!text) return null;
  const matching = seen.map((s) => s.observation).filter((o) => normaliseText(o.text) === text);
  const chosen = matching.length > 0 ? matching : seen.map((s) => s.observation);
  const box = medianBox(chosen);
  const language = mostCommon(seen.map((s) => s.observation.language));
  const start = startEdge(first, pages[first.sample - 1], counter);
  const end = endEdge(last, pages[last.sample + 1], endFrame, { text, box, counter });
  return {
    text,
    box,
    reveal,
    seenCount: seen.length,
    first: first.frame,
    last: last.frame,
    confidence: Math.min(1, chosen.reduce((sum, o) => sum + o.confidence, 0) / chosen.length),
    ...(language ? { language } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  };
}

/** The gap before the first sample, when a sample came before it. */
function startEdge(first: Seen, before: OcrPage | undefined, counter: boolean): EdgeSearch | undefined {
  if (!before) return undefined;
  return {
    absent: before.frame,
    present: first.frame,
    text: normaliseText(first.observation.text),
    box: first.observation.box,
    ...(counter ? { counter } : {}),
  };
}

/**
 * The gap after the last sample: up to the next sample, or to the grid's end for a text still showing at the last
 * sample, whose last frame is probed first.
 */
function endEdge(
  last: Seen,
  after: OcrPage | undefined,
  endFrame: number | undefined,
  track: { readonly text: string; readonly box: NormalisedBox; readonly counter: boolean },
): EdgeSearch | undefined {
  const absent = after?.frame ?? endFrame;
  if (absent === undefined || absent <= last.frame) return undefined;
  const probe = !after && endFrame !== undefined && endFrame - 1 > last.frame ? endFrame - 1 : undefined;
  return {
    absent,
    present: last.frame,
    text: track.text,
    box: track.box,
    ...(probe !== undefined ? { probe } : {}),
    ...(track.counter ? { counter: track.counter } : {}),
  };
}

/** The refined track, or null for a one-sample flicker that refinement did not confirm. */
export function assembleTrack(
  draft: TrackDraft,
  start: EdgeResult | undefined,
  end: EdgeResult | undefined,
  rate: FrameRate,
): { readonly text: OnScreenText | null; readonly flicker: boolean } {
  const calls = (start?.calls ?? 0) + (end?.calls ?? 0);
  const confirmed = (start?.confirmed ?? 0) + (end?.confirmed ?? 0);
  // A text in one sample only is an OCR flicker unless a refinement frame also shows it.
  if (draft.seenCount === 1 && calls > 0 && confirmed === 0) return { text: null, flicker: true };
  const startFrame = start?.frame ?? draft.first;
  const duration = Math.max(1, (end?.frame ?? draft.last) + 1 - startFrame);
  return {
    flicker: false,
    text: {
      text: draft.text.slice(0, 500),
      box: draft.box,
      range: TimeRange.of(RationalTime.of(startFrame, rate), RationalTime.of(duration, rate)),
      confidence: draft.confidence,
      script: scriptOf(draft.text),
      ...(draft.language ? { language: draft.language } : {}),
      reveal: draft.reveal,
    },
  };
}
