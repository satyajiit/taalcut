// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Extracts one frame as a JPEG or PNG buffer, for `vision.describeFrame`
 * (P1-G7) and thumbnails. Rotation follows the display matrix, so an iPhone
 * portrait clip comes out upright; scaling runs after rotation, so
 * `maxDimension` bounds the frame as displayed.
 *
 * GPU first (ADR 0002): the probe decides whether the machine's hardware row
 * (VideoToolbox, NVDEC) can take the stream (`planDecode`). If the hardware
 * fails when run (an M1 given AV1, a VM without a GPU), the frame is decoded once more in software, and the
 * result says so with the reason. Every frame decoded in software is
 * reported to `ctx.onBackendFallback`.
 *
 * HDR sources (HLG, PQ, Dolby Vision, as iPhones record) are tone-mapped to
 * SDR bt709 so a vision model doesn't get a washed-out frame: libplacebo
 * `bt.2446a` on Vulkan after the VideoToolbox decode, or zscale + hable on the
 * CPU when Vulkan can't start (`selectToneMap`, spike 07). The result names
 * the tone-map used.
 *
 * Known gap: on the VideoToolbox route a mirrored display matrix is not
 * applied (the probe reports rotation only).
 */
import { err, ok, ValidationError, type AsyncResult } from '@taalcut/core';
import { failureGist, planDecode, reportFallback, type FallbackReason, type MediaBackend } from '../backends';
import { hwDecoder } from '../hw-video/filters';
import { machineVideoBackends } from '../hw-video/machine';
import { DecodeFailed, fileParams, type FileParams } from '../errors';
import { ffmpegPrelude, mediaEnv, type MediaContext } from '../ffmpeg';
import { selectToneMap, toneMapFilters, type ToneMapChoice } from '../tonemap';
import { requireFile } from '../input';
import { probeMedia } from '../probe/probe';
import type { ProbeResult } from '../probe/types';
import { FFMPEG_STOP } from '../process/end-policy';
import { runProcess, type ProcessOutput } from '../process/runner';
import { decodeHoldsVideoSession } from '../decode-routes/video-session';
import { isValidTime, toMicroseconds } from '../rational';
import type { RationalTime } from '../rational-time';
import { frameArgs, seekArg, type FrameOutput, type FrameRoute } from './frame-args';
import { imageSize } from './image-size';

export type { FrameFormat } from './frame-args';

export interface ExtractFrameOptions extends FrameOutput {
  readonly signal?: AbortSignal;
  /** Per ffmpeg run (a hardware failure means a second run). Default 60 s. */
  readonly timeoutMs?: number;
  /** Largest image accepted on stdout. Default 32 MiB. */
  readonly maxBytes?: number;
  /** The file's probe, when the caller already has it; saves an ffprobe run. */
  readonly probe?: ProbeResult;
  /** 'software' skips the hardware decoder (diagnostics, tests). Default 'auto': GPU first. */
  readonly decode?: 'auto' | 'software';
  /** HDR sources: 'software' uses the CPU tone-map (diagnostics, tests). Default 'auto': GPU first. */
  readonly toneMap?: 'auto' | 'software';
}

export interface ExtractedFrame {
  readonly data: Buffer;
  readonly mimeType: 'image/jpeg' | 'image/png';
  /** Size of the image as encoded (after rotation and scaling). */
  readonly width: number;
  readonly height: number;
  /** The requested time. */
  readonly at: RationalTime;
  /** Where it was decoded: a hardware row, or the CPU. */
  readonly backend: MediaBackend;
  /** Why software, when it was. */
  readonly fallbackReason?: FallbackReason;
  /** For an HDR source: how it was mapped to SDR. */
  readonly toneMap?: ToneMapChoice;
}

export const DEFAULT_FRAME_TIMEOUT_MS = 60_000;

function validate(at: RationalTime, options: ExtractFrameOptions): string | undefined {
  if (!isValidTime(at) || at.value < 0) return 'at';
  const { maxDimension, jpegQuality } = options;
  if (maxDimension !== undefined && (!Number.isInteger(maxDimension) || maxDimension < 2))
    return 'maxDimension';
  if (jpegQuality !== undefined && (!Number.isInteger(jpegQuality) || jpegQuality < 2 || jpegQuality > 31)) {
    return 'jpegQuality';
  }
  return undefined;
}

