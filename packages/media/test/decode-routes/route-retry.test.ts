// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K4: the route layer of the software retry (render's hardware paths use it with their own routes), and the
 * encoder's refusal next to the decoder's. FFmpeg's lines are as libavcodec prints them at `-loglevel error`.
 */
import { err, ok, type Result, type TaalcutError } from '@taalcut/core';
import {
  FfmpegFailed,
  hardwareEncoderWontStart,
  hardwareRefused,
  MediaCancelled,
  retryOnSoftwareRoute,
} from '@taalcut/media';
import { describe, expect, it } from 'vitest';

const failed = (line: string) =>
  FfmpegFailed({ exitCode: 1 }, { detail: `ffmpeg exited with code 1\n${line}` });
const vtEncoder = failed(
  '[h264_videotoolbox @ 0x1] Cannot create compression session: -12902\n' +
    '[h264_videotoolbox @ 0x1] Try -allow_sw 1. The hardware encoder may be busy, or not supported.\n' +
    'Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
);
const nvenc = failed('[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: out of memory (10): (no details)');
const decoder = failed(
  '[h264 @ 0x1] Failed setup for format videotoolbox_vld: hwaccel initialisation returned error.',
);
const corrupt = failed('[mov,mp4 @ 0x1] moov atom not found');

describe('a hardware encoder that will not start', () => {
  it('reads VideoToolbox and NVENC refusals, and nothing else', () => {
    expect(hardwareEncoderWontStart(vtEncoder)).toBe('the VideoToolbox encoder would not start (-12902)');
    expect(hardwareEncoderWontStart(nvenc)).toBe(
      'the NVENC encoder would not start (out of memory (10): (no details))',
    );
    expect(hardwareEncoderWontStart(decoder)).toBeUndefined();
    expect(hardwareEncoderWontStart(corrupt)).toBeUndefined();
  });

  it('hardwareRefused takes either, the decoder first', () => {
    expect(hardwareRefused(decoder)).toMatch(/videotoolbox_vld decoder/);
    expect(hardwareRefused(vtEncoder)).toMatch(/VideoToolbox encoder/);
    expect(hardwareRefused(corrupt)).toBeUndefined();
  });
});

type Route = 'hardware' | 'software';

/** A job answering each run from `answers` in turn, recording its routes and what was reported. */
function job(answers: readonly Result<string>[]) {
  const routes: Route[] = [];
  const reports: [string, Route][] = [];
  const run = async (route: Route) => {
    routes.push(route);
    return answers[routes.length - 1] ?? ok('more runs than answers');
  };
  const retry = (
    extra: { why?: (error: TaalcutError) => string | undefined; untouched?: () => boolean } = {},
  ) => ({
    first: 'hardware' as Route,
    software: (): Route => 'software',
    report: (reason: string, route: Route) => reports.push([reason, route]),
    ...extra,
  });
  return { run, routes, reports, retry };
}

describe('retryOnSoftwareRoute', () => {
  it('runs once more on the software route when the encoder refused, and reports it first', async () => {
    const { run, routes, reports, retry } = job([err(vtEncoder), ok('encoded')]);
    expect(await retryOnSoftwareRoute(retry(), run)).toEqual(ok('encoded'));
    expect(routes).toEqual(['hardware', 'software']);
    expect(reports).toEqual([['the VideoToolbox encoder would not start (-12902)', 'software']]);
  });

  it('returns any other failure, a cancel, and a second failure as they are', async () => {
    for (const answers of [[err(corrupt)], [err(MediaCancelled())], [err(decoder), err(corrupt)]]) {
      const { run, routes, retry } = job(answers);
      const result = await retryOnSoftwareRoute(retry(), run);
      expect(result).toEqual(answers.at(-1));
      expect(routes.length).toBe(answers.length);
    }
  });

  it('takes a wider rule where the owner gives one, and never repeats what went out', async () => {
    const wider = job([err(corrupt), ok('decoded')]);
    const why = (error: TaalcutError) =>
      error.code === 'media.ffmpeg_failed' ? 'VideoToolbox failed' : undefined;
    expect(await retryOnSoftwareRoute(wider.retry({ why }), wider.run)).toEqual(ok('decoded'));
    expect(wider.reports).toEqual([['VideoToolbox failed', 'software']]);

    const streamed = job([err(decoder)]);
    expect(await retryOnSoftwareRoute(streamed.retry({ untouched: () => false }), streamed.run)).toEqual(
      err(decoder),
    );
    expect(streamed.routes).toEqual(['hardware']);
  });
});
