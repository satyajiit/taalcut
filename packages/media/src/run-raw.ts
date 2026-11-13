// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ffmpeg when stdout must be streamed (raw frames, PCM). `runFfmpeg` omits
 * `onStdout` because it uses that pipe for progress.
 */
import { err, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed } from './errors';
import { ffmpegHoldsVideoSession, ffmpegPrelude, mediaEnv, type MediaContext } from './ffmpeg';
import { FFMPEG_STOP } from './process/end-policy';
import { runProcess, type ProcessOutput, type ProcessRunner } from './process/runner';

export interface RawRunOptions {
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Whether the run may hold a hardware video session (`ffmpegHoldsVideoSession`: undeclared means yes). */
  readonly holdsVideoSession?: boolean;
}

export async function runFfmpegRaw(
  ctx: MediaContext,
  args: readonly string[],
  options: RawRunOptions = {},
): AsyncResult<ProcessOutput> {
  const run: ProcessRunner = ctx.runner ?? runProcess;
  const holdsVideoSession = ffmpegHoldsVideoSession(options.holdsVideoSession);
  const prelude = ffmpegPrelude(args, undefined, { readsQuit: holdsVideoSession });
  const result = await run(ctx.binaries.ffmpeg, [...prelude, ...args], {
    env: mediaEnv(ctx),
    holdsVideoSession,
    program: FFMPEG_STOP,
    ...(options.onStdout ? { onStdout: options.onStdout } : {}),
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    const exitCode = result.value.exitCode ?? -1;
    return err(FfmpegFailed({ exitCode }, { detail: result.value.stderrTail.trim() }));
  }
  return result;
}
