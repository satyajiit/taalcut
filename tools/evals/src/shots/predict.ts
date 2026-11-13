// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `predict:shots` (IX2-C1, IX2-C4, IX2-S1, IX2-S3): runs `vision.shots`' detector on a footage set's clips, as
 * the jobs process runs it (the analysis pass with the OCR frames kept, the bundled FFmpeg), and writes what it
 * found for `eval:shots`. `scdet` is the detector before TransNetV2 (scdet, then EmbeddingGemma 2 confirms each
 * cut); the model's two places are in model-detectors.ts, each at the app's stream rate or another
 * (`transnetv2@15`). Each clip's time is split at the detector's own progress marks: scdet's pass (0.6), locating
 * (0.7) and the embedding confirm (1); the model's pass with the stream fed to it (0.8) and the windows left after
 * the pass (1). Detectors load (and run one window) before the first clip, timed apart. Each clip also records
 * this thread's event-loop delay (loop-delay.ts).
 *
 * Several detectors and rounds run interleaved: every clip goes through every detector in turn, the order
 * rotating from clip to clip and round to round, so a machine whose load drifts (other lanes, security agents)
 * slows them alike. `cancelAfterMs` cancels each clip that long after it starts and records how long the detector
 * took to stop (`timings.cancel`), with no boundaries: a run for the cancellation latency, not for scoring.
 *
 * Each clip records which detector decided it; a model run with a clip that fell back to scdet is an error, and
 * nothing is written (decider.ts).
 *
 * Where the decode switch gives the analysis pass to the decode service, `route` runs each clip through the shots
 * job with it, as the app's jobs process does (service-route.ts, IX3-R1); a stream rate other than the app's
 * (`@fps`) reads FFmpeg's pass only, so it is refused on that route.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaContext } from '@taalcut/media';
import type { ComputeFallbackEvent } from '@taalcut/core';
import { createEmbedder, detectShots, TRANSNET_FILE, type DetectShotsDeps } from '@taalcut/vision';

/** The Core ML build's compiled model (the `transnetv2-coreml` component). */
const COREML_FILE = 'TransNetV2.mlmodelc';
import { misattributedClips } from './decider';
import { watchLoop } from './loop-delay';
import { modelDetector, SHOT_DETECTORS, warmUp, type ShotDetector } from './model-detectors';
import type { ClipPrediction, ShotLabels, ShotPredictions } from './schema';
import type { ShotsRoute } from './service-route';

export { SHOT_DETECTORS, type ShotDetector } from './model-detectors';

/** A detector, and for the model a stream rate cap other than the app's. */
export interface DetectorSpec {
  readonly detector: ShotDetector;
  readonly maxFps?: number;
}

/** `transnetv2`, `transnetv2@15`, `scdet`, …; undefined when it names no detector. */
export function parseDetector(text: string): DetectorSpec | undefined {
  const [name, fps] = text.split('@');
  const detector = SHOT_DETECTORS.find((known) => known === name);
  if (detector === undefined) return undefined;
  if (fps === undefined) return { detector };
  const maxFps = Number(fps);
  return maxFps > 0 && detector !== 'scdet' ? { detector, maxFps } : undefined;
}

/** The name a run is stored under: `scdet+confirm`, `transnetv2`, `transnetv2@15fps`. */
export function detectorName(spec: DetectorSpec): string {
  const name = spec.detector === 'scdet' ? 'scdet+confirm' : spec.detector;
  return spec.maxFps === undefined ? name : `${name}@${spec.maxFps}fps`;
}

export interface PredictShotsOptions {
  readonly detectors: readonly DetectorSpec[];
  /** Times every detector goes over the clips (default 1). */
  readonly rounds?: number;
  /** The footage set's folder (the manifest's clips by file name). */
  readonly footageDir: string;
  readonly media: MediaContext;
  /** EmbeddingGemma 2's folder (scdet's confirm). */
  readonly embedderDir: string;
  /** TransNetV2's folder (its `transnetv2.onnx`). */
  readonly modelDir: string;
  /** The Core ML build's folder (its `TransNetV2.mlmodelc`), for `transnetv2-coreml`. */
  readonly coremlDir?: string;
  /** Only these files, when given. */
  readonly clips?: readonly string[];
  /** Cancel each clip this long after it starts (the cancellation latency run). */
  readonly cancelAfterMs?: number;
  /** The decode service's route (service-route.ts): clips go through the shots job. Absent: FFmpeg's pass. */
  readonly route?: ShotsRoute;
  readonly log: (line: string) => void;
}

