// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Card } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, MAKE_FIXTURE_IDS, MAKE_FIXTURES } from '../src/index';
import {
  RATE,
  TEMPLATE,
  assetId,
  candidate,
  clipId,
  failed,
  makeTimeline,
  ok,
  shotId,
  slotId,
  timelineData,
  wrap,
} from './make-fixture';

// decide answers with how it went (UX round 1); these tests answer as the run would.
const answered = { ok: true as const, value: 'answered' as const };

const { project: PROJECT, timeline: TIMELINE } = MAKE_FIXTURE_IDS;
const makeFixtures = Object.entries(MAKE_FIXTURES).flatMap(([type, fixtures]) =>
  Object.entries(fixtures).map(([name, card]) => ({ label: `${type}/${name}`, card: card as Card })),
);

/** The cast board's rows, once the live timeline is in. */
const rows = async () => {
  const grid = await screen.findByRole('grid', { name: 'Your clips, slot by slot' });
  return within(grid).getAllByRole('row');
};
const swaps = (row: HTMLElement) => within(row).getAllByRole('button', { name: /^Swap in this shot/ });

describe('Make fixtures', () => {
  it('are the registry’s fixtures for the five Make cards', () => {
    for (const type of Object.keys(MAKE_FIXTURES) as (keyof typeof MAKE_FIXTURES)[])
      // The registry keeps the flow's own fixtures (fixtures-flow.ts) beside them.
      expect(CARD_FIXTURES[type]).toMatchObject(MAKE_FIXTURES[type]);
  });

  it.each(makeFixtures)('renders $label with live data', async ({ card }) => {
    const { container } = wrap(
      <CardView card={card} />,
      { dispatch: vi.fn(() => Promise.resolve(ok())) },
      timelineData(makeTimeline()),
    );
    const root = container.querySelector(`[data-card-type="${card.type}"]`);
    expect(root).not.toBeNull();
    await waitFor(() => expect(root?.textContent?.trim().length).toBeGreaterThan(0));
  });
});

