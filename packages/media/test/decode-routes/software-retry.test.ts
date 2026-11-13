// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F6: a job whose hardware decoder wouldn't start runs once more on the software route, reported; any other
 * failure, a job that already handed frames out, and a second failure are returned as they are.
 */
import { err, ok, type ComputeFallbackEvent, type Result } from '@taalcut/core';
import { FfmpegFailed, hardwareWontStart, retryOnSoftware, type NormalisationPlan } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { onDecodeRoute, retryStreaming } from '../../src/decode-routes/software-retry';
import { videoPlan } from '../helpers/video-plan';

const SETUP_LINE =
  '[mpeg4 @ 0xc1b84ca80] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error.';
const wontStart = FfmpegFailed(
  { exitCode: 1 },
  {
    detail: `ffmpeg exited with code 1\n${SETUP_LINE}\nImpossible to convert between the formats supported by the filter 'Parsed_split_3' and the filter 'auto_scale_0'`,
  },
);
const otherFailure = FfmpegFailed(
  { exitCode: 1 },
  { detail: 'ffmpeg exited with code 1\nmoov atom not found' },
);

/** A job that answers each run from `answers` in turn, recording the decode it was given. */
function job(answers: readonly Result<string>[]) {
  const decodes: NormalisationPlan['decode'][] = [];
  const run = async (plan: NormalisationPlan) => {
    decodes.push(plan.decode);
    return answers[decodes.length - 1] ?? ok('more runs than answers');
  };
  return { run, decodes };
}

describe('hardwareWontStart', () => {
  it('reads the hwaccel line FFmpeg prints for any hardware decoder, and nothing else', () => {
    expect(hardwareWontStart(wontStart)).toBe(
      'the videotoolbox_vld decoder would not start (hwaccel initialisation)',
    );
    const cuda = FfmpegFailed(
      { exitCode: 1 },
      { detail: '[h264 @ 0x1] Failed setup for format cuda: hwaccel initialisation returned error.' },
    );
    expect(hardwareWontStart(cuda)).toMatch(/^the cuda decoder/);
    expect(hardwareWontStart(otherFailure)).toBeUndefined();
  });
});

describe('retryOnSoftware', () => {
  const plan = videoPlan({}, false, 'darwin');

  it('runs the job again on the software route and reports the fallback', async () => {
    const events: ComputeFallbackEvent[] = [];
    const { run, decodes } = job([err(wontStart), ok('frames')]);
    const result = await retryOnSoftware(plan, { onComputeFallback: (event) => events.push(event) }, run);
    expect(result).toEqual(ok('frames'));
    expect(decodes.map((decode) => decode.backend)).toEqual(['videotoolbox', 'software']);
    expect(decodes[1]).toMatchObject({
      fallbackReason: { code: 'hardware_failed', detail: expect.stringContaining('videotoolbox_vld') },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'media.decode', reason: 'accelerator_failed' });
  });

  it('returns any other failure, a run that handed frames out and a second failure as they are', async () => {
    const quiet = { onComputeFallback: () => {} };
    const other = job([err(otherFailure)]);
    expect(await retryOnSoftware(plan, quiet, other.run)).toEqual(err(otherFailure));
    expect(other.decodes).toHaveLength(1);
    const streamed = job([err(wontStart)]);
    expect(await retryOnSoftware(plan, quiet, streamed.run, { untouched: () => false })).toEqual(
      err(wontStart),
    );
    expect(streamed.decodes).toHaveLength(1);
    const twice = job([err(wontStart), err(otherFailure)]);
    expect(await retryOnSoftware(plan, quiet, twice.run)).toEqual(err(otherFailure));
    expect(twice.decodes).toHaveLength(2);
  });

  it('takes a wider reason when the caller gives one (conform: any FFmpeg failure on VideoToolbox)', async () => {
    const { run, decodes } = job([err(otherFailure), ok('encoded')]);
    const why = (error: { readonly code: string }) =>
      error.code === 'media.ffmpeg_failed' ? 'any' : undefined;
    expect(await retryOnSoftware(plan, { onComputeFallback: () => {} }, run, { why })).toEqual(ok('encoded'));
    expect(decodes.map((decode) => decode.backend)).toEqual(['videotoolbox', 'software']);
  });
});

describe('retryStreaming', () => {
  const plan = videoPlan({}, false, 'darwin');
  const quiet = { onComputeFallback: () => {} };

  it('runs again when nothing went out, and not once something did', async () => {
    const seen: number[] = [];
    const answers = [err(wontStart), ok('frames')];
    let runs = 0;
    const result = await retryStreaming(plan, quiet, async (_onRoute, counted) => {
      runs += 1;
      const hand = counted((frame: number) => void seen.push(frame));
      if (runs === 2) hand(1);
      return answers[runs - 1] ?? ok('more runs than answers');
    });
    expect(result).toEqual(ok('frames'));
    expect(seen).toEqual([1]);

    let after = 0;
    const handedOut = await retryStreaming(plan, quiet, async (_onRoute, counted) => {
      after += 1;
      counted(
        (batch: { count: number }) => batch.count,
        (batch) => batch.count,
      )({ count: 3 });
      return err(wontStart);
    });
    expect(handedOut).toEqual(err(wontStart));
    expect(after).toBe(1);
  });
});

describe('onDecodeRoute', () => {
  it('reports the route, runs the job with the tone map, and once more on the software route', async () => {
    const plan = videoPlan({}, false, 'darwin');
    const events: ComputeFallbackEvent[] = [];
    const ctx = {
      binaries: { ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe', source: 'env' as const },
      onComputeFallback: (event: ComputeFallbackEvent) => events.push(event),
    };
    const runs: { backend: string; tone: string }[] = [];
    const result = await onDecodeRoute(plan, ctx, undefined, async (onRoute, toneMap) => {
      runs.push({ backend: onRoute.decode.backend, tone: toneMap.method });
      return runs.length === 1 ? err(wontStart) : ok('frames');
    });
    expect(result).toEqual(ok('frames'));
    expect(runs).toEqual([
      { backend: 'videotoolbox', tone: 'none' },
      { backend: 'software', tone: 'none' },
    ]);
    expect(events.filter((event) => event.operation === 'media.decode')).toHaveLength(1);
  });
});
