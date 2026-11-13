// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-shot analysis (P2-L8, vision half): quality (sharpness, exposure,
 * stability) and its flags, motion class and energy (FRM1-MOT: the camera's
 * move measured, shot-camera.ts, its label the class), the sharpest frame,
 * orientation and a dHash of the best frame. On-screen text is its own stage
 * (`vision.ocr`, IX-O5): the analysis stores none. It all comes from the asset's analysis pass
 * (frame-pass.ts: every frame gray at 256 px with blackdetect's and
 * freezedetect's intervals beside it; about 10 samples a second with the
 * full statistics, every frame's change from the one before for casting's
 * motion peaks), which `vision.shots` already ran and left in the frame
 * cache; without it the pass runs here, still one decode for every shot.
 * Descriptions are a later, lower-priority stage (describe-shots.ts).
 */
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  shotAnalysisSchema,
  ValidationError,
  type AsyncResult,
  type CameraMotionMeasure,
  type ComputeFallbackEvent,
  type Orientation,
  type ShotAnalysis,
  type TimeRange,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { VISION_CONFIG } from '../config';
import type { FrameSource } from '../media/frame-source';
import { fitLongSide } from '../media/frames';
import { withFrameSource } from '../media/media-frame-source';
import { dHash, frameStats, frameStatsFallback } from '../quality/frame-stats';
import { sampleSignals, scoreShot, type SampleSignals } from '../quality/shot-quality';
import { analysisPass, type PassAnalysis } from './frame-pass';
import { shotProfileSignals } from './profile-signals';
import { measureShotCameras } from './shot-camera';

export interface AnalyzeShotsInput {
  readonly path: string;
  readonly shots: readonly { readonly shotId: string; readonly range: TimeRange }[];
}

export interface AnalyzedShot {
  readonly shotId: string;
  /** With casting's curves and peaks in `signals`. */
  readonly analysis: ShotAnalysis;
}

export interface AnalyzeShotsDeps {
  readonly media: MediaContext;
  /** A pass run here keeps the OCR frames for `vision.ocr` (this process reads on-screen text). */
  readonly keepOcrFrames?: boolean;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** The asset's frame source (the job's, over the frame cache). Absent: one over `path`, closed here. */
  readonly frames?: FrameSource;
  /** Segments of a long video a pass run here may decode at once (IX-D7). */
  readonly parallel?: number;
}

