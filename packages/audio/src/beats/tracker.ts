// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beat This! tracker. The log-mel front end is an ONNX graph from
 * `encodeOnnxModel` on the runtime's plan (CUDA or WebGPU first, devices.ts).
 * TypeScript is the oracle and the logged fallback. A CPU model session is
 * logged by the runtime, not here.
 */
import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  float32sFrom,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type TimeRange,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { BeatTrackingFailed, ModelMissing } from '../errors';
import { assembleBeatAnalysis, emptyBeatAnalysis } from './assemble';
import { decodeBeatAudio } from './decode';
import { DEFAULT_BEAT_PLAN } from './devices';
import { runLogMel } from './mel-onnx';
import { pickPeaks } from './peaks';
import { planWindows, stitchPredictions, type BeatWindow, type WindowPrediction } from './aggregate';
import type { BeatAnalysis, BeatAudio, BeatOnnxRuntime, BeatOnnxSession } from './types';

const { nMels, windowFrames, model } = AUDIO_CONFIG.beats;
const FILTER_FLOATS = AUDIO_CONFIG.beats.nFreq * nMels;

export interface BeatTrackerDeps {
  readonly onnx: BeatOnnxRuntime;
  readonly modelDir: string;
  readonly media?: MediaContext;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
}

export interface BeatTrackOptions {
  readonly signal?: AbortSignal;
  readonly range?: TimeRange;
}

export function createBeatTracker(deps: BeatTrackerDeps): {
  trackBeats(audio: BeatAudio, options?: BeatTrackOptions): AsyncResult<BeatAnalysis>;
} {
  return {
    trackBeats(audio, options) {
      return trackBeats(deps, audio, options);
    },
  };
}

async function trackBeats(
  deps: BeatTrackerDeps,
  audio: BeatAudio,
  options?: BeatTrackOptions,
): AsyncResult<BeatAnalysis> {
  if (options?.signal?.aborted) return err(CancelledError());
  const decoded = await decodeBeatAudio(audio, {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.range ? { range: options.range } : {}),
    ...(deps.media ? { media: deps.media } : {}),
  });
  if (!decoded.ok) return decoded;
  if (decoded.value.samples.length === 0) return ok(emptyBeatAnalysis());
  if (options?.signal?.aborted) return err(CancelledError());

  const modelPath = join(deps.modelDir, 'beat_this.onnx');
  const filterPath = join(deps.modelDir, 'mel-filterbank.bin');
  if (!(await readable(modelPath)) || !(await readable(filterPath))) {
    return err(ModelMissing({ component: 'beat-this' }));
  }
  const filterbank = float32sFrom(await readFile(filterPath), FILTER_FLOATS);
  if (!filterbank)
    return err(BeatTrackingFailed(undefined, { detail: 'mel-filterbank.bin has the wrong size' }));

  const plan = (await deps.onnx.plan?.()) ?? DEFAULT_BEAT_PLAN;
  const front = await runLogMel(decoded.value.samples, filterbank, deps.onFallback, plan);
  if (options?.signal?.aborted) return err(CancelledError());

  const session = await deps.onnx.openSession(modelPath, {
    operation: 'audio.trackBeats',
    candidates: plan.devices,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  if (!session.ok) return session;
  // `backend === 'cpu'` was already logged by the runtime.
  try {
    const windows = planWindows(front.frames);
    if (windows.length === 0) return ok(emptyBeatAnalysis());
    const pieces = await predictWindows(session.value, front.logMel, front.frames, windows, options?.signal);
    if (!pieces.ok) return pieces;
    const stitched = stitchPredictions(front.frames, pieces.value);
    const peaks = pickPeaks(stitched.beat, stitched.downbeat);
    return ok(
      assembleBeatAnalysis({
        beatFrames: peaks.beats,
        downbeatFrames: peaks.downbeats,
        onset: front.onset,
        shiftMs: decoded.value.shiftMs,
      }),
    );
  } finally {
    await session.value.release?.();
  }
}

/** The exported graph reshapes to 1500×128, so each call is one window. */
async function predictWindows(
  session: BeatOnnxSession,
  logMel: Float32Array,
  nFrames: number,
  windows: readonly BeatWindow[],
  signal?: AbortSignal,
): AsyncResult<WindowPrediction[]> {
  const pieces: WindowPrediction[] = [];
  for (const window of windows) {
    if (signal?.aborted) return err(CancelledError());
    const packed = packWindows(logMel, nFrames, [window.start]);
    const predicted = await session.run(
      { data: packed, dims: [1, windowFrames, nMels] },
      signal ? { signal } : undefined,
    );
    if (!predicted.ok) return predicted;
    pieces.push({
      start: window.start,
      beat: predicted.value.beat.subarray(0, windowFrames),
      downbeat: predicted.value.downbeat.subarray(0, windowFrames),
    });
  }
  return ok(pieces);
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packWindows(logMel: Float32Array, nFrames: number, starts: readonly number[]): Float32Array {
  const data = new Float32Array(starts.length * windowFrames * nMels);
  for (let w = 0; w < starts.length; w++) {
    const start = starts[w] ?? 0;
    for (let frame = 0; frame < windowFrames; frame++) {
      const src = start + frame;
      if (src < 0 || src >= nFrames) continue;
      const from = src * nMels;
      data.set(logMel.subarray(from, from + nMels), (w * windowFrames + frame) * nMels);
    }
  }
  return data;
}

export const BEAT_MODEL_ID = model;
