// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, REELS, SAMPLE_REELS, reelById } from '#content/reels';
import { initialDemoState, useDemoStore } from '#stores/demo';

describe('the demo store', () => {
  beforeEach(() => useDemoStore.setState(initialDemoState));

  const other = SAMPLE_REELS.find((r) => r.id !== DEFAULT_REEL_ID);

  it.skipIf(!other)('takes another reel’s template from the lift when another reel is chosen', () => {
    if (!other) return;
    useDemoStore.getState().setPhase('assembled');
    useDemoStore.getState().setBeat(7);
    useDemoStore.getState().chooseReel(other.id);
    expect(useDemoStore.getState()).toMatchObject({ reelId: other.id, phase: 'lift', beat: 0 });
  });

  it('ignores an unknown reel, a placeholder place and the reel already shown', () => {
    useDemoStore.getState().setPhase('sift');
    useDemoStore.getState().chooseReel('nope');
    for (const empty of REELS.filter((r) => r.placeholder)) useDemoStore.getState().chooseReel(empty.id);
    useDemoStore.getState().chooseReel(DEFAULT_REEL_ID);
    expect(useDemoStore.getState()).toMatchObject({ reelId: DEFAULT_REEL_ID, phase: 'sift' });
  });

  it('advances one phase at a time and stops at the approval', () => {
    const seen = [useDemoStore.getState().phase];
    for (let i = 0; i < 7; i++) {
      useDemoStore.getState().advance();
      seen.push(useDemoStore.getState().phase);
    }
    expect(seen).toEqual(['shelf', 'lift', 'template', 'sift', 'assembled', 'ready', 'approved', 'approved']);
  });

  it('falls back to the default reel for a bad address', () => {
    expect(reelById('../etc').id).toBe(DEFAULT_REEL_ID);
    expect(reelById(null).id).toBe(DEFAULT_REEL_ID);
  });
});
