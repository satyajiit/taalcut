// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Per-frame SSIM or PSNR of two pictures on one grid. Stats go to a temp file. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { reportAnalysisFilters } from '../compute-report';
import { FfmpegFailed } from '../errors';
import { runFfmpeg, type MediaContext } from '../ffmpeg';
import { parseSsim } from './parsers';

export interface CompareOptions {
  readonly metric: 'ssim' | 'psnr';
  readonly signal?: AbortSignal;
}

export interface CompareResult {
  readonly frames: readonly { readonly index: number; readonly value: number }[];
  readonly mean: number;
}

function parsePsnr(stats: string): CompareResult {
  const frames: { index: number; value: number }[] = [];
  const pattern = /n:(\d+).*?psnr_avg:([-+0-9.eE]+)/g;
  for (const match of stats.matchAll(pattern)) {
    frames.push({ index: Number(match[1]), value: Number(match[2]) });
  }
  const mean = frames.length === 0 ? 0 : frames.reduce((sum, frame) => sum + frame.value, 0) / frames.length;
  return { frames, mean };
}

export async function compareFrames(
  a: string,
  b: string,
  ctx: MediaContext,
  options: CompareOptions,
): AsyncResult<CompareResult> {
  reportAnalysisFilters(ctx);
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-metric-'));
  const stats = join(dir, 'stats.txt');
  try {
    const encoded = await runFfmpeg(
      ctx,
      ['-y', '-i', a, '-i', b, '-lavfi', `${options.metric}=stats_file=${stats}`, '-f', 'null', '-'],
      // Both files decode in software (no -hwaccel): no video session.
      {
        holdsVideoSession: false,
        timeoutMs: 180_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    if (!encoded.ok) return encoded;
    const text = await readFile(stats, 'utf8').catch(() => '');
    if (options.metric === 'psnr') return ok(parsePsnr(text));
    const parsed = parseSsim(text, encoded.value.stderrTail);
    return ok({ frames: parsed.frames.map((frame) => ({ index: frame.index, value: frame.all })), mean: parsed.mean });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'metric failed';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
