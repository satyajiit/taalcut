// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scripted analysers for runBreakdown (BRK1-ACC): a made-up 360-frame landscape reel at 30 fps whose every signal
 * is written here, with the kinds of trouble BRK1 fixes. A long first shot with two chat bubbles and a sign at the
 * frame's edge; hard cuts at 170, 188 and 206; a walking shot (188–205) whose embedding drifts the whole way; a last
 * shot that fades to black from 340; music at 98 BPM; Whisper writing "[Music]" on the intro.
 */
import { FrameRate, FrameRates, ok, RationalTime, type BeatMap, type Box } from '@taalcut/core';
import type { BreakdownAnalysers, OcrPage } from '../../src/index';

export const SCRIPTED = {
  total: 360,
  width: 1280,
  height: 720,
  hardCuts: [170, 188, 206],
  fadeFrom: 340,
  fadeTo: 352,
} as const;

const DIM = 8;
const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return Float32Array.from(v.map((x) => x / n));
};
const axis = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0.05));

/** Each shot its own direction; the walking shot turns towards another one as it goes; the fade towards black. */
export function scriptedVector(frame: number): Float32Array {
  if (frame < 170) return unit(axis(0));
  if (frame < 188) return unit(axis(1));
  if (frame < 206) {
    const t = (frame - 188) / 17;
    return unit(axis(2).map((x, k) => x + 1.4 * t * (axis(3)[k] ?? 0)));
  }
  if (frame < SCRIPTED.fadeFrom) return unit(axis(4));
  const t = Math.min(1, (frame - SCRIPTED.fadeFrom) / (SCRIPTED.fadeTo - SCRIPTED.fadeFrom));
  return unit(axis(4).map((x, k) => x * (1 - t) + 1.5 * t * (axis(7)[k] ?? 0)));
}

export function scriptedLuma(frame: number): number {
  if (frame < SCRIPTED.fadeFrom) return 0.45;
  if (frame >= SCRIPTED.fadeTo) return 0.05;
  return 0.45 - ((0.45 - 0.05) * (frame - SCRIPTED.fadeFrom)) / (SCRIPTED.fadeTo - SCRIPTED.fadeFrom);
}

/**
 * The camera's motion (vision.motionCurve) at `frame` in the shot from `start`: the first shot is locked off, the
 * second pans across the same street (its picture stays one direction), the walking shot follows, and the last is
 * still but reads as noise once it fades. A cut's blend spikes on a shot's first sample.
 */
export function scriptedMotion(start: number, frame: number): number {
  if (frame === start && start > 0) return 0.9;
  if (frame >= SCRIPTED.fadeFrom) return 0.6;
  return frame >= 170 && frame < 206 ? 0.2 : 0.003;
}

/**
 * FRM1-MOT: the background's move between two frames read 3 apart (vision.cameraMotion), as the estimator gives it:
 * the bench shot and the billboard wall locked off, the street panned right (the picture slides left), the walk
 * followed (the background slides, the walker holds still), the fade's tail unreadable.
 */
export function scriptedPair(frame: number) {
  const still = {
    dx: 0,
    dy: 0,
    scale: 0,
    rotation: 0,
    inliers: 0.9,
    points: 150,
    residual: 0.001,
    subject: null,
  };
  if (frame >= SCRIPTED.fadeFrom) return null;
  if (frame >= 170 && frame < 188) return { ...still, dx: -0.012 };
  if (frame >= 188 && frame < 206) return { ...still, dx: -0.01, subject: { dx: 0.0004, dy: 0 } };
  return still;
}

const line = (text: string, box: Box, confidence = 1) => ({ text, box, confidence, language: null });

/** What OCR reads on one frame: two bubbles, a sign at the top edge, a shirt that moves, billboards in one shot. */
export function scriptedLines(frame: number) {
  const lines = [];
  if (frame >= 12 && frame < 118)
    lines.push(line('Where to next?', { x: 0.3, y: 0.26, width: 0.15, height: 0.04 }));
  if (frame >= 90 && frame < 118)
    lines.push(line('Soon...', { x: 0.32, y: 0.37, width: 0.08, height: 0.04 }));
  if (frame < 60) lines.push(line('CENTRAL STATION', { x: 0.78, y: 0, width: 0.2, height: 0.17 }));
  if (frame >= 125 && frame < 165)
    lines.push(line('ATHLETICS', { x: 0.3 + (frame - 125) / 200, y: 0.62, width: 0.1, height: 0.05 }));
  if (frame >= 206 && frame < 222)
    for (const [k, word] of ['COLA', 'FRESH', 'GLOW', 'NOODLE'].entries())
      lines.push(line(word, { x: 0.1 + k * 0.15, y: 0.2, width: 0.08, height: 0.04 }));
  return lines;
}

