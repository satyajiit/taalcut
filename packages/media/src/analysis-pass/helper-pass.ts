// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The analysis pass over the decode service (IX2-V3). The service decodes, turns and scales the video and
 * writes every grid frame as NV12 into a FIFO; a CPU-only FFmpeg reads the FIFO as raw video and runs the
 * pass's analysis filters on it (scene scores, black and freeze detection, the gray frames, the small RGB
 * stream's tap), the very filters FFmpeg's own route runs after its VideoToolbox download. Frame sets go
 * straight to their files.
 *
 * The decode holds one hardware video session lease, as FFmpeg's would. A file the service declines (codes
 * `decode.unsupported`, `decode.off_grid`, … before any frame reached `onFrame`) goes on to FFmpeg's route
 * at once; one it fails part way, after frames went out, fails retryably and its next pass goes to FFmpeg: every
 * later read of it, frame reads too, when the code says the service can't read the file as FFmpeg does
 * (eligible.ts `avoidsFile`), only that next pass otherwise (`decode.failed`, `decode.output_closed`: IX2-F16).
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { err, ok, RationalTime, type Result, type TaalcutError } from '@taalcut/core';
import type { ToneMapChoice } from '../backends';
import { avoidsFile } from '../decode-service/eligible';
import { tellOnce } from '../decode-service/tell-once';
import type { DecodePassReport, DecodePassRequest, DecodeService } from '../decode-service/types';
import { MediaCancelled, MediaTimeout } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { pickedFrames } from '../frame-sets/branch-graph';
import { indexFrameFile, withoutFiles, type FrameFile } from '../frame-sets/frame-files';
import type { NormalisationPlan } from '../normalise/types';
import { parseBlackdetect, parseFreezedetect } from '../primitives/parsers';
import { runProcess } from '../process/runner';
import { helperCode, SidecarFailed } from '../sidecar/errors';
import { helperRequestHold } from '../hardware-sessions/helper-request';
import { holdFifo } from './fifo-hold';
import { helperChoice, type HelperPassPlan } from './helper-eligible';
import { startReader, type RunningReader } from './helper-reader';
import { sceneFile, shifted } from './pass-common';
import type { AnalysisPassOptions, AnalysisPassResult } from './pass-types';
import { streamPart, type RgbBatch, type RgbStream, type StreamPart } from './rgb-stream';

/** Once per process and reason: which passes the service leaves to FFmpeg, and the first it decodes. */
const tell = tellOnce('analysis pass');

const declined = (service: string, reason: string) =>
  tell(reason, `${service} declined (${reason}); FFmpeg decodes`);

/**
 * Per service, files whose last pass failed part way for a reason that is the read's, not the file's: the next pass
 * of each goes to FFmpeg, once (IX2-F16).
 */
const nextPassOnFfmpeg = new WeakMap<DecodeService, Map<string, string>>();

/** Why the next pass of `path` goes to FFmpeg, once, or undefined: the service is asked. */
function takeNextPass(service: DecodeService, path: string): string | undefined {
  const files = nextPassOnFfmpeg.get(service);
  const code = files?.get(path);
  files?.delete(path);
  return code;
}

async function makeFifo(ctx: MediaContext, path: string): Promise<Result<void>> {
  const run = await (ctx.runner ?? runProcess)('/usr/bin/mkfifo', ['-m', '600', path], { timeoutMs: 10_000 });
  if (!run.ok) return run;
  if (run.value.exitCode === 0) return ok(undefined);
  return err(SidecarFailed(undefined, { detail: `mkfifo: ${run.value.stderrTail.trim()}` }));
}

type SetOutput = HelperPassPlan['sets'][number] & { readonly path: string };

/**
 * The pass's files in its folder: the FIFO, scene files and the stream's file (always removed) and the frame
 * sets (kept); and the stream, counting the frames it has handed over.
 */
interface PassFiles {
  readonly fifo: string;
  readonly fineFile: string;
  readonly coarseFile: string;
  readonly sets: readonly SetOutput[];
  readonly stream: StreamPart;
  readonly streamed: () => number;
  readonly scratch: readonly string[];
  readonly all: readonly string[];
}

