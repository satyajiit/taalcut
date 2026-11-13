// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One ffprobe run whose stdout is the answer (packet lists, stream fields): a demux, no decode. */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { runProcess } from '../process/runner';

export async function runFfprobe(
  ctx: MediaContext,
  args: readonly string[],
  signal?: AbortSignal,
): AsyncResult<string> {
  const run = ctx.runner ?? runProcess;
  const result = await run(ctx.binaries.ffprobe, ['-v', 'error', ...args], {
    ...(signal ? { signal } : {}),
    timeoutMs: 120_000,
  });
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    return err(
      FfmpegFailed({ exitCode: result.value.exitCode ?? -1 }, { detail: result.value.stderrTail.trim() }),
    );
  }
  return ok(result.value.stdout.toString('utf8'));
}
