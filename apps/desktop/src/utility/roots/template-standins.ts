// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test, TAALCUT_TEST_STANDIN_ANALYSERS=1):
 * a beat tracker for the breakdown when the Beat This! component isn't
 * installed, so the desktop e2e breaks a reel down offline. NOT Beat This!:
 * beats are the onsets FFmpeg's silencedetect finds (clicks and hits on a
 * quiet bed), confidence 1. template-jobs.ts reaches this module only inside
 * `__TAALCUT_FLAVOUR__ === 'test'` through import(), so release bundles don't
 * contain it.
 */
import { FrameRate, ok, RationalTime, type AsyncResult, type BeatMap } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import type { BreakdownAudio } from '@taalcut/templates';

export const STANDIN_ANALYSERS_ENV = 'TAALCUT_TEST_STANDIN_ANALYSERS';

/** Onsets to the centisecond. */
const BEAT_RATE = FrameRate.of(100);
/** A click at 0 has no silence before it: a first silence starting this soon means one. */
const LEADING_CLICK_SECONDS = 0.05;

/** The beat map from silencedetect's log: each silence's end is an onset. Null with fewer than two. */
export function onsetBeatMap(log: string): BeatMap | null {
  const onsets = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  if (starts[0] !== undefined && starts[0] > 0 && starts[0] < LEADING_CLICK_SECONDS) onsets.unshift(0);
  const ticks = [...new Set(onsets.map((t) => Math.round(t * 100)))].sort((a, b) => a - b);
  if (ticks.length < 2) return null;
  const gaps = ticks
    .slice(1)
    .map((t, i) => t - ticks[i]!)
    .sort((a, b) => a - b);
  return {
    rate: BEAT_RATE,
    beats: ticks.map((t) => RationalTime.of(t, BEAT_RATE)),
    downbeats: ticks.map((_, i) => i).filter((i) => i % 4 === 0),
    bpm: Math.round(6000 / gaps[gaps.length >> 1]!),
    beatsPerBar: 4,
    confidence: 1,
    source: 'tracker',
  };
}

export function standinBeats(media: () => AsyncResult<MediaContext>): BreakdownAudio['beats'] {
  return async (path, { signal }) => {
    const ctx = await media();
    if (!ctx.ok) return ctx;
    const log: Buffer[] = [];
    const run = await runFfmpeg(
      ctx.value,
      ['-loglevel', 'info', '-i', path, '-vn', '-af', 'silencedetect=n=-40dB:d=0.05', '-f', 'null', '-'],
      // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
      { holdsVideoSession: false, signal, timeoutMs: 120_000, onStderr: (chunk) => log.push(chunk) },
    );
    if (!run.ok) return run;
    return ok({ beatMap: onsetBeatMap(Buffer.concat(log).toString('utf8')) });
  };
}
