// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frame sets through the decode service (IX2-G3): every frame of every set from one decoder session, where
 * FFmpeg starts one process and one VideoToolbox session per seek window. The service writes NV12 at each
 * set's size; one CPU FFmpeg converts it as FFmpeg's route converts its downloads (nv12-convert.ts), so the
 * frames are FFmpeg's own (`test/frame-sets/service-parity.test.ts`). The decode holds one hardware session
 * lease, as one FFmpeg seek would, until the service has let go of its session.
 *
 * Only what the service reads as FFmpeg does: the pictures the analysis pass's route takes (8-bit SDR H.264
 * or HEVC, VideoToolbox to NV12, the stream's own grid, not mirrored), every set scaled and raw (rgb24, gray8,
 * yuv420p; a JPEG's header carries the stream's sample aspect ratio, which the plan doesn't know). Anything else, a
 * failure, a reply that leaves out a frame asked for, a conversion or index that fails, or a file the service
 * can't read as FFmpeg does (eligible.ts `avoidsFile`), is `undefined`: the caller's FFmpeg seeks read it, and each
 * reason is logged once per process (IX2-F16). Nothing reaches the caller before the frames are indexed, so any
 * failure but a cancel or a timeout can go on to FFmpeg.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { err, ok, type Result, type TaalcutError } from '@taalcut/core';
import { avoidsFile, pictureDecline, streamRange } from '../decode-service/eligible';
import { tellOnce } from '../decode-service/tell-once';
import type { DecodeFramesReport, DecodeFramesSet, DecodeService } from '../decode-service/types';
import { MediaCancelled, MediaTimeout } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { targetSize, type GraphTarget } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import { helperCode } from '../sidecar/errors';
import {
  FRAME_SETS_TIMEOUT_MS,
  WINDOW_GAP_SECONDS,
  type DecodeFrameSetsOptions,
  type FrameSetRequest,
} from './frame-set-request';
import { indexFrameFile, removeFrameFiles, withoutFiles, type FrameFile } from './frame-files';
import { colourTags, nv12ConvertArgs, type Nv12Conversion } from './nv12-convert';
import { helperRequestHold } from '../hardware-sessions/helper-request';

/** Once per process and reason. */
const tell = tellOnce('frame sets');

interface SetPlan {
  readonly set: FrameSetRequest;
  readonly target: GraphTarget;
  readonly frames: readonly number[];
}

type Choice = { readonly use: readonly SetPlan[] } | { readonly decline: string };

/** Which sets the service reads, or why it reads none (then FFmpeg reads them all). */
function choose(
  path: string,
  plan: NormalisationPlan,
  service: DecodeService,
  sets: readonly FrameSetRequest[],
): Choice {
  const avoided = service.avoided(path);
  if (avoided !== undefined) return { decline: `avoided_${avoided}` };
  const picture = pictureDecline(plan);
  if (picture) return { decline: picture };
  const planned: SetPlan[] = [];
  for (const set of sets) {
    // A JPEG carries the frames' sample aspect ratio in its JFIF header: FFmpeg's route takes it from the stream
    // (the plan doesn't record it) and its scale adjusts it, so JPEG sets stay with FFmpeg's seeks.
    if (set.format === 'jpeg') return { decline: 'jpeg_set' };
    const target = targetSize(plan, set.size, undefined);
    if (!target) return { decline: 'unscaled_set' };
    const frames = [
      ...new Set(set.frames.filter((f) => Number.isInteger(f) && f >= 0 && f < plan.frames)),
    ].sort((a, b) => a - b);
    if (frames.length > 0) planned.push({ set, target, frames });
  }
  return planned.length > 0 ? { use: planned } : { decline: 'no_frames' };
}

export interface ServiceFrameSetsOptions extends DecodeFrameSetsOptions {
  readonly decodeService: DecodeService;
}

/**
 * The sets' frames through the service: the frame files (as `decodeFrameSets` returns them), a cancel or a
 * timeout as it is, or `undefined` when FFmpeg should read them instead.
 */
export async function serviceFrameSets(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: ServiceFrameSetsOptions,
): Promise<Result<FrameFile[]> | undefined> {
  const service = options.decodeService;
  const choice = choose(path, plan, service, options.sets);
  if ('decline' in choice) {
    tell(choice.decline, `${service.id} declined (${choice.decline}); FFmpeg seeks`);
    return undefined;
  }
  const nv12 = choice.use.map((use) => ({ ...use, path: join(options.dir, `${randomUUID()}.nv12`) }));
  const scratch = nv12.map((use) => use.path);
  const range = streamRange(plan);
  const rate = plan.frameRate.output;
  const sets: DecodeFramesSet[] = nv12.map((use) => ({ ...use.target, frames: use.frames, path: use.path }));
  const timeoutMs = options.timeoutMs ?? FRAME_SETS_TIMEOUT_MS;
  const signal = options.signal;
  const lease = ctx.hardwareSessions ? await ctx.hardwareSessions.acquire(1, signal) : undefined;
  if (lease && !lease.ok) return lease;
  const decoded = await service.frames(
    {
      path,
      rate: { num: rate.num, den: rate.den },
      rotation: plan.rotation,
      range,
      gapSeconds: options.windowGapSeconds ?? WINDOW_GAP_SECONDS,
      sets,
    },
    {
      timeoutMs,
      ...(signal ? { signal } : {}),
      // The helper's pid is on the lease's slot before the read is sent; the lease goes back only when the service
      // has let go of its session, as the analysis pass's (IX2-F4, IX3-F7).
      ...helperRequestHold(lease?.ok ? lease.value : undefined),
    },
  );
  if (!decoded.ok) return failed(path, service, decoded.error, scratch);
  const run = { timeoutMs, ...(signal ? { signal } : {}) };
  return filesOf(ctx, { path, service, plan, range, dir: options.dir, nv12, run }, decoded.value);
}

