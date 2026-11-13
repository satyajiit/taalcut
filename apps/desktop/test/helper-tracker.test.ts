// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { defineError, err, FrameRate, newId, RationalTime, TimeRange } from '@taalcut/core';
import { helperTracker } from '../src/utility/roots/render-phase3-agent';

const NoHelper = defineError('test.no_helper', { retryable: false });

describe('the tracker on the mac helper (IX3-F5, H6)', () => {
  it('lets go of the session at once when no helper starts, since no request went out', async () => {
    const roots: string[][] = [];
    let letGo = 0;
    const tracker = helperTracker((_services, asked) => {
      roots.push([...asked]);
      return Promise.resolve(err(NoHelper()));
    });
    const rate = FrameRate.of(30, 1);
    const tracked = await tracker.track({
      assetId: newId<'Asset'>(),
      contentHash: 'c'.repeat(64),
      path: '/library/originals/a.mov',
      range: TimeRange.of(RationalTime.of(0, rate), RationalTime.of(30, rate)),
      onLetGo: () => void letGo++,
    });
    expect(tracked.ok).toBe(false);
    expect(roots).toEqual([['/library/originals']]);
    expect(letGo).toBe(1);
  });
});
