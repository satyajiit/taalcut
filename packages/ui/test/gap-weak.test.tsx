// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GAPS: the gapFix card shows a weak pick the way it shows a gap: the clip in it now with its words and fit,
 * what happens by default in plain words, a row per clip that could take its place (its words and fit), keep, and
 * the empty slot's fixes. Choosing a clip sends it with the answer; a settled card says it was swapped or kept.
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

describe('gapFix card: unsure clips (FIX-GAPS)', () => {
  it('shows the clip in the slot now, the default in plain words, and a row per clip that could replace it', () => {
    wrap(<CardView card={fixture('unsureAsking')} />);
    expect(screen.getByRole('heading', { name: '1 shot needs a look' })).toBeTruthy();
    expect(screen.getByText('A city street with traffic at night').closest('[translate=no]')).toBeTruthy();
    expect(screen.getByText(/another of your clips fits this shot clearly better/)).toBeTruthy();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-slot=gap-fix]')].map(
      (row) => row.dataset.kind,
    );
    expect(rows).toEqual(['swap', 'swap', 'swap', 'keep', 'film', 'drop']);
    const first = within(document.querySelectorAll<HTMLElement>('[data-kind=swap]')[0]!);
    expect(first.getByText('A wide park with a monument on a sunny day')).toBeTruthy();
    expect(first.getByText('(fits 86%)')).toBeTruthy();
    expect(screen.getByText('A clip with no description yet')).toBeTruthy();
  });

  it('sends the chosen clip with the answer', async () => {
    const decide = vi.fn(() => Promise.resolve({ ok: true as const, value: 'answered' as const }));
    wrap(<CardView card={fixture('unsureAsking')} />, { decide });
    const second = within(document.querySelectorAll<HTMLElement>('[data-kind=swap]')[1]!);
    fireEvent.click(second.getByRole('button', { name: 'Choose' }));
    expect(second.getByRole('button', { name: 'Chosen' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Fix 1 gap' }));
    const gap = fixture('unsureAsking').gaps[0]!;
    const swap = gap.options.find((o) => o.kind === 'swap');
    const target = swap?.kind === 'swap' ? swap.candidates[1]! : undefined;
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith('ap-unsure', 'approve', {
        answer: {
          kind: 'gapFix',
          fixes: [
            { gapId: gap.gapId, fix: 'swap', swapTo: { assetId: target!.assetId, shotId: target!.shotId } },
          ],
        },
      }),
    );
  });

  it('says plainly when it swapped the clip, and when it kept it because none fits better', () => {
    const { unmount } = wrap(<CardView card={fixture('unsureSwapped')} />);
    expect(screen.getByText('Shot 12: swapped for a clip that fits better')).toBeTruthy();
    unmount();
    wrap(<CardView card={fixture('unsureKept')} />);
    expect(screen.getByText('Shot 12: kept as it is. None of your other clips fits it better.')).toBeTruthy();
  });
});
