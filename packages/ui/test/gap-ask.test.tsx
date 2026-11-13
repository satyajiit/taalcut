// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: the gapFix card says what's wrong in plain words (the counts over the video, why it asks, why nothing
 * fits a shot and the closest clip), starts with Taalcut's proposals chosen, offers the clip another shot has (which
 * shot gives it up, what it gets instead), another part of a used clip and Add more clips (from this Mac or the
 * phone), and says the chat can answer too. All made-up data.
 */
import type { CardOf } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView } from '../src/index';
import { wrap } from './make-fixture';

const fixture = (state: string): CardOf<'gapFix'> => {
  const card = CARD_FIXTURES.gapFix[state];
  if (!card) throw new Error(`no gapFix fixture ${state}`);
  return card;
};
const gapEl = (number: number) =>
  within(
    [...document.querySelectorAll<HTMLElement>('[data-slot=gap]')].find((el) =>
      el.querySelector(`h4`)?.textContent?.startsWith(`Shot ${number} `),
    )!,
  );

describe('gapFix card: what the footage can’t fill (FIX-ASK)', () => {
  it('says what is wrong: the counts, why it asks, why nothing fits, and the closest clip', () => {
    const decide = vi.fn(() => Promise.resolve({ ok: true as const, value: 'answered' as const }));
    wrap(<CardView card={fixture('ownerAsking')} />, { decide });
    expect(screen.getByRole('heading', { name: '3 shots need a look' })).toBeTruthy();
    expect(
      screen.getByText(
        'This video needs 13 clips. 12 of yours fit, so 1 shot has nothing. Taalcut isn’t sure of 2 clips.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The opening shot sets the hook, and its clip is unsure. A shot with the template’s text or graphics has an unsure clip.',
      ),
    ).toBeTruthy();
    const nine = gapEl(9);
    expect(nine.getByText(/None of your clips shows/)).toBeTruthy();
    expect(nine.getByText('hands paying at a market stall').closest('[translate=no]')).toBeTruthy();
    expect(nine.getByText(/The closest is/).textContent).toBe(
      'The closest is A long walk down a lit walkway at dusk (fits 61%), now in shot 5.',
    );
    expect(gapEl(1).getByText(/Another shot has a clip that fits this one clearly better/)).toBeTruthy();
    expect(gapEl(1).getByText('The template’s text')).toBeTruthy();
    expect(gapEl(1).getByText('The template’s graphics')).toBeTruthy();
    expect(screen.getByText(/You can answer in the chat too/)).toBeTruthy();
  });

  it('offers the clip from another shot, another part of a clip, and Add more clips', () => {
    const onPhone = vi.fn();
    wrap(<CardView card={fixture('ownerAsking')} />, { navigate: onPhone });
    const kinds = (n: number) =>
      [...gapEl(n).getAllByRole('listitem')].flatMap((li) => (li.dataset.kind ? [li.dataset.kind] : []));
    expect(kinds(1)).toEqual(['keep', 'borrow', 'addClips', 'film', 'drop']);
    expect(kinds(9)).toEqual(['reuse', 'addClips', 'film', 'drop']);
    const borrow = within(
      gapEl(1)
        .getAllByRole('listitem')
        .find((li) => li.dataset.kind === 'borrow')!,
    ).getByText(/now in shot 3/);
    // The unsure opening's closer clip is its borrow row; the line is for a shot with nothing.
    expect(gapEl(1).queryByText(/The closest is/)).toBeNull();
    expect(borrow.textContent).toBe(
      'Someone checks a phone on a park bench, then smiles (fits 84%), now in shot 3. Shot 3 gets A neon sign over a shop door at night instead, so no clip is used twice.',
    );
    expect(gapEl(9).getByText(/Another part of/).textContent).toContain('the clip in shot 5');
    const add = within(
      gapEl(9)
        .getAllByRole('listitem')
        .find((li) => li.dataset.kind === 'addClips')!,
    );
    fireEvent.click(add.getByRole('button', { name: 'From your phone' }));
    expect(onPhone).toHaveBeenCalledWith({ to: 'phone' });
  });

  it("starts with Taalcut's proposals chosen, so taking them is one press", async () => {
    const decide = vi.fn(() => Promise.resolve({ ok: true as const, value: 'answered' as const }));
    wrap(<CardView card={fixture('ownerAsking')} />, { decide });
    expect(screen.getByText(/Taalcut chose a fix for each shot below/)).toBeTruthy();
    const card = fixture('ownerAsking');
    const [opening, four, nine] = card.gaps;
    fireEvent.click(screen.getByRole('button', { name: 'Fix 3 gaps' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('ap-owner', 'approve', {
        answer: {
          kind: 'gapFix',
          fixes: [
            { gapId: opening!.gapId, fix: 'borrow', swapTo: opening!.proposed!.swapTo },
            { gapId: four!.gapId, fix: 'keep' },
            { gapId: nine!.gapId, fix: 'film' },
          ],
        },
      }),
    );
  });

  it('a changed choice goes with the answer: Add more clips for shot 9', async () => {
    const decide = vi.fn(() => Promise.resolve({ ok: true as const, value: 'answered' as const }));
    wrap(<CardView card={fixture('ownerAsking')} />, { decide });
    const add = within(
      gapEl(9)
        .getAllByRole('listitem')
        .find((li) => li.dataset.kind === 'addClips')!,
    );
    fireEvent.click(add.getByRole('button', { name: 'Choose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fix 3 gaps' }));
    const nine = fixture('ownerAsking').gaps[2]!;
    await waitFor(() => expect(decide).toHaveBeenCalled());
    const sent = (decide.mock.calls[0] as unknown[])[2] as {
      answer: { fixes: { gapId: string; fix: string }[] };
    };
    expect(sent.answer.fixes.find((f) => f.gapId === nine.gapId)?.fix).toBe('addClips');
  });

  it('after Add more clips: what came in, and what was settled', () => {
    const { unmount } = wrap(<CardView card={fixture('clipsAdded')} />);
    expect(screen.getByText('You added 2 clips; 1 is ready so far. Taalcut used 0 of them.')).toBeTruthy();
    expect(
      screen.getByText('Shot 1: took the clip from shot 3, which got another clip instead'),
    ).toBeTruthy();
    expect(screen.getByText('Shot 4: kept as it is. None of your other clips fits it better.')).toBeTruthy();
    unmount();
    wrap(<CardView card={fixture('noClipsCame')} />);
    expect(screen.getByText(/No new clips came in yet/)).toBeTruthy();
  });

  it('on autopilot the card says what was done, and a reused part names its shot', () => {
    const { unmount } = wrap(<CardView card={fixture('autopilotSettled')} />);
    expect(
      screen.getByText('Shot 1: took the clip from shot 3, which got another clip instead'),
    ).toBeTruthy();
    expect(screen.getByText(/This video needs 13 clips/)).toBeTruthy();
    unmount();
    wrap(<CardView card={fixture('reusedSettled')} />);
    expect(screen.getByText('Shot 9: another part of the clip in shot 5')).toBeTruthy();
  });
});
