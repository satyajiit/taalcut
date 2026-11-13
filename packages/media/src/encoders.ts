// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hardware and software encoder detection from `ffmpeg -encoders`. Listing an
 * encoder means it was compiled in, not that the hardware is present (a VM has
 * no VideoToolbox), so `selectWorkingEncoder` proves a pick with a trial encode.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import {
  failureGist,
  reportFallback,
  selectEncoder,
  type EncodeCodec,
  type EncoderChoice,
  type EncoderInfo,
  type EncoderSupport,
  type WorkingEncoderOptions,
} from './backends';
import { FfmpegFailed } from './errors';
import { ffmpegPrelude, mediaEnv, runFfmpeg, type MediaContext } from './ffmpeg';
import { machineVideoBackends } from './hw-video/machine';
import { backendOfEncoder, HW_VIDEO_BACKENDS, PLATFORM_HW_VIDEO } from './hw-video/table';
import type { HardwareBackend } from './hw-video/types';
import { runProcess } from './process/runner';
import { ffmpegEncoderName, SOFTWARE_VIDEOTOOLBOX_H264 } from './software-encoders';

export type { EncoderInfo, EncoderSupport, WorkingEncoderOptions };

const TYPES = { V: 'video', A: 'audio', S: 'subtitle' } as const;
const HARDWARE = /_(videotoolbox|nvenc|qsv|amf|mf|vaapi|v4l2m2m|vulkan|d3d12va)$/;

/** An encoder (by its FFmpeg name) that runs on a platform hardware API: its runs hold a video session. */
export const isHardwareEncoder = (name: string): boolean => HARDWARE.test(name);
/** ' V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)' */
const LINE = /^\s*([VAS])([A-Z.]{5})\s+(\S+)\s+(.*?)\s*$/;

export function parseEncoders(text: string): EncoderInfo[] {
  // The legend above the '------' line looks like encoder rows; skip it.
  const start = text.indexOf('------');
  if (start === -1) return [];
  const encoders: EncoderInfo[] = [];
  for (const line of text.slice(start + 6).split('\n')) {
    const match = LINE.exec(line);
    if (!match) continue;
    const [, type, flags = '', name = '', description = ''] = match;
    encoders.push({
      name,
      type: TYPES[type as keyof typeof TYPES],
      codec: /\(codec (\S+)\)$/.exec(description)?.[1] ?? name,
      description,
      experimental: flags.includes('X'),
      hardware: isHardwareEncoder(name),
    });
  }
  return encoders;
}

/** What a build has of each hardware row, and its best encoder per codec in `platform`'s row order. */
export function summariseEncoders(
  encoders: readonly EncoderInfo[],
  platform: NodeJS.Platform = process.platform,
): EncoderSupport {
  const has = (name: string) => encoders.some((e) => e.name === name);
  const first = (...names: string[]) => names.find(has);
  const hardware: Partial<Record<HardwareBackend, readonly string[]>> = {};
  for (const backend of Object.values(HW_VIDEO_BACKENDS)) {
    const names = Object.values(backend.encode?.encoders ?? {}).filter(has);
    if (names.length > 0) hardware[backend.id] = names;
  }
  // Every row the platform could use, slots aside, in its order.
  const rows = (PLATFORM_HW_VIDEO[platform] ?? []).filter((entry) => entry.use !== 'slot');
  const hardwareFor = (codec: 'h264' | 'hevc' | 'av1') =>
    rows.flatMap((entry) => HW_VIDEO_BACKENDS[entry.id].encode?.encoders[codec] ?? []);
  return {
    encoders,
    h264VideoToolbox: has('h264_videotoolbox'),
    hevcVideoToolbox: has('hevc_videotoolbox'),
    hardware,
    libopenh264: has('libopenh264'),
    preferredH264: first(...hardwareFor('h264'), 'libopenh264', 'libx264'),
    preferredHevc: first(...hardwareFor('hevc'), 'libx265'),
    preferredAv1: first(...hardwareFor('av1'), 'libsvtav1'),
  };
}

export async function detectEncoders(
  ctx: MediaContext,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): AsyncResult<EncoderSupport> {
  if (ctx.encoders) return ctx.encoders.detect(ctx, options);
  return detectEncodersUncached(ctx, options);
}

