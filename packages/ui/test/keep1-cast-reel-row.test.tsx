// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Timeline } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardView, MAKE_FIXTURE_IDS, MAKE_FIXTURES } from '../src/index';
import { assetId, clipId, makeTimeline, ok, timelineData, wrap } from './make-fixture';

// KEEP1: the cast board's rows for slots that keep the reel's own clip.

const { project: PROJECT, timeline: TIMELINE } = MAKE_FIXTURE_IDS;
const REEL = assetId(900);
const ZERO_PARTS = {
  intent: 0,
  motion: 0,
  quality: 0,
  subject: 0,
  energy: 0,
  hook: null,
  rerank: null,
  penalty: 0,
};

/** Three slots; those named keep the reel's clip, as assembly leaves them: the reel as the pick, nothing scored. */
function reelTimeline(keptIndexes: readonly number[]): Timeline {
  const base = makeTimeline();
  return {
    ...base,
    cast: {
      ...base.cast!,
      slots: base.cast!.slots.map((slot, index) =>
        keptIndexes.includes(index)
          ? {
              ...slot,
              pick: {
                assetId: REEL,
                shotId: null,
                sourceStart: { value: index * 45, rate: { num: 30, den: 1 } },
                syncPoint: null,
                score: 0,
                parts: ZERO_PARTS,
              },
              alternates: [],
              confidence: null,
              needsRerank: false,
              note: 'reelKept' as const,
            }
          : slot,
      ),
    },
  };
}

const rows = async () => {
  const grid = await screen.findByRole('grid', { name: 'Your clips, slot by slot' });
  return within(grid).getAllByRole('row');
};
const board = (timeline: Timeline, dispatch = vi.fn(() => Promise.resolve(ok()))) => {
  wrap(
    <CardView card={{ ...MAKE_FIXTURES.castBoard.cast, timelineIds: [TIMELINE], lowConfidence: 0 }} />,
    { dispatch },
    timelineData(timeline, { findAlternates: vi.fn(() => Promise.resolve([])) }),
  );
  return dispatch;
};

describe('the cast board’s reel rows (KEEP1)', () => {
  it('says a kept slot is the reel’s own clip: no pick mark, no confidence, no other shots, no find', async () => {
    board(reelTimeline([1, 2]));
    const [mine, second, third] = await rows();
    for (const row of [second!, third!]) {
      expect(row.dataset.reelOwn).toBe('true');
      expect(within(row).getByText('The reel’s own clip', { selector: '[data-slot=reel-own]' })).toBeTruthy();
      // Screen readers hear it on the pick, in place of who picked.
      const pick = row.querySelector<HTMLElement>('[data-col=pick]')!;
      expect(pick.querySelector('.sr-only')?.textContent).toBe('The reel’s own clip');
      expect(within(row).queryByLabelText('AI pick')).toBeNull();
      expect(within(row).queryByText('AI pick')).toBeNull();
      expect(row.querySelector('[data-slot=confidence]')).toBeNull();
      expect(within(row).queryByRole('button', { name: /^Swap in this shot/ })).toBeNull();
      expect(within(row).queryByRole('button', { name: /^Find something else/ })).toBeNull();
      expect(row.querySelector('[data-col=find]')).toBeNull();
    }
    // The person's own row is as it was.
    expect(mine!.dataset.reelOwn).toBeUndefined();
    expect(within(mine!).getByLabelText('AI pick')).toBeTruthy();
    expect(mine!.querySelector('[data-slot=confidence]')).not.toBeNull();
    expect(within(mine!).getAllByRole('button', { name: /^Swap in this shot/ })).toHaveLength(2);
    expect(within(mine!).getByRole('button', { name: 'Find something else for slot 1' })).toBeTruthy();
  });

  it('keeps Lock on a kept slot, and the arrows reach it straight from the pick', async () => {
    const dispatch = board(reelTimeline([1]));
    const [, second] = await rows();
    const lock = within(second!).getByRole('button', { name: 'Lock slot 2' });
    const pick = second!.querySelector<HTMLElement>('[data-col=pick]')!;
    // The grid's one tab stop follows focus.
    act(() => pick.focus());
    fireEvent.keyDown(pick, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(lock);
    fireEvent.keyDown(lock, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(pick);
    fireEvent.click(lock);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledWith('timeline.lockClip', {
      projectId: PROJECT,
      timelineId: TIMELINE,
      clipId: clipId(2),
      locked: true,
    });
  });

  it('says in one line how many shots are the reel’s own, and nothing when none are', async () => {
    board(reelTimeline([1, 2]));
    await rows();
    expect(document.querySelector('[data-slot=reel-own-line]')?.textContent).toBe(
      '2 shots are the reel’s own clips. Your clips fill the rest.',
    );
  });

  it('says it for one shot, and stays quiet on a board with none', async () => {
    board(reelTimeline([2]));
    await rows();
    expect(document.querySelector('[data-slot=reel-own-line]')?.textContent).toBe(
      '1 shot is the reel’s own clip. Your clips fill the rest.',
    );
  });

  it('has no line when every shot is the person’s', async () => {
    board(reelTimeline([]));
    await rows();
    expect(document.querySelector('[data-slot=reel-own-line]')).toBeNull();
  });
});