function passFiles(dir: string, use: HelperPassPlan, rgb: RgbStream | undefined): PassFiles {
  const tag = randomUUID();
  const fifo = join(dir, `${tag}.nv12`);
  const fineFile = join(dir, `${tag}.fine.txt`);
  const coarseFile = join(dir, `${tag}.coarse.txt`);
  const sets = use.sets.map((s) => ({ ...s, path: join(dir, `${randomUUID()}.raw`) }));
  let handed = 0;
  const counted = rgb && {
    ...rgb,
    onFrames: (batch: RgbBatch) => {
      handed += batch.count;
      return rgb.onFrames(batch);
    },
  };
  const stream = streamPart(counted, join(dir, `${tag}.stream.rgb`));
  const scratch = [fifo, fineFile, coarseFile, ...stream.scratch];
  const all = [...scratch, ...sets.map((s) => s.path)];
  return { fifo, fineFile, coarseFile, sets, stream, streamed: () => handed, scratch, all };
}

function serviceRequest(
  path: string,
  plan: NormalisationPlan,
  options: AnalysisPassOptions,
  use: HelperPassPlan,
  files: PassFiles,
): DecodePassRequest {
  return {
    path,
    rate: { num: plan.frameRate.output.num, den: plan.frameRate.output.den },
    ...(options.window ? { window: options.window } : {}),
    rotation: plan.rotation,
    range: use.range,
    analysis: { ...use.analysis, path: files.fifo },
    sets: files.sets.map((o) => ({
      width: o.target.width,
      height: o.target.height,
      every: Math.max(1, Math.round(o.set.every)),
      maxFrames: o.set.maxFrames,
      format: o.set.format === 'gray8' ? 'gray8' : 'rgb24',
      path: o.path,
    })),
  };
}

/**
 * The pass on the decode service, or undefined when FFmpeg's route should run it: no service, a file it
 * doesn't take, or a decline before any frame went out.
 */
export async function helperPass(
  path: string,
  toned: { readonly plan: NormalisationPlan; readonly tone: ToneMapChoice },
  ctx: MediaContext,
  options: AnalysisPassOptions,
): Promise<Result<AnalysisPassResult> | undefined> {
  const choice = helperChoice(path, toned.plan, options);
  if (!choice) return undefined;
  if ('decline' in choice) {
    declined(options.decodeService?.id ?? 'decode service', choice.decline);
    return undefined;
  }
  const retried = takeNextPass(choice.use.service, path);
  if (retried !== undefined) {
    declined(choice.use.service.id, `retry_after_${retried}`);
    return undefined;
  }
  return runOnService(path, toned.plan, ctx, options, choice.use);
}

const PASS_TIMEOUT_MS = 60 * 60_000;
const timeoutOf = (options: AnalysisPassOptions) => options.timeoutMs ?? PASS_TIMEOUT_MS;
const coarseEveryOf = (options: AnalysisPassOptions) =>
  options.coarseEvery !== undefined ? Math.max(1, Math.round(options.coarseEvery)) : 0;