const MODEL_PARTS: readonly [number, string][] = [
  [0.8, 'passAndModel'],
  [1, 'modelAfterPass'],
];

/** Milliseconds between the detector's progress marks, named by part. */
const PARTS: Record<ShotDetector, readonly [number, string][]> = {
  scdet: [
    [0.6, 'pass'],
    [0.7, 'locate'],
    [1, 'confirm'],
  ],
  transnetv2: MODEL_PARTS,
  'transnetv2-coreml': MODEL_PARTS,
  'transnetv2-inline': MODEL_PARTS,
};

function partTimer(detector: ShotDetector) {
  const started = performance.now();
  let last = started;
  const timings: Record<string, number> = {};
  return {
    progress(fraction: number) {
      const part = PARTS[detector].find(([mark]) => mark === fraction);
      if (!part) return;
      const now = performance.now();
      timings[part[1]] = (timings[part[1]] ?? 0) + (now - last);
      last = now;
    },
    done(): Record<string, number> {
      return { ...timings, total: performance.now() - started };
    },
  };
}

interface OpenDetector {
  readonly spec: DetectorSpec;
  readonly deps: DetectShotsDeps;
  readonly loadMs: number;
  close(): Promise<void>;
}

async function openDetector(
  spec: DetectorSpec,
  options: PredictShotsOptions,
  fallbacks: string[],
): Promise<OpenDetector> {
  const onFallback = (event: ComputeFallbackEvent) => fallbacks.push(`${event.operation}: ${event.reason}`);
  const base = { media: options.media, keepOcrFrames: true, onFallback };
  const started = performance.now();
  if (spec.detector === 'scdet') {
    if (!existsSync(join(options.embedderDir, 'onnx')))
      throw new Error(`EmbeddingGemma 2 isn't in ${options.embedderDir}: pass --embedder-dir`);
    const embedder = createEmbedder({ modelDir: options.embedderDir, onFallback });
    await embedder.warm();
    return {
      spec,
      deps: { ...base, embedder },
      loadMs: performance.now() - started,
      close: () => embedder.close(),
    };
  }
  const coreml = spec.detector === 'transnetv2-coreml';
  const dir = coreml ? options.coremlDir : options.modelDir;
  if (dir === undefined || !existsSync(join(dir, coreml ? COREML_FILE : TRANSNET_FILE)))
    throw new Error(
      `TransNetV2 isn't in ${dir ?? 'any folder'}: pass ${coreml ? '--coreml-dir' : '--model-dir'}`,
    );
  const detector = modelDetector(spec.detector, dir, onFallback);
  const model = await warmUp(detector);
  if (!model.ok) throw new Error(`TransNetV2 didn't open: ${model.error.code} ${model.error.detail ?? ''}`);
  options.log(`${detectorName(spec)} on ${model.value.backend}`);
  return {
    spec,
    deps: { ...base, boundaryModel: detector.load, ...(spec.maxFps ? { modelMaxFps: spec.maxFps } : {}) },
    loadMs: performance.now() - started,
    close: () => detector.close(),
  };
}

/** One clip, timed by part, with this thread's event-loop delay; cancelled `cancelAfterMs` in when given. */
async function predictClip(
  file: string,
  open: OpenDetector,
  options: PredictShotsOptions,
): Promise<ClipPrediction> {
  const timer = partTimer(open.spec.detector);
  const watch = watchLoop();
  const cancel = new AbortController();
  let cancelledAt: number | undefined;
  const after =
    options.cancelAfterMs === undefined
      ? undefined
      : setTimeout(() => {
          cancelledAt = performance.now();
          cancel.abort();
        }, options.cancelAfterMs);
  const ctx = { progress: (fraction: number) => timer.progress(fraction), signal: cancel.signal };
  const path = join(options.footageDir, file);
  const found = await (options.route
    ? options.route.detect(path, open.deps, ctx)
    : detectShots(path, open.deps, ctx));
  clearTimeout(after);
  const stopped = performance.now();
  const loop = watch.stop();
  if (cancelledAt !== undefined)
    return { file, boundaries: [], timings: { cancel: stopped - cancelledAt }, loop };
  if (!found.ok) throw new Error(`${file}: ${found.error.code} ${found.error.detail ?? ''}`);
  return {
    file,
    detector: found.value.detector,
    boundaries: found.value.cuts.map((cut) => ({
      frame: cut.frame,
      ...(cut.kind ? { kind: cut.kind } : {}),
      ...(cut.span ? { span: cut.span } : {}),
    })),
    timings: timer.done(),
    loop,
  };
}

