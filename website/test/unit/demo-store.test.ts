// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, SAMPLE_REELS, reelById } from '#content/reels';
import { DEMO_PHASES, initialDemoState, useDemoStore } from '#stores/demo';

const demo = () => useDemoStore.getState();

describe('the demo store’s pass', () => {
  beforeEach(() => useDemoStore.setState(initialDemoState));

  it('starts on the saved reel with nothing taken, read or picked', () => {
    expect(demo()).toMatchObject({ phase: 'shelf', landed: 0, read: -1, run: 0, playing: true, view: 'saved' });
  });

  it('runs saved reel → lift → template → sift → picks → ready → approved, in that order', () => {
    expect(DEMO_PHASES).toEqual(['shelf', 'lift', 'template', 'sift', 'assembled', 'ready', 'approved']);
  });

  it.skipIf(SAMPLE_REELS.length < 2)('takes another reel’s template from the lift, back on the saved reel', () => {
    demo().settle();
    demo().approve();
    const other = SAMPLE_REELS.find((r) => r.id !== DEFAULT_REEL_ID)!;
    demo().chooseReel(other.id);
    expect(demo()).toMatchObject({ reelId: other.id, phase: 'lift', landed: 0, read: -1, run: 1, view: 'saved' });
  });

  it('keeps picks and the read inside the reel', () => {
    const reel = reelById(DEFAULT_REEL_ID);
    demo().setLanded(99);
    demo().setRead(999);
    expect(demo()).toMatchObject({ landed: reel.slots.length, read: reel.beats.length - 1 });
    demo().setLanded(-4);
    demo().setRead(-9);
    expect(demo()).toMatchObject({ landed: 0, read: -1 });
  });

  it('settles on the finished pass at once (reduced motion): Approve open, never approved for the visitor', () => {
    const reel = reelById(DEFAULT_REEL_ID);
    demo().settle();
    expect(demo()).toMatchObject({ phase: 'ready', landed: reel.slots.length, read: reel.beats.length - 1, view: 'saved' });
    demo().approve();
    demo().settle();
    expect(demo().phase).toBe('approved');
  });

  it('approves only once the pass is ready, and then shows Your version', () => {
    demo().setPhase('assembled');
    demo().approve();
    expect(demo().phase).toBe('assembled');
    demo().setPhase('ready');
    demo().approve();
    expect(demo()).toMatchObject({ phase: 'approved', landed: reelById(DEFAULT_REEL_ID).slots.length, view: 'yours' });
  });

  it('toggles between the saved reel and Your version, which only exists once approved', () => {
    demo().setView('yours');
    expect(demo().view).toBe('saved');
    demo().settle();
    demo().approve();
    demo().setView('saved');
    expect(demo().view).toBe('saved');
    demo().setView('yours');
    expect(demo().view).toBe('yours');
  });

  it('starts a new pass from the lift when Use template is pressed again', () => {
    demo().settle();
    demo().approve();
    demo().replay();
    expect(demo()).toMatchObject({ reelId: DEFAULT_REEL_ID, phase: 'lift', landed: 0, read: -1, run: 1, view: 'saved' });
    demo().replay();
    expect(demo().run).toBe(2);
  });

  it('pauses and plays at the visitor’s word', () => {
    demo().setPlaying(false);
    expect(demo().playing).toBe(false);
    demo().setPlaying(true);
    expect(demo().playing).toBe(true);
  });
});
