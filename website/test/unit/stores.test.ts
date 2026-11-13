// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, REELS, SAMPLE_REELS, reelById } from '#content/reels';
import { initialDemoState, useDemoStore } from '#stores/demo';
import {
  initialFormState,
  initialWaitlistState,
  stepForm,
  useWaitlistStore,
  type WaitlistFormEvent,
} from '#stores/waitlist';

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

describe('the waitlist store', () => {
  beforeEach(() => useWaitlistStore.setState(initialWaitlistState));

  it('shares the address and the joined state, and nothing that belongs to one form', () => {
    expect(Object.keys(initialWaitlistState).sort()).toEqual(['email', 'joined', 'make', 'platforms']);
    useWaitlistStore.getState().setEmail('asha@example.com');
    useWaitlistStore.getState().join();
    expect(useWaitlistStore.getState()).toMatchObject({ email: 'asha@example.com', joined: true });
    useWaitlistStore.getState().reset();
    expect(useWaitlistStore.getState()).toMatchObject(initialWaitlistState);
  });

  it('starts with no platform, and toggles them', () => {
    expect(useWaitlistStore.getState().platforms).toEqual([]);
    useWaitlistStore.getState().togglePlatform('ubuntu');
    useWaitlistStore.getState().togglePlatform('macos');
    useWaitlistStore.getState().togglePlatform('macos');
    expect(useWaitlistStore.getState().platforms).toEqual(['ubuntu']);
  });
});

describe('one waitlist form', () => {
  const run = (...events: WaitlistFormEvent[]) => events.reduce(stepForm, initialFormState);

  it('shows a problem only after a check, and clears it when the address changes', () => {
    expect(run({ type: 'typed' })).toEqual(initialFormState);
    const checked = run({ type: 'checked', problem: 'malformed' });
    expect(checked).toEqual({ status: 'invalid', problem: 'malformed', cause: null });
    expect(stepForm(checked, { type: 'typed' })).toEqual(initialFormState);
    expect(run({ type: 'checked', problem: null })).toEqual(initialFormState);
  });

  it('sends, then shows its own failure, which a send or a new problem replaces', () => {
    expect(run({ type: 'sending' }).status).toBe('submitting');
    const failed = run({ type: 'sending' }, { type: 'answered', outcome: { kind: 'error', cause: 'unreachable' } });
    expect(failed).toEqual({ status: 'error', problem: null, cause: 'unreachable' });
    // Typing keeps a failed send's line: only a problem with the address clears as you type.
    expect(stepForm(failed, { type: 'typed' })).toBe(failed);
    expect(stepForm(failed, { type: 'sending' })).toEqual({ status: 'submitting', problem: null, cause: null });
    const offline = run({ type: 'sending' }, { type: 'answered', outcome: { kind: 'offline' } });
    expect(offline).toEqual({ status: 'offline', problem: null, cause: null });
    expect(stepForm(offline, { type: 'checked', problem: 'empty' }).status).toBe('invalid');
  });

  it('goes back to rest once the send is in (the shared joined state shows the success)', () => {
    expect(run({ type: 'sending' }, { type: 'answered', outcome: { kind: 'ok' } })).toEqual(initialFormState);
  });
});
