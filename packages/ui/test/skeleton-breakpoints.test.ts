// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CompactBone, ResponsiveBones, SkeletonResult } from 'boneyard-js';
import { describe, expect, it } from 'vitest';
import { fillEmptyBreakpoints } from '../src/skeleton/fill-breakpoints';

const bone: CompactBone = [0, 0, 100, 12, 4];
const shot = (
  viewportWidth: number,
  bones: CompactBone[],
  width = bones.length ? 224 : 0,
): SkeletonResult => ({
  name: 'chat-conversations',
  viewportWidth,
  width,
  height: bones.length * 20,
  bones,
});
const responsive = (shots: Record<number, SkeletonResult>): ResponsiveBones => ({ breakpoints: shots });

describe('fillEmptyBreakpoints', () => {
  it('gives an empty width the nearest wider width’s bones', () => {
    const filled = fillEmptyBreakpoints(
      responsive({ 1024: shot(1024, []), 1280: shot(1280, [bone, bone]), 1600: shot(1600, [bone]) }),
    );
    expect(filled).toEqual(
      responsive({
        1024: shot(1024, [bone, bone]),
        1280: shot(1280, [bone, bone]),
        1600: shot(1600, [bone]),
      }),
    );
  });

  it('takes the nearest narrower width’s above the widest that has bones', () => {
    const filled = fillEmptyBreakpoints(responsive({ 1024: shot(1024, [bone]), 1600: shot(1600, []) }));
    expect(filled).toEqual(responsive({ 1024: shot(1024, [bone]), 1600: shot(1600, [bone]) }));
  });

  it('leaves full captures, wholly empty ones and single snapshots as they are', () => {
    const full = responsive({ 1024: shot(1024, [bone]), 1280: shot(1280, [bone, bone]) });
    const empty = responsive({ 1024: shot(1024, []), 1280: shot(1280, []) });
    const single = shot(1280, []);
    expect(fillEmptyBreakpoints(full)).toBe(full);
    expect(fillEmptyBreakpoints(empty)).toBe(empty);
    expect(fillEmptyBreakpoints(single)).toBe(single);
  });
});
