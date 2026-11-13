// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2: what an FFmpeg run tells the runner about its end. An FFmpeg run whose site declares nothing may hold
 * a video session (the safe side): it keeps stdin for `q` (no `-nostdin`) and is never killed. A site that
 * declares `holdsVideoSession: false` gets `-nostdin` and the old escalation. No FFmpeg runs here.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  FFMPEG_STOP,
  runFfmpeg,
  type MediaContext,
  type ProcessRunner,
  type RunOptions,
} from '@taalcut/media';
import { runFfmpegRaw } from '../../src/run-raw';

function recording(): { ctx: MediaContext; calls: { args: readonly string[]; options: RunOptions }[] } {
  const calls: { args: readonly string[]; options: RunOptions }[] = [];
  const runner: ProcessRunner = (_command, args, options = {}) => {
    calls.push({ args, options });
    return Promise.resolve(
      ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 }),
    );
  };
  return { ctx: { binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' }, runner }, calls };
}

describe('an FFmpeg run declares its end', () => {
  it.each([
    [
      'runFfmpeg',
      (ctx: MediaContext, holds?: boolean) =>
        runFfmpeg(ctx, ['-i', 'a.mov', 'b.mp4'], holds === undefined ? {} : { holdsVideoSession: holds }),
    ],
    [
      'runFfmpegRaw',
      (ctx: MediaContext, holds?: boolean) =>
        runFfmpegRaw(ctx, ['-i', 'a.mov', 'pipe:1'], holds === undefined ? {} : { holdsVideoSession: holds }),
    ],
  ])('%s: undeclared and declared runs', async (_name, run) => {
    const { ctx, calls } = recording();
    await run(ctx);
    await run(ctx, true);
    await run(ctx, false);
    const [undeclared, holds, cpu] = calls;
    for (const call of [undeclared, holds]) {
      expect(call?.args).not.toContain('-nostdin');
      expect(call?.options).toMatchObject({ holdsVideoSession: true, program: FFMPEG_STOP });
    }
    expect(cpu?.args.slice(0, 2)).toEqual(['-hide_banner', '-nostdin']);
    expect(cpu?.options).toMatchObject({ holdsVideoSession: false });
  });
});
