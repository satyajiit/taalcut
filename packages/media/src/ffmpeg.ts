// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs ffmpeg with Taalcut's standard flags, optional progress events, and
 * exit codes mapped to `media.ffmpeg_failed`.
 */
import { err, ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import type {
  BackendChoice,
  BackendFallbackListener,
  EncodeCodec,
  EncoderChoice,
  EncoderSupport,
  HardwareFailures,
  ToneMapChoice,
  ToneMapOptions,
  WorkingEncoderOptions,
} from './backends';
import type { FfmpegBinaries } from './binaries/resolver';
import type { MachineVideoBackends } from './hw-video/types';
import { FfmpegFailed } from './errors';
import type { HardwareSessionGate } from './hardware-sessions/types';
import { sidecarEnv } from './process/child-group';
import { FFMPEG_STOP } from './process/end-policy';
import { runProcess, type ProcessOutput, type ProcessRunner, type RunOptions } from './process/runner';
import { ProgressParser, throttleProgress, type ProgressListener } from './progress';
import type { RationalTime } from './rational-time';

/** What every media function needs: the binaries, and optionally a runner to swap in tests. */
export interface MediaContext {
  readonly binaries: FfmpegBinaries;
  readonly runner?: ProcessRunner;
  /** Every software fallback (ADR 0002), for the trace and counters. Without one they are logged. */
  readonly onBackendFallback?: BackendFallbackListener;
  /** core `compute.fallback` payloads. Phase 2 CPU choices emit one. */
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  /** Hardware failures seen so far, so they are paid for once. MediaService keeps one. */
  readonly hardwareFailures?: HardwareFailures;
  /** Default `process.platform`; tests set it to exercise another platform's selection. */
  readonly platform?: NodeJS.Platform;
  /** The tone-map choice, proven once and remembered (MediaService keeps a ToneMapSelection). */
  readonly toneMaps?: ToneMapCache;
  /** Encoder listing and proven working encoders, remembered across runs (MediaService keeps an EncoderSelection). */
  readonly encoders?: EncoderCache;
  /**
   * The app-wide cap on hardware video sessions. `runner` applies it to every FFmpeg call
   * (`hardwareSessionContext` sets both); work that spawns FFmpeg another way (render's producer) holds a lease itself.
   */
  readonly hardwareSessions?: HardwareSessionGate;
  /** The job's decode count (`countedContext`): decodes that spawn no FFmpeg (the decode service's) count here. */
  readonly decodeTally?: DecodeRecorder;
  /**
   * The hardware video rows this machine can use, proven once (MediaService keeps a VideoBackendSelection). Without
   * one, plans use the platform's default rows and a machine without them falls back when FFmpeg runs.
   */
  readonly videoBackends?: VideoBackendSource;
}

/** The machine's hardware video rows, proven and remembered; `VideoBackendSelection` in hw-video/machine.ts. */
export interface VideoBackendSource {
  get(ctx: MediaContext, signal?: AbortSignal): AsyncResult<MachineVideoBackends>;
}

/** Counts decodes that spawn no FFmpeg (decode-count/tally.ts implements it). */
export interface DecodeRecorder {
  /** A decode of the whole stream, or part of it, of `input`. */
  recordDecode(decode: 'full' | 'partial', input: string): void;
}

/** Remembers one tone-map choice; `ToneMapSelection` in tonemap.ts. */
export interface ToneMapCache {
  get(ctx: MediaContext, options?: ToneMapOptions): AsyncResult<ToneMapChoice>;
}

/** Remembers encoder detection and trial results; `EncoderSelection` in encoders.ts. */
export interface EncoderCache {
  detect(ctx: MediaContext, options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }): AsyncResult<EncoderSupport>;
  select(ctx: MediaContext, codec: EncodeCodec, options?: WorkingEncoderOptions): AsyncResult<EncoderChoice>;
}

/** The environment every process of a media context gets: `sidecarEnv()` plus the bundled Vulkan driver. */
export function mediaEnv(ctx: Pick<MediaContext, 'binaries'>): Record<string, string> {
  const vulkanIcd = ctx.binaries.vulkanIcd;
  return sidecarEnv(process.env, vulkanIcd ? { vulkanIcd } : {});
}