describe('cast board', () => {
  it('asks how many videos and answers with the approval', async () => {
    const decide = vi.fn(() => Promise.resolve(answered));
    wrap(<CardView card={MAKE_FIXTURES.castBoard.asking} />, { decide });
    expect(screen.getByText('How many videos should I make?')).toBeTruthy();
    const count = screen.getByRole('spinbutton', { name: 'Number of videos' });
    expect(count.getAttribute('aria-valuenow')).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: 'One more video' }));
    fireEvent.keyDown(count, { key: 'ArrowUp' });
    expect(count.getAttribute('aria-valuenow')).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'Make 5 videos' }));
    await screen.findByText('Making 5 videos…');
    expect(decide).toHaveBeenCalledWith('ap-variants', 'approve', { answer: { kind: 'variants', count: 5 } });
  });

  it('counts the template’s slots in words that agree with the number (AGT1)', () => {
    const asking = MAKE_FIXTURES.castBoard.asking as Extract<Card, { type: 'castBoard' }>;
    wrap(<CardView card={asking} />);
    expect(screen.getByText(/Each video fills the same 12 slots with different clips/)).toBeTruthy();
    const one = { ...asking, asking: { ...asking.asking!, slotCount: 1 } };
    wrap(<CardView card={one} />);
    expect(screen.getByText(/Each video fills the same slot with different clips/)).toBeTruthy();
  });

  it('turns the question off without a decide handler', () => {
    wrap(<CardView card={MAKE_FIXTURES.castBoard.asking} />);
    expect((screen.getByRole('button', { name: 'Make 3 videos' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('spinbutton', { name: 'Number of videos' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('stops at one video', () => {
    wrap(<CardView card={MAKE_FIXTURES.castBoard.asking} />, { decide: vi.fn() });
    const count = screen.getByRole('spinbutton', { name: 'Number of videos' });
    fireEvent.keyDown(count, { key: 'Home' });
    expect(screen.getByRole('button', { name: 'Make 1 video' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'One fewer video' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows one tab per video and says which ones are gone', async () => {
    wrap(<CardView card={MAKE_FIXTURES.castBoard.cast} />, {}, timelineData(makeTimeline()));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Video 1', 'Video 2', 'Video 3']);
    expect(await rows()).toHaveLength(3);
    expect(
      screen.getByText('1 pick was a close call, so Taalcut checked it again. Swap it if it isn’t right.'),
    ).toBeTruthy();
  });

  it('swaps an alternate in with timeline.swapClip', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={MAKE_FIXTURES.castBoard.cast} />, { dispatch }, timelineData(makeTimeline()));
    const [first] = await rows();
    fireEvent.click(swaps(first!)[0]!);
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledWith('timeline.swapClip', {
      projectId: PROJECT,
      timelineId: TIMELINE,
      clipId: clipId(1),
      media: { assetId: assetId(11), shotId: shotId(11) },
      sourceStart: { value: 66, rate: RATE },
      from: 'alternate',
      // LRN1-PREF: the score the board showed, kept on the pick for the preference learner.
      scored: { score: expect.any(Number), parts: expect.objectContaining({ intent: expect.any(Number) }) },
    });
  });

  it('keeps a failed swap’s cause under its row', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed()));
    wrap(<CardView card={MAKE_FIXTURES.castBoard.cast} />, { dispatch }, timelineData(makeTimeline()));
    const [, second] = await rows();
    fireEvent.click(swaps(second!)[1]!);
    expect(await within(second!).findByRole('alert')).toBeTruthy();
  });

  it('locks a slot, and shows a locked one', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(
      <CardView card={MAKE_FIXTURES.castBoard.cast} />,
      { dispatch },
      timelineData(makeTimeline({ locked: [1] })),
    );
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Lock slot 1' }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('timeline.lockClip', {
        projectId: PROJECT,
        timelineId: TIMELINE,
        clipId: clipId(1),
        locked: true,
      }),
    );
    expect(screen.getByRole('button', { name: 'Unlock slot 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Locked')).toBeTruthy();
  });

  it('finds something else for a slot and swaps it in from the search', async () => {
    const findAlternates = vi.fn(() => Promise.resolve([candidate(99)]));
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(
      <CardView card={MAKE_FIXTURES.castBoard.cast} />,
      { dispatch },
      timelineData(makeTimeline(), { findAlternates }),
    );
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Find something else for slot 1' }));
    await waitFor(() =>
      expect(findAlternates).toHaveBeenCalledWith({
        timelineId: TIMELINE,
        slotId: slotId(1),
        exclude: [shotId(10), shotId(11), shotId(12)],
      }),
    );
    const [first] = await rows();
    await waitFor(() => expect(swaps(first!)).toHaveLength(1));
    fireEvent.click(swaps(first!)[0]!);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        'timeline.swapClip',
        expect.objectContaining({ media: { assetId: assetId(99), shotId: shotId(99) }, from: 'search' }),
      ),
    );
  });

  it('offers to ask about a slot when nothing else fits', async () => {
    const ask = vi.fn();
    const findAlternates = vi.fn(() => Promise.resolve([]));
    wrap(
      <CardView card={MAKE_FIXTURES.castBoard.cast} />,
      { ask, dispatch: vi.fn() },
      timelineData(makeTimeline(), { findAlternates }),
    );
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Find something else for slot 2' }));
    await screen.findByText('Nothing else fits this slot.');
    fireEvent.click(screen.getByRole('button', { name: 'Ask Taalcut' }));
    expect(ask).toHaveBeenCalledWith('About slot 2: ', [
      { kind: 'slot', templateId: TEMPLATE, slotId: slotId(2) },
    ]);
  });

  it('folds a long cast to six rows and the unsure ones', async () => {
    wrap(
      <CardView card={MAKE_FIXTURES.castBoard.cast} />,
      {},
      timelineData(makeTimeline({ slots: 10, unsure: [8] })),
    );
    expect(await rows()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10 slots' }));
    expect(await rows()).toHaveLength(10);
  });

  it('moves one tab stop through the grid with the arrows', async () => {
    wrap(
      <CardView card={MAKE_FIXTURES.castBoard.cast} />,
      { dispatch: vi.fn() },
      timelineData(makeTimeline()),
    );
    const [first, second] = await rows();
    const pick = within(first!).getAllByRole('gridcell')[0]!;
    expect(pick.tabIndex).toBe(0);
    pick.focus();
    fireEvent.keyDown(pick, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(swaps(first!)[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(swaps(second!)[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(within(second!).getByRole('button', { name: 'Lock slot 2' }));
  });

  it('says a gone timeline was deleted', async () => {
    wrap(<CardView card={MAKE_FIXTURES.castBoard.cast} />, {}, timelineData(null));
    expect(await screen.findByText('This video was deleted.')).toBeTruthy();
  });
});

describe('timeline card', () => {
  const open = async () => {
    const strip = await screen.findByRole('listbox', { name: 'Clips' });
    fireEvent.click(within(strip).getAllByRole('option')[0]!);
    return screen.getByRole('group', { name: 'Clip 1' });
  };

  it('shows the cut’s length, shape and clips, and opens the editor', async () => {
    const navigate = vi.fn();
    wrap(<CardView card={MAKE_FIXTURES.timeline.cut} />, { navigate }, timelineData(makeTimeline()));
    expect(await screen.findByText('4.5s · 9:16 · 3 clips')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'timeline', projectId: PROJECT, timelineId: TIMELINE });
  });

  it('trims a clip by a beat either way', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={MAKE_FIXTURES.timeline.cut} />, { dispatch }, timelineData(makeTimeline()));
    const detail = await open();
    fireEvent.click(within(detail).getByRole('button', { name: 'Shorter by a beat' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    fireEvent.click(within(detail).getByRole('button', { name: 'Longer by a beat' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
    const target = { projectId: PROJECT, timelineId: TIMELINE, clipId: clipId(1), edge: 'end' };
    expect(dispatch).toHaveBeenNthCalledWith(1, 'timeline.trimClip', {
      ...target,
      by: { value: -15, rate: RATE },
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, 'timeline.trimClip', {
      ...target,
      by: { value: 15, rate: RATE },
    });
  });

  it('puts a clip into the chat, and closes on Escape', async () => {
    const ask = vi.fn();
    wrap(<CardView card={MAKE_FIXTURES.timeline.cut} />, { ask }, timelineData(makeTimeline()));
    const detail = await open();
    fireEvent.click(within(detail).getByRole('button', { name: 'Add to chat' }));
    expect(ask).toHaveBeenCalledWith('', [{ kind: 'clip', timelineId: TIMELINE, clipId: clipId(1) }]);
    fireEvent.keyDown(detail, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Clip 1' })).toBeNull();
  });

  it('marks your own picks on the strip', async () => {
    wrap(<CardView card={MAKE_FIXTURES.timeline.cut} />, {}, timelineData(makeTimeline({ userPick: [2] })));
    const strip = await screen.findByRole('listbox', { name: 'Clips' });
    const names = within(strip)
      .getAllByRole('option')
      .map((option) => option.getAttribute('aria-label'));
    expect(names[0]).toMatch(/AI pick/);
    expect(names[2]).toMatch(/your pick/);
  });
});
