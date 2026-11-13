// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysis pass (IX-D2): one decode of a video feeds everything the
 * indexing stages read from the whole file. Branches of one graph:
 * - analysis frames at `size` (256 px), every grid frame: `scdet` scores
 *   (`fine`), blackdetect and freezedetect, and the gray frames streamed to
 *   `onFrame` for frame statistics;
 * - every `coarseEvery`-th frame at the same size: `scdet` against the
 *   previous sample (shot candidates, as a 10-a-second pass scores them);
 * - frame sets written to files in `dir` for later stages (OCR frames), each
 *   capped at `maxFrames` so the cache's bound holds while the pass runs;
 * - a small RGB stream (IX2-C3, the shot-boundary model's input): a tap on
 *   the analysis branch, every `every`-th of its frames squeezed on the CPU to
 *   exactly `width` × `height` (bicubic, as the model's own extraction
 *   scales), handed to `onFrames` while the pass decodes (frame-tail.ts).
 * The frames are the frames `analyseVideo` and `sampleFrames` give for the
 * same sizes (test/analysis-pass). The analysis filters run on the CPU on
 * GPU-decoded, GPU-scaled frames (`reportAnalysisFilters`). A hardware decoder
 * that won't start runs the pass again on the software route, unless frames
 * already went out (decode-routes/software-retry.ts, IX2-F6).
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ok, RationalTime, type AsyncResult, type Result } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { reportAnalysisFilters, reportDecodeRoute } from '../compute-report';
import { decodeRouteFor } from '../decode-routes/select-route';
import { retryStreaming } from '../decode-routes/software-retry';
import type { MediaContext } from '../ffmpeg';
import { branchGraph, pickedFrames, type GraphBranch } from '../frame-sets/branch-graph';
import { filterPathArg } from '../primitives/filter-path';
import { frameFileArgs } from '../frame-sets/decode-frame-sets';
import { indexFrameFile, withoutFiles, type FrameFile } from '../frame-sets/frame-files';
import { resolveTone } from '../normalise/session';
import { outputSize } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';
import { parseBlackdetect, parseFreezedetect } from '../primitives/parsers';
import { splitRaw } from '../primitives/split';
import { runFfmpegRaw } from '../run-raw';
import { countHanded } from './handed-count';
import { helperPass } from './helper-pass';
import { DETECT_LINES, detectorFilters, SCDET, sceneFile, shifted } from './pass-common';
import type { AnalysisPassOptions, AnalysisPassResult } from './pass-types';
import { streamPart } from './rgb-stream';
import { lineFilter } from './scene-file';

export type {
  AnalysisPassOptions,
  AnalysisPassResult,
  PassFrame,
  PassFrameSet,
  SceneSample,
} from './pass-types';

export async function runAnalysisPass(
  path: string,
  source: NormalisationPlan,
  ctx: MediaContext,
  options: AnalysisPassOptions,
): AsyncResult<AnalysisPassResult> {
  const tone = await resolveTone(source, ctx, options.signal);
  if (!tone.ok) return tone;
  reportDecodeRoute(ctx, tone.value.plan.decode);
  reportAnalysisFilters(ctx);
  const helped = await helperPass(path, tone.value, ctx, options);
  if (helped) return helped;
  return retryStreaming(tone.value.plan, ctx, (plan, counted) =>
    ffmpegPass(path, plan, tone.value.tone, ctx, countHanded(options, counted)),
  );
}

