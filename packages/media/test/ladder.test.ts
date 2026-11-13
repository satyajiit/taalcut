// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRate } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planNormalisation } from '../src/normalise/plan';
import { chooseProxyLadder, gopSize, proxyRate } from '../src/proxy/ladder';
import { probeOf, videoStream } from './helpers/probe-fixture';

describe('proxy ladder', () => {
  it('keeps slow motion at up to 120 fps and steps the rung down to the budget', () => {
    const slow = planNormalisation(
      probeOf(
        '/tmp/slow.mov',
        videoStream({
          averageFrameRate: { num: 240, den: 1 },
          frameRate: { num: 240, den: 1 },
          duration: { value: 2_000_000, rate: 1_000_000 },
          frameCount: 480,
          width: 3840,
          height: 2160,
          displayWidth: 3840,
          displayHeight: 2160,
        }),
      ),
    );
    expect(slow.ok && proxyRate(slow.value)).toEqual(FrameRate.of(120));
    expect(gopSize(120)).toBe(60);

    const generous = chooseProxyLadder({
      sizeBytes: 50_000_000,
      durationSec: 2,
      fps: 30,
      sourceLongSide: 3840,
      previewFriendly: false,
    });
    expect(generous.longSide).toBe(1280);
    expect(generous.videoBps).toBe(2_500_000);

    const tight = chooseProxyLadder({
      sizeBytes: 2_000_000,
      durationSec: 10,
      fps: 30,
      sourceLongSide: 1920,
      previewFriendly: false,
    });
    expect(tight.longSide).toBeLessThanOrEqual(960);
    expect(tight.reusedOriginal).toBe(false);
  });

  it('reuses a preview-friendly original under the floor', () => {
    const choice = chooseProxyLadder({
      sizeBytes: 100_000,
      durationSec: 10,
      fps: 30,
      sourceLongSide: 1280,
      previewFriendly: true,
    });
    expect(choice.reusedOriginal).toBe(true);
    const encoded = chooseProxyLadder({ ...choice, previewFriendly: false, sizeBytes: 100_000, durationSec: 10, fps: 30, sourceLongSide: 1920 });
    expect(encoded.reusedOriginal).toBe(false);
    expect(encoded.longSide).toBe(640);
    expect(encoded.atBudget).toBe(true);
  });
});
