// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EBU R128 integrated loudness, range and true peak from one audio decode. */
import { RationalTime, err, ok, type AsyncResult } from '@taalcut/core';
import { reportAnalysisFilters } from '../compute-report';
import { FfmpegFailed } from '../errors';
import type { MediaContext } from '../ffmpeg';
import type { GraphRange } from '../normalise/graph';
import { runFfmpegRaw } from '../run-raw';
import { parseEbur128, type LoudnessReading } from './parsers';

export interface LoudnessOptions {
  readonly range?: GraphRange;
  readonly signal?: AbortSignal;
}

export async function measureLoudness(
  path: string,
  ctx: MediaContext,
  options: LoudnessOptions = {},
): AsyncResult<LoudnessReading> {
  reportAnalysisFilters(ctx);
  const args = ['-y', '-loglevel', 'info'];
  if (options.range) args.push('-ss', RationalTime.toSeconds(options.range.start).toFixed(6));
  args.push('-i', path, '-map', '0:a:0', '-af', 'ebur128=peak=true');
  if (options.range?.duration) args.push('-t', RationalTime.toSeconds(options.range.duration).toFixed(6));
  args.push('-f', 'null', '-');
  const log: Buffer[] = [];
  const encoded = await runFfmpegRaw(ctx, args, {
    // Sound only: no video session.
    holdsVideoSession: false,
    onStderr: (chunk) => log.push(chunk),
    timeoutMs: 180_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!encoded.ok) return encoded;
  const reading = parseEbur128(Buffer.concat(log).toString('utf8'));
  if (!reading) return err(FfmpegFailed({ exitCode: -1 }, { detail: 'ebur128 summary missing' }));
  return ok(reading);
}
