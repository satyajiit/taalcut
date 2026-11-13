// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, CleanupPlan, Result, TaalcutError } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, toastStore, type CardData } from '../src/index';
import { failed, makeTimeline, ok, timelineData, wrap } from './make-fixture';

const fixture = (state: string): CardOf<'cleanupPlan'> => {
  const card = CARD_FIXTURES.cleanupPlan[state];
  if (!card) throw new Error(`no cleanupPlan fixture ${state}`);
  return card;
};
const PROPOSED = fixture('proposed');
const TIMELINE_ID = PROPOSED.plan.timelineId;
const frame = () => {
  const found = document.querySelector<HTMLElement>('[data-card-type=cleanupPlan]');
  if (!found) throw new Error('no cleanup card');
  return found;
};
const sentence = () => frame().querySelector('[data-slot=cleanup-sentence]')?.textContent ?? '';

/** The plan a switch asks for: no fillers, so 3 s less saved. */
const NO_FILLERS: CleanupPlan = {
  ...PROPOSED.plan,
  stats: { fillers: 0, pauses: 9, retakes: 2, punchIns: 3, secondsSaved: 8 },
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const refused = (code: string): Result<CleanupPlan> => ({
  ok: false,
  error: { code, messageKey: `errors.${code}`, retryable: false } satisfies TaalcutError,
});
const applied = () => frame().querySelector('[data-slot=cleanup-applied]')?.textContent ?? '';

const planOf = (plan: CleanupPlan) =>
  vi.fn<NonNullable<CardData['planCleanup']>>(() => Promise.resolve({ ok: true, value: plan }));

describe('cleanupPlan card (U7)', () => {
  it('says the plan in one sentence over its switches, with Apply and Open in the editor', () => {
    wrap(<CardView card={PROPOSED} />, { dispatch: vi.fn(), navigate: vi.fn() });
    expect(frame().getAttribute('data-state')).toBe('proposed');
    expect(sentence()).toMatch(
      /^Remove 14 fillers, shorten 9 pauses, cut 2 retakes,? and add 3 punch-ins: 0?0:52 → 0?0:41$/,
    );
    for (const name of [
      'Remove fillers (um, uh)',
      /Shorten pauses longer than 0\.5\s?s/,
      'Cut retakes (keep the last take)',
      'Punch in on stressed words',
    ])
      expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Open in the editor' })).toBeTruthy();
  });

  it('a switch asks for a new plan (a read) and dispatches nothing; the numbers dim until it comes', async () => {
    const answer = deferred<Result<CleanupPlan>>();
    const planCleanup = vi.fn<NonNullable<CardData['planCleanup']>>(() => answer.promise);
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={PROPOSED} />, { dispatch }, { planCleanup });

    fireEvent.click(screen.getByRole('switch', { name: 'Remove fillers (um, uh)' }));
    expect(planCleanup).toHaveBeenCalledWith({
      timelineId: TIMELINE_ID,
      settings: { fillers: false, pauses: true, retakes: true, punchIns: true, pauseThresholdMs: 500 },
    });
    expect(frame().getAttribute('data-state')).toBe('replanning');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);

    await act(async () => answer.resolve({ ok: true, value: NO_FILLERS }));
    expect(frame().getAttribute('data-state')).toBe('proposed');
    expect(sentence()).toMatch(/^Shorten 9 pauses, cut 2 retakes,? and add 3 punch-ins: 0?0:52 → 0?0:44$/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Apply dispatches the plan shown, says so with Undo, and Undo brings the plan back', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const undo = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={PROPOSED} />, { dispatch, undo }, { planCleanup: planOf(NO_FILLERS) });
    fireEvent.click(screen.getByRole('switch', { name: 'Remove fillers (um, uh)' }));
    await waitFor(() => expect(sentence()).toMatch(/^Shorten 9 pauses/));

    const before = toastStore.list().length;
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(frame().getAttribute('data-state')).toBe('applied'));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith('timeline.applyCleanup', {
      projectId: PROPOSED.projectId,
      timelineId: TIMELINE_ID,
      plan: NO_FILLERS,
    });
    expect(applied()).toMatch(/^Cleaned up: 8\s?s shorter$/);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

    const shown = toastStore.list().slice(before);
    expect(shown.map((entry) => entry.title)).toEqual([expect.stringMatching(/^Cleaned up: 8\s?s shorter$/)]);
    await act(async () => shown[0]?.action?.onSelect());
    expect(undo).toHaveBeenCalledOnce();
    expect(frame().getAttribute('data-state')).toBe('proposed');
  });

  it('a refused Apply stays on the card in words', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed('timeline.clip_locked')));
    wrap(<CardView card={PROPOSED} />, { dispatch });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await within(frame()).findByRole('alert')).textContent).toBe(
      'A clip you locked is in the way. Unlock it to clean it up.',
    );
    expect(frame().getAttribute('data-state')).toBe('proposed');
  });

  it('stale: the video moved past the plan, Apply waits and Check again asks for a fresh plan', async () => {
    const moved = { ...makeTimeline({ revision: 5 }), id: TIMELINE_ID };
    const fresh: CleanupPlan = { ...PROPOSED.plan, revision: 5 };
    const planCleanup = planOf(fresh);
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={PROPOSED} />, { dispatch }, timelineData(moved, { planCleanup }));

    expect(frame().getAttribute('data-state')).toBe('stale');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(planCleanup).toHaveBeenCalledWith({
      timelineId: TIMELINE_ID,
      settings: { fillers: true, pauses: true, retakes: true, punchIns: true, pauseThresholdMs: 500 },
    });
    await waitFor(() => expect(frame().getAttribute('data-state')).toBe('proposed'));
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stale: a refusal from Apply says the video changed', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed('timeline.cleanup_stale')));
    wrap(<CardView card={PROPOSED} />, { dispatch }, { planCleanup: planOf(PROPOSED.plan) });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(frame().getAttribute('data-state')).toBe('stale'));
    expect(within(frame()).getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('applied: what it saved, and the way to the editor', () => {
    const navigate = vi.fn();
    wrap(<CardView card={fixture('applied')} />, { dispatch: vi.fn(), navigate });
    expect(frame().getAttribute('data-state')).toBe('applied');
    expect(applied()).toMatch(/^Cleaned up: 11\s?s shorter$/);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    expect(navigate).toHaveBeenCalledWith({
      to: 'timeline',
      projectId: PROPOSED.projectId,
      timelineId: TIMELINE_ID,
      panel: 'cleanup',
    });
  });

  it('no speech found: one line, nothing to switch or apply', async () => {
    const planCleanup = vi.fn<NonNullable<CardData['planCleanup']>>(() =>
      Promise.resolve(refused('timeline.cleanup_no_speech')),
    );
    wrap(<CardView card={PROPOSED} />, { dispatch: vi.fn() }, { planCleanup });
    fireEvent.click(screen.getByRole('switch', { name: 'Punch in on stressed words' }));
    await waitFor(() => expect(frame().getAttribute('data-state')).toBe('noSpeech'));
    expect(frame().textContent).toContain('No speech found in this video.');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('nothing to cut: says so, and Apply has nothing to do', () => {
    wrap(<CardView card={fixture('nothingToCut')} />, { dispatch: vi.fn() });
    expect(sentence()).toBe('Nothing to cut with these switches: the speech is already tight.');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true);
  });
});
