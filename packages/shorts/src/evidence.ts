// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type TranscriptSegment,
  type TranscriptWord,
} from '@taalcut/core';
import type { ShortsSourcePort, SourceDescription, SourceVisual } from './ports';

export const EDITORIAL_RECIPE = 'shorts-v1';
export const evidenceKey = (...parts: unknown[]): string =>
  `shorts:${EDITORIAL_RECIPE}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;

/** Durable plan provenance, independent of brand and destination. */
export const sourceFingerprint = (source: SourceDescription): string =>
  evidenceKey(source.contentHash, source.analysisVersion, source.duration).slice(-64);

export interface SourceSentence {
  readonly id: number;
  readonly text: string;
  readonly range: TimeRange;
  readonly wordStart: number;
  readonly wordEnd: number;
  readonly speaker?: string;
}
export interface SourceEvidence extends SourceDescription {
  readonly assetId: AssetId;
  readonly key: string;
  readonly sentences: readonly SourceSentence[];
  readonly words: readonly TranscriptWord[];
  readonly visuals: readonly SourceVisual[];
}

const invalid = (detail: string) => err(ValidationError({ field: 'shorts.evidence' }, { detail }));

/** Page every segment and scene. An invalid cursor fails rather than quietly selecting only the beginning. */
export async function readSourceEvidence(
  source: ShortsSourcePort,
  assetId: AssetId,
  signal?: AbortSignal,
): AsyncResult<SourceEvidence> {
  const described = await source.describe(assetId, signal);
  if (!described.ok) return described;
  const available = TimeRange.of(RationalTime.zero(described.value.duration.rate), described.value.duration);
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  do {
    if (signal?.aborted) return err(CancelledError());
    const page = await source.transcript(assetId, cursor, 500, signal);
    if (!page.ok) return page;
    if (!page.value) break;
    segments.push(...page.value.segments);
    if (segments.length > 20_000) return invalid('Transcript exceeds supported segment count');
    const next = page.value.nextSegment;
    if (next === undefined) break;
    if (next <= cursor || next !== cursor + page.value.segments.length) return invalid('Transcript cursor');
    cursor = next;
  } while (cursor >= 0);
  const visuals: SourceVisual[] = [];
  cursor = 0;
  do {
    if (signal?.aborted) return err(CancelledError());
    const page = await source.visuals(assetId, cursor, 500, signal);
    if (!page.ok) return page;
    visuals.push(...page.value.items);
    if (visuals.length > 100_000) return invalid('Source exceeds supported scene count');
    const next = page.value.next;
    if (next === undefined) break;
    if (next <= cursor || next !== cursor + page.value.items.length) return invalid('Visual cursor');
    cursor = next;
  } while (cursor >= 0);
  if (new Set(visuals.map((item) => item.id)).size !== visuals.length) return invalid('Duplicate scene ids');
  if (visuals.some((item) => !TimeRange.containsRange(available, item.range))) return invalid('Scene bounds');
  const words: TranscriptWord[] = [];
  const sentences: SourceSentence[] = [];
  for (const segment of segments) {
    if (!segment.words.length) {
      if (segment.text.trim()) return invalid('Speech is missing word timings');
      continue;
    }
    const first = segment.words[0]!;
    const last = segment.words.at(-1)!;
    if (
      segment.words.some(
        (word, i) =>
          !TimeRange.containsRange(available, word.range) ||
          word.range.duration.value <= 0 ||
          (i > 0 && RationalTime.isBefore(word.range.start, segment.words[i - 1]!.range.start)),
      )
    ) {
      return invalid('Unusable word timings');
    }
    if (words.length && RationalTime.isBefore(first.range.start, words.at(-1)!.range.start)) {
      return invalid('Unordered transcript pages');
    }
    const wordStart = words.length;
    words.push(...segment.words);
    sentences.push({
      id: sentences.length,
      text: segment.words.map((word) => word.text).join(' '),
      range: TimeRange.fromStartEnd(first.range.start, TimeRange.end(last.range)),
      wordStart,
      wordEnd: words.length - 1,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
    });
  }
  if (!sentences.length && !visuals.length) return invalid('Source indexing has no timed speech or scenes');
  const current = await source.describe(assetId, signal);
  if (!current.ok) return current;
  if (
    current.value.contentHash !== described.value.contentHash ||
    current.value.analysisVersion !== described.value.analysisVersion ||
    !RationalTime.equals(current.value.duration, described.value.duration)
  ) {
    return invalid('Source analysis changed while paging; retry with a consistent source');
  }
  return ok({
    ...described.value,
    assetId,
    sentences,
    words,
    visuals,
    key: evidenceKey(described.value.contentHash, described.value.analysisVersion, segments, visuals),
  });
}

export interface EvidenceWindow {
  readonly id: number;
  readonly sentences: readonly SourceSentence[];
  readonly visuals: readonly SourceVisual[];
}

/** Sentence windows overlap by one full sentence; no speech token or word time is fabricated. */
export function evidenceWindows(source: SourceEvidence): EvidenceWindow[] {
  const windows: EvidenceWindow[] = [];
  if (!source.sentences.length) {
    for (let from = 0; from < source.visuals.length; from += 16) {
      windows.push({ id: windows.length, sentences: [], visuals: source.visuals.slice(from, from + 16) });
    }
    return windows;
  }
  let from = 0;
  while (from < source.sentences.length) {
    let until = from;
    let size = 0;
    while (until < source.sentences.length && (size < 10_000 || until === from)) {
      size += source.sentences[until]!.text.length + 100;
      until++;
    }
    const sentences = source.sentences.slice(from, until);
    const range = TimeRange.span(sentences[0]!.range, sentences.at(-1)!.range);
    windows.push({
      id: windows.length,
      sentences,
      visuals: source.visuals.filter((visual) => TimeRange.overlaps(range, visual.range)).slice(0, 24),
    });
    from = until === source.sentences.length ? until : Math.max(from + 1, until - 1);
  }
  // Visual-only passages (demonstrations, action, timelapses) must also participate in selection.
  const seen = new Set(windows.flatMap((window) => window.visuals.map((item) => item.id)));
  const unseen = source.visuals.filter((visual) => !seen.has(visual.id));
  for (let index = 0; index < unseen.length; index += 16) {
    windows.push({ id: windows.length, sentences: [], visuals: unseen.slice(index, index + 16) });
  }
  return windows;
}

export function windowText(window: EvidenceWindow): string {
  return JSON.stringify({
    sentences: window.sentences.map(({ id, text, range, speaker }) => ({
      id,
      text,
      durationMs: RationalTime.rescale(range.duration, { num: 1000, den: 1 }).value,
      speaker,
    })),
    scenes: window.visuals.map(({ id, description, onScreenText, range }) => ({
      id,
      description: description.slice(0, 800),
      onScreenText: onScreenText?.slice(0, 400),
      durationMs: RationalTime.rescale(range.duration, { num: 1000, den: 1 }).value,
    })),
  });
}