export interface FfmpegRunOptions extends Omit<RunOptions, 'onStdout' | 'program'> {
  /** Adds `-progress pipe:1 -nostats` and reports parsed, throttled progress. Must not throw. */
  readonly onProgress?: ProgressListener;
  /** The backend these arguments use (from `selectEncoder` or `planDecode`), stamped on every progress event. */
  readonly backend?: BackendChoice;
  /** Expected output duration, for `percent`. */
  readonly duration?: RationalTime;
  /** Minimum time between progress events (the final event always comes). Default 500 ms. */
  readonly progressIntervalMs?: number;
}

export const DEFAULT_PROGRESS_INTERVAL_MS = 500;

export interface PreludeOptions {
  /**
   * FFmpeg reads stdin for its `q` (no `-nostdin`): a run that may hold a hardware video session is asked to
   * finish that way before any signal (process/end-policy.ts). Default false.
   */
  readonly readsQuit?: boolean;
}

/** The flags put in front of every ffmpeg command. */
export function ffmpegPrelude(
  args: readonly string[],
  progressIntervalMs?: number,
  options: PreludeOptions = {},
): string[] {
  const prelude = options.readsQuit === true ? ['-hide_banner'] : ['-hide_banner', '-nostdin'];
  if (!args.includes('-v') && !args.includes('-loglevel')) prelude.push('-loglevel', 'error');
  if (progressIntervalMs === undefined) {
    prelude.push('-nostats');
  } else {
    // FFmpeg rejects a stats period of zero; 50 ms is already more than a UI can use.
    const seconds = Math.max(progressIntervalMs, 50) / 1000;
    prelude.push('-progress', 'pipe:1', '-nostats', '-stats_period', String(seconds));
  }
  return prelude;
}

/**
 * Whether an FFmpeg run may hold a hardware video session: what its site declared, and when it declared
 * nothing, yes. FFmpeg opens VideoToolbox whenever its arguments ask for it, so a site that doesn't say is never
 * killed (IX3-K2): the safe side of the end policy. A CPU-only site declares `holdsVideoSession: false` and keeps
 * the SIGTERM-then-SIGKILL escalation.
 */
export const ffmpegHoldsVideoSession = (declared: boolean | undefined): boolean => declared ?? true;

/**
 * Runs `ffmpeg <prelude> <args>`. A non-zero exit becomes `media.ffmpeg_failed`
 * with the stderr tail in `detail`; cancellation, timeouts and a missing binary
 * come from the runner. With `onProgress`, stdout carries progress, so write
 * the real output to a file.
 */
export async function runFfmpeg(
  ctx: MediaContext,
  args: readonly string[],
  options: FfmpegRunOptions = {},
): AsyncResult<ProcessOutput> {
  const { onProgress, duration, progressIntervalMs, backend, ...runOptions } = options;
  const run = ctx.runner ?? runProcess;
  const interval = progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  let onStdout: ((chunk: Buffer) => void) | undefined;

  if (onProgress) {
    const parser = new ProgressParser(duration);
    const emit = throttleProgress(onProgress, interval);
    const stamp = backend
      ? {
          backend: backend.backend,
          ...(backend.fallbackReason ? { fallbackReason: backend.fallbackReason } : {}),
        }
      : {};
    onStdout = (chunk) => {
      for (const event of parser.push(chunk)) {
        try {
          emit({ ...event, ...stamp });
        } catch (cause) {
          // A throwing listener is a bug in the caller; keep it from crashing the process host.
          console.error('[media] progress listener threw', cause);
        }
      }
    };
  }

  const holdsVideoSession = ffmpegHoldsVideoSession(runOptions.holdsVideoSession);
  const prelude = ffmpegPrelude(args, onProgress ? interval : undefined, { readsQuit: holdsVideoSession });
  const result = await run(ctx.binaries.ffmpeg, [...prelude, ...args], {
    env: mediaEnv(ctx),
    ...runOptions,
    holdsVideoSession,
    program: FFMPEG_STOP,
    ...(onStdout ? { onStdout } : {}),
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    const exitCode = result.value.exitCode ?? -1;
    const detail = `ffmpeg exited with code ${exitCode}\n${result.value.stderrTail}`;
    return err(FfmpegFailed({ exitCode }, { detail: detail.trimEnd() }));
  }
  return ok(result.value);
}