export interface AnalyzeContext {
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

const q = VISION_CONFIG.quality;

export function orientationOf(width: number, height: number): Orientation {
  if (Math.abs(width - height) <= 0.02 * Math.max(width, height)) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

interface ShotState {
  readonly shotId: string;
  readonly start: number;
  readonly end: number;
  readonly range: TimeRange;
  readonly samples: SampleSignals[];
  /** Each frame's change from the frame before, from the shot's first frame. */
  readonly frameChange: number[];
  best?: { readonly index: number; readonly sharpness: number; readonly dHash: string };
}

interface Interval {
  readonly startSec: number;
  readonly endSec: number;
}

/** Seconds of the shot each interval list covers: in all, and the longest single stretch. */
function covered(intervals: readonly Interval[], state: ShotState, fps: number) {
  const from = state.start / fps;
  const to = state.end / fps;
  let total = 0;
  let longest = 0;
  for (const interval of intervals) {
    const overlap = Math.min(to, interval.endSec) - Math.max(from, interval.startSec);
    if (overlap <= 0) continue;
    total += overlap;
    longest = Math.max(longest, overlap);
  }
  return { share: total / Math.max(1e-9, to - from), longest };
}

export async function analyzeShots(
  input: AnalyzeShotsInput,
  deps: AnalyzeShotsDeps,
  ctx: AnalyzeContext = {},
): AsyncResult<AnalyzedShot[]> {
  if (input.shots.length === 0) return ok([]);
  return withFrameSource(deps.frames, deps.media, input.path, ctx.signal, (frames) =>
    analyzeIn(frames, input, deps, ctx),
  );
}

/** The pass's samples and frame changes, shot by shot (shots sorted, not overlapping). */
function assign(states: readonly ShotState[], pass: PassAnalysis): void {
  let cursor = 0;
  for (const sample of pass.samples) {
    while (cursor < states.length && (states[cursor] as ShotState).end <= sample.index) cursor++;
    const state = states[cursor];
    if (!state || sample.index < state.start) continue;
    const { dHash: hash, ...signals } = sample;
    state.samples.push(signals);
    if (!state.best || sample.laplacianVariance > state.best.sharpness) {
      state.best = { index: sample.index, sharpness: sample.laplacianVariance, dHash: hash };
    }
  }
  for (const state of states) {
    state.frameChange.push(
      ...pass.frameChange.slice(state.start, Math.min(state.end, pass.frameChange.length)),
    );
  }
}

async function analyzeIn(
  frames: FrameSource,
  input: AnalyzeShotsInput,
  deps: AnalyzeShotsDeps,
  ctx: AnalyzeContext,
): AsyncResult<AnalyzedShot[]> {
  const { signal } = ctx;
  const source = frames.video;
  const fps = source.rate.num / source.rate.den;
  const states: ShotState[] = input.shots
    .map((shot) => {
      const start = RationalTime.toFrames(shot.range.start, source.rate);
      const end = start + Math.max(1, RationalTime.toFrames(shot.range.duration, source.rate));
      return { shotId: shot.shotId, start, end, range: shot.range, samples: [], frameChange: [] };
    })
    .sort((a, b) => a.start - b.start);

  deps.onFallback?.(frameStatsFallback());
  const pass = await analysisPass(frames, {
    ...(deps.keepOcrFrames ? { keepOcrFrames: true } : {}),
    ...(deps.parallel ? { parallel: deps.parallel } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!pass.ok) return pass;
  assign(states, pass.value);
  const { black, freeze, every } = pass.value;
  ctx.progress?.(0.4);

  // FRM1-MOT: the camera's move per shot, measured as the breakdown measures a slot's (shot-camera.ts).
  const cameras = await measureShotCameras(source, states, deps.media, signal);
  if (signal?.aborted) return err(CancelledError());
  ctx.progress?.(0.55);

  const results: AnalyzedShot[] = [];
  const secondsPerSample = every / fps;
  for (const [n, state] of states.entries()) {
    if (signal?.aborted) return err(CancelledError());
    // blackdetect and freezedetect on the same frames (their default rules: 2 s for a freeze).
    const detected = {
      black: covered(black, state, fps).share >= 0.5,
      frozen: covered(freeze, state, fps).longest >= 2,
    };
    const analysed = await analyseOne(
      state,
      frames,
      { secondsPerSample, detected, camera: cameras.get(state.shotId) },
      signal,
    );
    if (!analysed.ok) return analysed;
    const signals = shotProfileSignals({
      start: state.start,
      end: state.end,
      fps,
      secondsPerSample,
      samples: state.samples,
      frameChange: state.frameChange,
    });
    results.push({ shotId: state.shotId, analysis: { ...analysed.value, signals } });
    ctx.progress?.(0.55 + (0.45 * (n + 1)) / states.length);
  }
  return ok(results);
}

async function analyseOne(
  state: ShotState,
  frames: FrameSource,
  pass: {
    readonly secondsPerSample: number;
    readonly detected: { black: boolean; frozen: boolean };
    readonly camera: CameraMotionMeasure | undefined;
  },
  signal: AbortSignal | undefined,
): AsyncResult<ShotAnalysis> {
  // A shot shorter than one sample interval still gets its first frame.
  const source = frames.video;
  if (state.samples.length === 0 || !state.best) {
    const single = await frames.frames(
      { size: fitLongSide(source.width, source.height, q.longSide), format: 'gray', frames: [state.start] },
      signal,
    );
    if (!single.ok) return single;
    const frame = single.value[0];
    if (frame) {
      const stats = frameStats(frame);
      state.samples.push(sampleSignals(stats, undefined));
      state.best = {
        index: frame.index,
        sharpness: stats.laplacianVariance,
        dHash: dHash(frame.data, frame.width, frame.height),
      };
    }
  }
  const signals = scoreShot(state.samples, pass.secondsPerSample, pass.detected);
  const best = state.best;
  const analysis = shotAnalysisSchema.safeParse({
    version: 1,
    range: state.range,
    bestFrame: Math.max(0, signals.bestFrame - state.start),
    orientation: orientationOf(source.width, source.height),
    quality: signals.quality,
    motion: pass.camera?.label ?? signals.motion,
    ...(pass.camera ? { motionMeasure: pass.camera } : {}),
    energy: signals.energy,
    onScreenText: [],
    dHash: best ? best.dHash : '0000000000000000',
    descriptionSkipped: 'not_yet',
  });
  if (!analysis.success) {
    return err(ValidationError({ field: 'analysis' }, { detail: analysis.error.message.slice(0, 500) }));
  }
  return ok(analysis.data);
}