/**
 * The reply's frames as frame files, counted and logged as the service's read; undefined (FFmpeg seeks) when the
 * reply leaves out a frame asked for (a read that decoded no picture, past the stream's end: the set would be short)
 * or the NV12 won't convert or index (IX2-F16).
 */
async function filesOf(
  ctx: MediaContext,
  read: WrittenRead & { readonly path: string; readonly service: DecodeService },
  report: DecodeFramesReport,
): Promise<Result<FrameFile[]> | undefined> {
  const { path, service } = read;
  const left = leftOut(read.nv12, report.written);
  if (left > 0) {
    await removeFrameFiles(read.nv12.map((use) => use.path));
    tell('left_out', `${service.id} left out ${left} frames asked for; FFmpeg seeks`);
    return undefined;
  }
  const files = await convertAndIndex(ctx, read, report.written);
  if (!files.ok) {
    if (stops(files.error)) return files;
    tell(
      `convert_${files.error.code}`,
      `${service.id}'s frames didn't convert (${files.error.code}); FFmpeg seeks`,
    );
    return undefined;
  }
  ctx.decodeTally?.recordDecode('partial', path);
  tell('used', `reading with ${service.id} (${report.reads} reads, ${report.ms} ms)`);
  return files;
}

/** A cancel or a timeout: the caller's, returned as it is; anything else goes on to FFmpeg. */
const stops = (error: TaalcutError) => MediaCancelled.is(error) || MediaTimeout.is(error);

/** A service failure: its scratch removed; a file it can't read as FFmpeg does is left to FFmpeg from then on. */
async function failed(
  path: string,
  service: DecodeService,
  error: TaalcutError,
  scratch: readonly string[],
): Promise<Result<FrameFile[]> | undefined> {
  await removeFrameFiles(scratch);
  if (stops(error)) return err(error);
  const code = helperCode(error);
  if (avoidsFile(code)) service.avoid(path, code);
  tell(`failed_${code}`, `${service.id} failed (${code}); FFmpeg seeks`);
  return undefined;
}

/** How many frames asked for the service's reply doesn't list as written. */
function leftOut(nv12: readonly SetPlan[], written: readonly (readonly number[])[]): number {
  return nv12.reduce((sum, use, i) => {
    const wrote = new Set(written[i] ?? []);
    return sum + use.frames.filter((frame) => !wrote.has(frame)).length;
  }, 0);
}

/** A service read whose NV12 the service has written: what the CPU conversion needs. */
interface WrittenRead {
  readonly plan: NormalisationPlan;
  readonly range: 'full' | 'video';
  readonly dir: string;
  readonly nv12: readonly (SetPlan & { readonly path: string })[];
  readonly run: { readonly signal?: AbortSignal; readonly timeoutMs: number };
}

/** Every set's NV12 converted in one CPU FFmpeg run, the NV12 removed, and the frames written indexed. */
async function convertAndIndex(
  ctx: MediaContext,
  read: WrittenRead,
  written: readonly (readonly number[])[],
): Promise<Result<FrameFile[]>> {
  const conversions: (Nv12Conversion & { readonly use: SetPlan; readonly frames: readonly number[] })[] =
    read.nv12
      .map((use, i) => ({
        input: { path: use.path, ...use.target },
        format: use.set.format,
        ...(use.set.jpegQuality !== undefined ? { jpegQuality: use.set.jpegQuality } : {}),
        output: join(read.dir, `${randomUUID()}.${use.set.format === 'jpeg' ? 'mjpeg' : 'raw'}`),
        use,
        frames: written[i] ?? [],
      }))
      .filter((conversion) => conversion.frames.length > 0);
  const outputs = conversions.map((conversion) => conversion.output);
  const converted =
    conversions.length > 0
      ? await runFfmpegRaw(ctx, nv12ConvertArgs(conversions, colourTags(read.plan, read.range)), {
          ...read.run,
          // Raw NV12 frames the helper already decoded, converted on the CPU: no video session.
          holdsVideoSession: false,
        })
      : ok(undefined);
  await removeFrameFiles(read.nv12.map((use) => use.path));
  if (!converted.ok) return withoutFiles(outputs, converted);
  const files: FrameFile[] = [];
  for (const conversion of conversions) {
    const indexed = await indexFrameFile({
      set: conversion.use.set.set,
      path: conversion.output,
      format: conversion.format,
      width: conversion.input.width,
      height: conversion.input.height,
      frames: conversion.frames,
    });
    if (!indexed.ok) return withoutFiles(outputs, indexed);
    files.push(indexed.value);
  }
  return ok(files);
}