/** The pass on FFmpeg's own decode, on the plan's route. */
async function ffmpegPass(
  path: string,
  plan: NormalisationPlan,
  toneMap: ToneMapChoice,
  ctx: MediaContext,
  options: AnalysisPassOptions,
): AsyncResult<AnalysisPassResult> {
  const size = { longSide: options.size ?? 256 };
  const tag = randomUUID();
  const fineFile = join(options.dir, `${tag}.fine.txt`);
  const coarseFile = join(options.dir, `${tag}.coarse.txt`);
  const coarseEvery = options.coarseEvery !== undefined ? Math.max(1, Math.round(options.coarseEvery)) : 0;
  const sets = (options.frameSets ?? []).filter((set) => set.maxFrames > 0);
  const stream = streamPart(options.rgbStream, join(options.dir, `${tag}.stream.rgb`));
  const detectors = detectorFilters(options.detectMinSeconds);
  const rate = plan.frameRate.output;
  const from = plan.kind === 'video' ? (options.window?.from ?? 0) : 0;
  const range =
    plan.kind === 'video' && options.window
      ? { start: RationalTime.of(from, rate), duration: RationalTime.of(options.window.frames, rate) }
      : undefined;
  const branches: GraphBranch[] = [
    {
      size,
      filters: [SCDET, `metadata=mode=print:file=${filterPathArg(fineFile)}`, ...detectors],
      taps: stream.taps,
    },
    ...(coarseEvery > 0
      ? [
          {
            size,
            pick: { every: coarseEvery },
            filters: [SCDET, `metadata=mode=print:file=${filterPathArg(coarseFile)}`],
          },
        ]
      : []),
    ...sets.map((set) => ({ size: set.size, pick: { every: set.every } })),
  ];
  const route = decodeRouteFor(plan, options.profile);
  const graph = branchGraph(path, plan, {
    route,
    toneMap,
    branches,
    ...(range ? { range } : {}),
  });
  const outputs = sets.map((set) => ({
    set,
    path: join(options.dir, `${randomUUID()}.${set.format === 'jpeg' ? 'mjpeg' : 'raw'}`),
  }));
  const label = (i: number) => graph.outputs[i] as string;
  const analysisOut = options.onFrame
    ? ['-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']
    : ['-f', 'null', '-'];
  const args = [
    '-y',
    '-loglevel',
    'info',
    ...graph.args,
    ...['-map', label(0), '-fps_mode', 'passthrough', ...analysisOut],
    ...(coarseEvery > 0 ? ['-map', label(1), '-fps_mode', 'passthrough', '-f', 'null', '-'] : []),
    ...outputs.flatMap((output, i) => [
      '-map',
      label(i + (coarseEvery > 0 ? 2 : 1)),
      '-fps_mode',
      'passthrough',
      '-frames:v',
      String(output.set.maxFrames),
      ...frameFileArgs(output.set.format),
      output.path,
    ]),
    ...stream.outputArgs(graph.outputs[branches.length]),
  ];
  const pixels = outputSize(plan, size);
  let frames = 0;
  const onStdout = options.onFrame
    ? splitRaw(pixels.width * pixels.height, (data) => {
        options.onFrame?.({ index: from + frames, width: pixels.width, height: pixels.height, data });
        frames += 1;
      })
    : undefined;
  const log = lineFilter(DETECT_LINES);
  const scratch = [fineFile, coarseFile, ...stream.scratch];
  const done = <T>(result: Result<T>, extra: readonly string[] = []): AsyncResult<T> =>
    withoutFiles([...scratch, ...extra], result);
  const tail = stream.start(from, options.signal);
  const run = await runFfmpegRaw(ctx, args, {
    // How a stop ends it (IX3-K2): never killed on a hardware decode route.
    holdsVideoSession: route.holdsVideoSession,
    ...(onStdout ? { onStdout } : {}),
    onStderr: (chunk) => log.push(chunk),
    timeoutMs: options.timeoutMs ?? 60 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const outputPaths = outputs.map((output) => output.path);
  if (!run.ok) await tail.stop();
  const ended = run.ok ? await tail.finish() : run;
  if (!ended.ok) return done(ended, outputPaths);
  const fine = await sceneFile(fineFile, 1, from);
  const coarse = coarseEvery > 0 ? await sceneFile(coarseFile, coarseEvery, from) : [];
  const total = Math.max(frames, fine.length);
  const files: FrameFile[] = [];
  for (const output of outputs) {
    const at = outputSize(plan, output.set.size);
    const indexed = await indexFrameFile({
      set: output.set.set,
      path: output.path,
      format: output.set.format,
      width: at.width,
      height: at.height,
      frames: pickedFrames({ every: output.set.every }, total)
        .slice(0, output.set.maxFrames)
        .map((index) => from + index),
    });
    if (!indexed.ok) return done(indexed, outputPaths);
    files.push(indexed.value);
  }
  const text = log.text();
  const offset = (from * rate.den) / rate.num;
  const endSec = range ? (total * rate.den) / rate.num : RationalTime.toSeconds(plan.duration);
  return done(
    ok({
      fine,
      coarse,
      black: shifted(parseBlackdetect(text), offset),
      freeze: shifted(parseFreezedetect(text, endSec), offset),
      frames: from + total,
      files,
    }),
  );
}