async function detectEncodersUncached(
  ctx: MediaContext,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): AsyncResult<EncoderSupport> {
  const args = ['-encoders'];
  const run = ctx.runner ?? runProcess;
  const result = await run(ctx.binaries.ffmpeg, [...ffmpegPrelude(args), ...args], {
    env: mediaEnv(ctx),
    timeoutMs: options.timeoutMs ?? 15_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    const exitCode = result.value.exitCode ?? -1;
    return err(FfmpegFailed({ exitCode }, { detail: `ffmpeg -encoders failed\n${result.value.stderrTail}` }));
  }
  const platform = ctx.platform ?? process.platform;
  return ok(summariseEncoders(parseEncoders(result.value.stdout.toString('utf8')), platform));
}

/** Ten frames of a test pattern through `encoder`, to prove it opens and encodes (its row's trial when it has one). */
export function trialEncodeArgs(encoder: string): string[] {
  const own = backendOfEncoder(encoder)?.encode?.trialArgs?.(encoder);
  if (own) return own;
  return [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=256x144:rate=30',
    '-frames:v',
    '10',
    '-c:v',
    ffmpegEncoderName(encoder),
    ...(encoder === SOFTWARE_VIDEOTOOLBOX_H264 ? ['-require_sw', '1'] : []),
    '-f',
    'null',
    '-',
  ];
}

/**
 * `selectEncoder` with proof: a listed hardware encoder is compiled in, not
 * necessarily usable (a macOS VM lists VideoToolbox and can't open it). Each
 * hardware pick runs a short trial encode; a failure is recorded against that
 * encoder and selection runs again, ending at the software fallback with
 * `hardware_failed` and FFmpeg's reason. A software pick is reported to
 * `ctx.onBackendFallback`.
 */
export async function selectWorkingEncoder(
  ctx: MediaContext,
  codec: EncodeCodec,
  options: WorkingEncoderOptions = {},
): AsyncResult<EncoderChoice> {
  if (ctx.encoders) return ctx.encoders.select(ctx, codec, options);
  return selectWorkingEncoderUncached(ctx, codec, options);
}

async function selectWorkingEncoderUncached(
  ctx: MediaContext,
  codec: EncodeCodec,
  options: WorkingEncoderOptions = {},
): AsyncResult<EncoderChoice> {
  const { support: given, signal, timeoutMs, ...select } = options;
  let support = given;
  if (!support) {
    const detected = await detectEncoders(ctx, { ...(signal ? { signal } : {}) });
    if (!detected.ok) return detected;
    support = detected.value;
  }
  const failed: Record<string, string> = { ...select.failed };
  const platform = select.platform ?? ctx.platform;
  let machine = select.machine;
  // A context that knows its machine (MediaService proves it) narrows the platform's rows; tests naming another
  // platform keep that platform's own.
  if (!machine && !select.software && !select.platform && ctx.videoBackends) {
    const proven = await machineVideoBackends(ctx, signal);
    if (!proven.ok) return proven;
    machine = proven.value;
  }
  for (;;) {
    const choice = selectEncoder(codec, support.encoders, {
      ...select,
      ...(platform ? { platform } : {}),
      ...(machine ? { machine } : {}),
      failed,
    });
    if (!choice.ok) return choice;
    const { encoder, fallbackReason } = choice.value;
    if (fallbackReason) {
      reportFallback(ctx.onBackendFallback, { operation: 'encode', subject: codec, reason: fallbackReason });
      return choice;
    }
    const trial = await runFfmpeg(ctx, trialEncodeArgs(encoder), {
      holdsVideoSession: isHardwareEncoder(encoder),
      timeoutMs: timeoutMs ?? 15_000,
      ...(signal ? { signal } : {}),
    });
    if (trial.ok) return choice;
    if (trial.error.code === 'media.cancelled') return trial;
    failed[encoder] = failureGist(trial.error.detail ?? trial.error.code);
  }
}

/**
 * Remembers `detectEncoders` and default `selectWorkingEncoder` answers for a
 * MediaService so proxy/conform runs do not re-spawn `ffmpeg -encoders` and a
 * trial encode on every clip. Failed or cancelled probes are not kept.
 */
export class EncoderSelection {
  private detected: AsyncResult<EncoderSupport> | undefined;
  private readonly choices = new Map<string, AsyncResult<EncoderChoice>>();

  detect(
    ctx: MediaContext,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): AsyncResult<EncoderSupport> {
    if (!this.detected) {
      const pending = detectEncodersUncached({ ...ctx, encoders: undefined }, options);
      this.detected = pending;
      void pending.then((res) => {
        if (!res.ok && this.detected === pending) this.detected = undefined;
      });
    }
    return this.detected;
  }

  async select(
    ctx: MediaContext,
    codec: EncodeCodec,
    options: WorkingEncoderOptions = {},
  ): AsyncResult<EncoderChoice> {
    if (options.software || options.failed || options.support) {
      return selectWorkingEncoderUncached({ ...ctx, encoders: this }, codec, options);
    }
    const key = `${codec}:${options.platform ?? ctx.platform ?? process.platform}`;
    let pending = this.choices.get(key);
    const fresh = !pending;
    if (!pending) {
      pending = selectWorkingEncoderUncached({ ...ctx, encoders: this }, codec, options);
      this.choices.set(key, pending);
      void pending.then((res) => {
        if (!res.ok && this.choices.get(key) === pending) this.choices.delete(key);
      });
    }
    const result = await pending;
    if (!fresh && result.ok && result.value.fallbackReason) {
      reportFallback(ctx.onBackendFallback, {
        operation: 'encode',
        subject: codec,
        reason: result.value.fallbackReason,
      });
    }
    return result;
  }
}