/** The CPU FFmpeg on the FIFO, started before the service writes into it. */
function readOutputs(
  ctx: MediaContext,
  use: HelperPassPlan,
  files: PassFiles,
  plan: NormalisationPlan,
  options: AnalysisPassOptions,
): RunningReader {
  return startReader(
    ctx,
    use,
    {
      ...files,
      coarseEvery: coarseEveryOf(options),
      rate: plan.frameRate.output,
      grayOut: options.onFrame !== undefined,
      ...(options.detectMinSeconds !== undefined ? { detectMinSeconds: options.detectMinSeconds } : {}),
    },
    {
      from: options.window?.from ?? 0,
      timeoutMs: timeoutOf(options),
      ...(options.onFrame ? { onFrame: options.onFrame } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
}

async function runOnService(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: AnalysisPassOptions,
  use: HelperPassPlan,
): Promise<Result<AnalysisPassResult> | undefined> {
  const files = passFiles(options.dir, use, options.rgbStream);
  if (!(await makeFifo(ctx, files.fifo)).ok) {
    declined(use.service.id, 'no_fifo');
    return undefined;
  }
  // The service's open of the FIFO never waits on the reader's start (fifo-hold.ts, IX3-F4).
  const held = await holdFifo(files.fifo);
  if (!held.ok) {
    declined(use.service.id, 'no_fifo');
    await withoutFiles(files.scratch, ok(undefined));
    return undefined;
  }
  const lease = ctx.hardwareSessions ? await ctx.hardwareSessions.acquire(1, options.signal) : undefined;
  if (lease && !lease.ok) {
    await held.value.release();
    return withoutFiles(files.scratch, lease);
  }
  const tail = files.stream.start(options.window?.from ?? 0, options.signal);
  const reader = readOutputs(ctx, use, files, plan, options);
  void reader.done.then(() => held.value.release());
  const request = serviceRequest(path, plan, options, use, files);
  const decoded = await use.service.pass(request, {
    ...(options.signal ? { signal: options.signal } : {}),
    timeoutMs: timeoutOf(options),
    // The helper's pid is on the lease's slot before the pass is sent, and the lease goes back only when the service
    // has let go of its session: at its reply (a cancel's too) or its exit (IX2-F4, IX3-F7).
    ...helperRequestHold(lease?.ok ? lease.value : undefined),
  });
  if (!decoded.ok) reader.stop();
  const read = await reader.done;
  if (!decoded.ok || !read.ok) await tail.stop();
  // Stream frames handed over count as frames gone out: the model must not see the file twice.
  if (!decoded.ok) return failed(path, use, decoded.error, reader.delivered() + files.streamed(), files.all);
  if (!read.ok) return withoutFiles(files.all, read);
  const streamed = await tail.finish();
  if (!streamed.ok) return withoutFiles(files.all, streamed);
  ctx.decodeTally?.recordDecode(options.window ? 'partial' : 'full', path);
  tell('used', `decoding with ${use.service.id} (${decoded.value.frames} frames in ${decoded.value.ms} ms)`);
  const result = await collect(plan, options, files, decoded.value, reader);
  return withoutFiles(result.ok ? files.scratch : files.all, result);
}

/** A service failure: cancelled and timed out as they are; a decline before any frame goes on to FFmpeg. */
async function failed(
  path: string,
  use: HelperPassPlan,
  error: TaalcutError,
  delivered: number,
  files: readonly string[],
): Promise<Result<AnalysisPassResult> | undefined> {
  if (MediaCancelled.is(error) || MediaTimeout.is(error)) return withoutFiles(files, err(error));
  const code = helperCode(error);
  await withoutFiles(files, ok(undefined));
  if (delivered === 0) {
    declined(use.service.id, code);
    return undefined;
  }
  if (avoidsFile(code)) use.service.avoid(path, code);
  else nextPassOnFfmpeg.set(use.service, (nextPassOnFfmpeg.get(use.service) ?? new Map()).set(path, code));
  const detail = `${use.service.id} failed after ${delivered} frames (${code}); the next pass decodes with FFmpeg`;
  return err(SidecarFailed({ helperCode: code }, { detail }));
}

/** The pass's result from the reader's scene files and log and the service's frame files. */
async function collect(
  plan: NormalisationPlan,
  options: AnalysisPassOptions,
  files: PassFiles,
  report: DecodePassReport,
  reader: RunningReader,
): Promise<Result<AnalysisPassResult>> {
  const from = options.window?.from ?? 0;
  const coarseEvery = coarseEveryOf(options);
  const total = report.frames;
  const fine = await sceneFile(files.fineFile, 1, from);
  if (fine.length !== total || (options.onFrame && reader.delivered() !== total)) {
    const detail = `the analysis filters read ${fine.length} of ${total} frames`;
    return err(SidecarFailed(undefined, { detail }));
  }
  const coarse = coarseEvery > 0 ? await sceneFile(files.coarseFile, coarseEvery, from) : [];
  const indexed = await indexSets(files.sets, report, total, from);
  if (!indexed.ok) return indexed;
  const rate = plan.frameRate.output;
  const text = reader.detections();
  const offset = (from * rate.den) / rate.num;
  const endSec = options.window ? (total * rate.den) / rate.num : RationalTime.toSeconds(plan.duration);
  return ok({
    fine,
    coarse,
    black: shifted(parseBlackdetect(text), offset),
    freeze: shifted(parseFreezedetect(text, endSec), offset),
    frames: from + total,
    files: indexed.value,
  });
}

async function indexSets(
  outputs: readonly SetOutput[],
  report: DecodePassReport,
  total: number,
  from: number,
): Promise<Result<FrameFile[]>> {
  const files: FrameFile[] = [];
  for (const [i, output] of outputs.entries()) {
    const expected = pickedFrames({ every: output.set.every }, total).slice(0, output.set.maxFrames);
    const indexed = await indexFrameFile({
      set: output.set.set,
      path: output.path,
      format: output.set.format,
      width: output.target.width,
      height: output.target.height,
      frames: expected.slice(0, report.sets[i] ?? 0).map((index) => from + index),
    });
    if (!indexed.ok) return indexed;
    files.push(indexed.value);
  }
  return ok(files);
}