async function probeFor(path: string, file: FileParams, ctx: MediaContext, options: ExtractFrameOptions) {
  if (options.probe) return ok(options.probe);
  const probed = await probeMedia(path, ctx, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (probed.ok || probed.error.code !== 'media.probe_failed') return probed;
  // Not readable as media: for a frame request that is a decode failure, with ffprobe's reason.
  return err(DecodeFailed(file, { detail: probed.error.detail ?? path }));
}

export async function extractFrame(
  path: string,
  at: RationalTime,
  ctx: MediaContext,
  options: ExtractFrameOptions = {},
): AsyncResult<ExtractedFrame> {
  const invalid = validate(at, options);
  if (invalid)
    return err(
      ValidationError({ field: invalid }, { detail: JSON.stringify({ at, ...options, probe: undefined }) }),
    );
  const checked = await requireFile(path);
  if (!checked.ok) return checked;
  const file = fileParams(checked.value);
  const probe = await probeFor(checked.value, file, ctx, options);
  if (!probe.ok) return probe;
  const video = probe.value.video;
  if (!video) return err(DecodeFailed(file, { detail: `${checked.value}: no video stream` }));
  // Known past the end: say so without running FFmpeg twice (both routes would only find nothing).
  const end = video.duration ?? probe.value.duration;
  if (end && toMicroseconds(at) >= toMicroseconds(end)) {
    const detail = `${checked.value}: no frame at ${seekArg(at)} s: the video ends at ${seekArg(end)} s`;
    return err(DecodeFailed(file, { detail }));
  }

  let toneMap: ToneMapChoice | undefined;
  if (video.isHdr) {
    const toneOptions = {
      software: options.toneMap === 'software',
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const selected = await (ctx.toneMaps
      ? ctx.toneMaps.get(ctx, toneOptions)
      : selectToneMap(ctx, toneOptions));
    if (!selected.ok) return selected;
    toneMap = selected.value;
  }
  const toneFilters = toneMap ? toneMapFilters(toneMap, video) : [];

  const run = (route: FrameRoute) => {
    const args = frameArgs(checked.value, at, options, route, toneFilters);
    // A VideoToolbox read may hold a decoder session: never killed, asked with its q (IX3-K2).
    const holdsVideoSession = decodeHoldsVideoSession(route);
    const prelude = ffmpegPrelude(args, undefined, { readsQuit: holdsVideoSession });
    return (ctx.runner ?? runProcess)(ctx.binaries.ffmpeg, [...prelude, ...args], {
      env: mediaEnv(ctx),
      holdsVideoSession,
      program: FFMPEG_STOP,
      timeoutMs: options.timeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS,
      maxStdoutBytes: options.maxBytes ?? 32 * 1024 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  };
  const finish = (output: ProcessOutput, backend: MediaBackend, reason?: FallbackReason) => {
    const { exitCode, stdout, stderrTail } = output;
    if (exitCode !== 0 || stdout.length === 0) {
      const why =
        exitCode !== 0
          ? `ffmpeg exited with code ${String(exitCode)}`
          : 'no frame decoded (time past the end?)';
      const label = plan.backend === 'software' ? 'The hardware decoder' : hwDecoder(plan.backend).label;
      const before = reason?.code === 'hardware_failed' ? `\n${label} failed first: ${reason.detail}` : '';
      const detail = `${checked.value}: ${why} at ${seekArg(at)} s\n${stderrTail}`.trimEnd() + before;
      return err(DecodeFailed(file, { detail }));
    }
    const size = imageSize(stdout);
    if (!size) {
      return err(
        DecodeFailed(file, { detail: `${checked.value}: ffmpeg output is not a readable PNG or JPEG` }),
      );
    }
    const mimeType = options.format === 'png' ? ('image/png' as const) : ('image/jpeg' as const);
    const frame: ExtractedFrame = {
      data: stdout,
      mimeType,
      width: size.width,
      height: size.height,
      at,
      backend,
      ...(reason ? { fallbackReason: reason } : {}),
      ...(toneMap ? { toneMap } : {}),
    };
    return ok(frame);
  };

  const machine =
    ctx.videoBackends && options.decode !== 'software'
      ? await machineVideoBackends(ctx, options.signal)
      : undefined;
  if (machine && !machine.ok) return machine;
  const plan = planDecode(video, {
    ...(ctx.platform ? { platform: ctx.platform } : {}),
    ...(options.decode ? { decode: options.decode } : {}),
    ...(ctx.hardwareFailures ? { failures: ctx.hardwareFailures } : {}),
    ...(machine ? { machine: machine.value } : {}),
  });
  let reason: FallbackReason;
  if (plan.backend !== 'software') {
    const displaySize = { width: video.displayWidth, height: video.displayHeight };
    const hardware = await run({
      backend: plan.backend,
      surfaceFormat: plan.surfaceFormat,
      rotation: video.rotation,
      ...(displaySize.width > 0 && displaySize.height > 0 ? { displaySize } : {}),
    });
    // Cancelled, timed out or too large: not the hardware's fault, and not worth a second run.
    if (!hardware.ok) return hardware;
    // Exit 0 with no frame is a time past the end, which software would not change.
    if (hardware.value.exitCode === 0) return finish(hardware.value, plan.backend);
    reason = { code: 'hardware_failed', detail: failureGist(hardware.value.stderrTail) };
  } else {
    reason = plan.fallbackReason;
  }
  const software = await run({ backend: 'software' });
  if (!software.ok) return software;
  const frame = finish(software.value, 'software', reason);
  // Only a frame the CPU produced is a fallback. When software fails too the file is at fault,
  // so nothing is reported and the format is not marked as one the hardware can't do.
  if (!frame.ok) return frame;
  if (plan.backend !== 'software') ctx.hardwareFailures?.remember(video, reason);
  reportFallback(ctx.onBackendFallback, { operation: 'decode', subject: file.name, reason });
  return frame;
}