function logClip(log: (line: string) => void, name: string, predicted: ClipPrediction, pass: string): void {
  const { timings = {}, loop } = predicted;
  log(
    `${name} ${predicted.file}: ${predicted.boundaries.length} boundaries in ${Math.round(timings.total ?? 0)} ms` +
      (timings.cancel === undefined ? '' : `, stopped ${Math.round(timings.cancel)} ms after cancel`) +
      (loop ? `; loop delay p99 ${loop.p99} ms, max ${loop.max} ms` : '') +
      `; pass on ${pass}`,
  );
}

/** Which decoder ran the clip's pass: the service's (it may decline a file, as in the app), or FFmpeg. */
function passOf(options: PredictShotsOptions, file: string): string {
  return options.route?.passOf(join(options.footageDir, file)) ?? 'FFmpeg';
}

/** Every detector over the clips, `rounds` times, interleaved per clip; one run per detector and round. */
export async function predictShots(
  labels: ShotLabels,
  options: PredictShotsOptions,
): Promise<{ readonly round: number; readonly run: ShotPredictions }[]> {
  // onnxruntime-node 1.30 on macOS reports telemetry unless this is set before it loads.
  process.env.ORT_DISABLE_TELEMETRY = '1';
  const fallbacks: string[] = [];
  const opened: OpenDetector[] = [];
  const results: { round: number; open: OpenDetector; clips: ClipPrediction[] }[] = [];
  const studied = options.detectors.find((spec) => spec.maxFps !== undefined);
  if (options.route && studied)
    throw new Error(
      `${detectorName(studied)} reads FFmpeg's pass only (the shots job runs the app's stream rate): ` +
        'set TAALCUT_DECODE_SERVICE=frames for a stream rate study',
    );
  try {
    for (const spec of options.detectors) opened.push(await openDetector(spec, options, fallbacks));
    const files = labels.clips
      .map((clip) => clip.file)
      .filter((file) => !options.clips || options.clips.includes(file));
    for (let round = 1; round <= (options.rounds ?? 1); round++) {
      const runs = opened.map((open) => ({ round, open, clips: [] as ClipPrediction[] }));
      results.push(...runs);
      for (const [index, file] of files.entries())
        // Each clip starts with the next detector, so none always runs first (or right after another).
        for (const run of [
          ...runs.slice((index + round) % runs.length),
          ...runs.slice(0, (index + round) % runs.length),
        ]) {
          const predicted = await predictClip(file, run.open, options);
          run.clips.push(predicted);
          logClip(options.log, detectorName(run.open.spec), predicted, passOf(options, file));
        }
    }
  } finally {
    for (const open of opened) await open.close();
  }
  if (fallbacks.length > 0) options.log(`fallbacks: ${[...new Set(fallbacks)].join('; ')}`);
  options.log(
    opened.map((open) => `${detectorName(open.spec)} loaded in ${Math.round(open.loadMs)} ms`).join(', '),
  );
  const runs = results.map(({ round, open, clips }) => ({
    round,
    run: { detector: detectorName(open.spec), clips },
  }));
  // A model run holding scdet's boundaries would be scored as the model's (IX2-S7): nothing is written.
  const fellBack = runs.flatMap(({ run }) =>
    misattributedClips(run).map((clip) => `${run.detector}: ${clip}`),
  );
  if (fellBack.length > 0)
    throw new Error(`another detector decided these clips; no run written:\n${fellBack.join('\n')}`);
  return runs;
}