/** OCR every 7.5 frames, as the text pass samples at 4 a second. */
export function scriptedOcr(): OcrPage[] {
  const pages: OcrPage[] = [];
  for (let i = 0; Math.round(i * 7.5) < SCRIPTED.total; i++) {
    const frame = Math.round(i * 7.5);
    pages.push({ frame, lines: scriptedLines(frame) });
  }
  return pages;
}

const BEAT_MS = 60_000 / 98;
const BEATS = 19;

/** The tracker's map: 19 beats from 300 ms, bars of four from beat 1. */
export function scriptedBeatMap(): BeatMap {
  const beats = Array.from({ length: BEATS }, (_, k) =>
    RationalTime.of(Math.round(300 + k * BEAT_MS), FrameRate.of(1000)),
  );
  return {
    rate: FrameRate.of(1000),
    beats,
    downbeats: [1, 5, 9, 13, 17],
    bpm: 98,
    beatsPerBar: 4,
    confidence: 0.9,
    source: 'tracker',
  };
}

/** Onset strength at 50/s: strong on the beats, weak between them. */
export function scriptedEnvelope(): number[] {
  const peaks = Array.from({ length: 600 }, () => 0.1);
  for (let k = 0; k < BEATS; k++) peaks[Math.round(((300 + k * BEAT_MS) * 50) / 1000)] = 1;
  return peaks;
}

export interface ScriptOptions {
  /** Whisper's segments; default a bracketed note on the intro. */
  readonly speech?: { startMs: number; endMs: number; text: string }[] | null;
}

export function scriptedAnalysers(options: ScriptOptions = {}): BreakdownAnalysers {
  const rate = FrameRates.fps30;
  const { total } = SCRIPTED;
  return {
    media: {
      probe: async () =>
        ok({
          duration: RationalTime.of(total, rate),
          rate,
          width: SCRIPTED.width,
          height: SCRIPTED.height,
          hasVideo: true,
          hasAudio: true,
        }),
      normalise: async (_path, { outPath }) => ok({ path: outPath, frames: total }),
      extractFrames: async (_path, frames, { outDir, maxDimension }) =>
        ok(frames.map((frame) => `${outDir}/frame-${String(frame).padStart(6, '0')}-${maxDimension}.jpg`)),
      contactSheet: async (_images, _layout, { outPath }) => ok({ path: outPath, bytes: 1000 }),
      lumaCurve: async (_path, { ranges }) =>
        ok(
          ranges.flatMap(([start, end]) =>
            Array.from({ length: Math.max(0, end - start) }, (_, i) => ({
              frame: start + i,
              luma: scriptedLuma(start + i),
            })),
          ),
        ),
    },
    vision: {
      sceneScores: async () =>
        ok(
          Array.from({ length: total }, (_, f) =>
            (SCRIPTED.hardCuts as readonly number[]).includes(f) ? 60 : 1.5,
          ),
        ),
      frameEmbeddings: async (_path, frames) => ok(frames.map((frame) => scriptedVector(frame))),
      ocrFrames: async () => ok(scriptedOcr()),
      // Single-frame OCR for the edges: the frame number is in the extracted frame's name.
      ocrImage: async (path) => ok(scriptedLines(Number(/frame-(\d+)-/.exec(path)?.[1] ?? -1))),
      motionCurve: async (_path, { ranges }) =>
        ok(
          ranges.flatMap(([start, end]) =>
            Array.from({ length: Math.max(0, Math.ceil((end - start) / 3)) }, (_, i) => ({
              frame: start + i * 3,
              motion: scriptedMotion(start, start + i * 3),
            })),
          ),
        ),
      cameraMotion: async (_path, { ranges }) =>
        ok({
          version: 1,
          width: 384,
          height: 216,
          shots: ranges.map(({ start, end }) => ({
            start,
            end,
            pairs: Array.from({ length: Math.max(0, Math.ceil((end - start) / 3) - 1) }, (_, i) => ({
              frame: start + (i + 1) * 3,
              seconds: 0.1,
              motion: scriptedPair(start + (i + 1) * 3),
            })),
          })),
        }),
    },
    audio: {
      beats: async () =>
        ok({ beatMap: scriptedBeatMap(), envelope: { rate: FrameRate.of(50), peaks: scriptedEnvelope() } }),
      loudness: async () => ok({ integratedLufs: -14 }),
      transcribe: async () => {
        const segments =
          options.speech === undefined ? [{ startMs: 900, endMs: 2_100, text: '[Music]' }] : options.speech;
        return ok(segments === null ? null : { language: 'en', segments });
      },
    },
  };
}
