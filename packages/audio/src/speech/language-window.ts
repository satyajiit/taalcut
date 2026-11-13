// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The language-ID window (IX-A2), pure: of every span up to `windowMs` long, the one that holds the most voice
 * (the earliest on a tie), trimmed to the voice inside it plus a little either side. Spans are milliseconds on
 * the asset clock, sorted and apart. O(n log n): an hour of speech has thousands of spans and the scan asks often.
 */
import type { Span } from '../cleanup/segments';

export interface LanguageWindow {
  readonly startMs: number;
  readonly endMs: number;
  /** Voice inside it. */
  readonly speechMs: number;
}

export function totalSpeechMs(speech: readonly Span[]): number {
  return speech.reduce((sum, span) => sum + Math.max(0, span.endMs - span.startMs), 0);
}

/** First index whose span passes `test` (spans are sorted, so the ones that pass come last). */
function firstWhere(speech: readonly Span[], test: (span: Span) => boolean): number {
  let lo = 0;
  let hi = speech.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const span = speech[mid];
    if (span && test(span)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const firstEndingAfter = (speech: readonly Span[], ms: number) => firstWhere(speech, (s) => s.endMs > ms);
const firstStartingFrom = (speech: readonly Span[], ms: number) => firstWhere(speech, (s) => s.startMs >= ms);

/** Voice in [startMs, endMs), from prefix sums: the spans it touches, less what sticks out either side. */
function coverage(
  speech: readonly Span[],
  prefix: readonly number[],
  startMs: number,
  endMs: number,
): number {
  const first = firstEndingAfter(speech, startMs);
  const last = firstStartingFrom(speech, endMs) - 1;
  if (last < first) return 0;
  const head = speech[first];
  const tail = speech[last];
  if (!head || !tail) return 0;
  const whole = (prefix[last + 1] ?? 0) - (prefix[first] ?? 0);
  return whole - Math.max(0, startMs - head.startMs) - Math.max(0, tail.endMs - endMs);
}

/**
 * An optimal window can always be slid until it starts where some voice starts or ends where some voice ends,
 * so those are the only places to try.
 */
export function languageWindow(
  speech: readonly Span[],
  options: { readonly windowMs: number; readonly durationMs: number; readonly padMs: number },
): LanguageWindow | null {
  const { windowMs, durationMs, padMs } = options;
  if (speech.length === 0 || durationMs <= 0) return null;
  const prefix = [0];
  for (const span of speech)
    prefix.push((prefix[prefix.length - 1] ?? 0) + Math.max(0, span.endMs - span.startMs));
  const length = Math.min(windowMs, durationMs);
  const place = (startMs: number) => Math.min(Math.max(0, startMs), Math.max(0, durationMs - length));
  const starts = [...new Set(speech.flatMap((s) => [place(s.startMs), place(s.endMs - length)]))].sort(
    (a, b) => a - b,
  );
  let best = { startMs: 0, speechMs: 0 };
  for (const startMs of starts) {
    const speechMs = coverage(speech, prefix, startMs, startMs + length);
    if (speechMs > best.speechMs) best = { startMs, speechMs };
  }
  if (best.speechMs <= 0) return null;
  const end = best.startMs + length;
  const first = speech[firstEndingAfter(speech, best.startMs)];
  const last = speech[firstStartingFrom(speech, end) - 1];
  const voiceStart = Math.max(best.startMs, first?.startMs ?? best.startMs);
  const voiceEnd = Math.min(end, last?.endMs ?? end);
  return {
    startMs: Math.max(best.startMs, voiceStart - padMs),
    endMs: Math.min(end, voiceEnd + padMs),
    speechMs: best.speechMs,
  };
}
