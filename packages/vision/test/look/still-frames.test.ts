// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, unwrap, type AssetId, type TimeRange } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { GradeFailed, LookUnavailable } from '../../src/look/errors';
import { createStillLookFrames, gradeLutFromCache, type StillSource } from '../../src/look/media-adapter';
import { frameCountFor, sampleSeconds } from '../../src/look/sample-times';
import { encodePng } from '../../src/media/png';

const assetId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AssetId;
const range: TimeRange = {
  start: { value: 10, rate: { num: 1, den: 1 } },
  duration: { value: 2, rate: { num: 1, den: 1 } },
};

describe('sample times', () => {
  it('takes one still per second, mid-slice, and caps the pool', () => {
    expect(frameCountFor(range)).toBe(2);
    expect(sampleSeconds(range, 2)).toEqual([10.5, 11.5]);
    expect(frameCountFor({ start: range.start, duration: { value: 0, rate: { num: 1, den: 1 } } })).toBe(1);
    const long = { start: range.start, duration: { value: 100, rate: { num: 1, den: 1 } } };
    expect(frameCountFor(long)).toBe(48);
    expect(sampleSeconds(long, 48)).toHaveLength(48);
  });
});

describe('createStillLookFrames', () => {
  const pixels = Uint8Array.of(10, 20, 30);
  const png = encodePng(pixels, 1, 1);

  function source(still: StillSource, pathOf: () => Promise<string | undefined> = async () => '/clip.mov') {
    return createStillLookFrames({ frames: 2, pathOf, still });
  }

  it('keeps a decoded still and skips one that failed', async () => {
    let calls = 0;
    const sampled = await source({
      png: async () => {
        calls += 1;
        return calls === 1 ? err(LookUnavailable()) : ok(png);
      },
    }).sample(assetId, range, new AbortController().signal);
    expect(calls).toBe(2);
    const frames = unwrap(sampled);
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    if (!frame) throw new Error('missing frame');
    expect(Array.from(frame.rgb)).toEqual([10, 20, 30]);
    expect(frame.encoding).toBe('bt709');
    expect(frame.range).toBe('full');
  });

  it('is unavailable when nothing decodes, and cancelled when already aborted', async () => {
    const none = await source({ png: async () => ok(Uint8Array.of(1, 2, 3)) }).sample(
      assetId,
      range,
      new AbortController().signal,
    );
    expect(none.ok ? '' : none.error.code).toBe('vision.look_unavailable');
    expect(none.ok ? '' : none.error.detail).toBe('no decodable frame (last: core.validation)');
    const failing = await source({ png: async () => err(GradeFailed()) }).sample(
      assetId,
      range,
      new AbortController().signal,
    );
    expect(failing.ok ? '' : failing.error.detail).toBe('no decodable frame (last: vision.grade_failed)');
    const missing = await source({ png: async () => ok(png) }, async () => undefined).sample(
      assetId,
      range,
      new AbortController().signal,
    );
    expect(missing.ok ? '' : missing.error.code).toBe('vision.look_unavailable');
    const controller = new AbortController();
    controller.abort();
    const cancelled = await source({ png: async () => ok(png) }).sample(assetId, range, controller.signal);
    expect(cancelled.ok ? '' : cancelled.error.code).toBe('core.cancelled');
  });
});

describe('gradeLutFromCache', () => {
  const key = `grades/ab/${'ab'.repeat(32)}.v1.cube`;

  it('returns a grade LUT ref and forwards a failed write', async () => {
    const sink = gradeLutFromCache(async (_key, body) => ok({ bytes: body.length }));
    const written = unwrap(await sink.write(assetId, 'TITLE\n', key));
    expect(written).toEqual({
      kind: 'gradeLut',
      key,
      bytes: 6,
      mimeType: 'text/plain',
      recipe: 1,
    });
    const failed = await gradeLutFromCache(async () => err(GradeFailed())).write(assetId, 'TITLE\n', key);
    expect(failed.ok ? '' : failed.error.code).toBe('vision.grade_failed');
  });
});
