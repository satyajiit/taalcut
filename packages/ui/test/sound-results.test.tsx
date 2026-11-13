// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K2: the soundResults card: each sound's words and chips, hints, nothing found, and Add on cuts. */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SOUND_RESULTS_FIXTURES } from '../src/cards/fixtures-sounds';
import { CardActionsProvider, CardView, type CardActions } from '../src/index';

function fixture(name: string): CardOf<'soundResults'> {
  const card = SOUND_RESULTS_FIXTURES[name];
  if (!card) throw new Error(`no fixture ${name}`);
  return card;
}

const wrap = (card: CardOf<'soundResults'>, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>
        <CardView card={card} />
      </CardActionsProvider>
    </I18nProvider>,
  );

const row = (title: string) => {
  const found = screen.getByText(title).closest('li');
  if (!found) throw new Error(`no row ${title}`);
  return found;
};
const CHIPS = '[data-slot=sound-verdict], [data-slot=sound-borderline], [data-slot=licence-chip]';
const chips = (element: HTMLElement) => [...element.querySelectorAll(CHIPS)].map((chip) => chip.textContent);

describe('the soundResults card (EAR1-K2)', () => {
  it('lists the sounds best first with their family, verdict and provenance', () => {
    const { container } = wrap(fixture('results'));
    expect(screen.getByRole('heading', { name: 'Sound effects' })).toBeTruthy();
    expect(screen.getByText('a deep cinematic boom').getAttribute('translate')).toBe('no');
    const rows = within(screen.getByRole('list', { name: 'Sounds, best first' })).getAllByRole('listitem');
    expect(rows.map((li) => li.dataset.source)).toEqual(['bank', 'bank', 'pack', 'library']);
    expect(chips(row('Cut hit, sub'))).toEqual(['Strong match', 'Code-made']);
    expect(row('Cut hit, sub').textContent).toContain('Impact');
    // A fitted bank sound on a verdict's line (D23) says so; it is code-made too (D22) and credits its recording as
    // written.
    expect(chips(row('Book landing'))).toEqual(['Plausible match', 'Borderline', 'Code-made']);
    const credit = within(row('Book landing')).getByText('“Book drop” by a recordist on Freesound (CC0 1.0)');
    expect(credit.getAttribute('translate')).toBe('no');
    expect(chips(row('Soft impact'))).toEqual(['Weak match', 'CC0']);
    // The user's own sound has no licence chip and no family.
    expect(chips(row('my-boom.wav'))).toEqual(['No match']);
    expect(row('my-boom.wav').textContent).toContain('From your library');
    expect(screen.getByText('my-boom.wav').getAttribute('translate')).toBe('no');
    expect(container.querySelectorAll('[data-slot=licence-chip][data-licence=MIT]')).toHaveLength(2);
    // No actions given: no buttons, and no player (cards have none for audio).
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(container.querySelector('audio')).toBeNull();
  });

  it('marks a genre or mood query’s sounds as hints, and says why', () => {
    wrap(fixture('hints'));
    expect(chips(row('Soft air whoosh'))).toEqual(['Hint', 'Code-made']);
    expect(chips(row('Warm riser'))).toEqual(['Hint', 'CC0']);
    expect(screen.getByText(/Genre and mood are hints/)).toBeTruthy();
  });

  it('says when nothing matched', () => {
    wrap(fixture('empty'));
    expect(screen.getByText('No sound matched that description.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/Genre and mood are hints/)).toBeNull();
  });

  it('sends Add on cuts for a bank sound to the run, with the id sfx.addHits takes', async () => {
    const followUp = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const card = fixture('results');
    wrap(card, { followUp });
    const buttons = screen.getAllByRole('button', { name: 'Add on cuts' });
    // Only the bank's sounds can go on the cuts by id; each button is described by its sound's name.
    expect(buttons).toHaveLength(2);
    expect(within(row('Soft impact')).queryByRole('button')).toBeNull();
    expect(within(row('my-boom.wav')).queryByRole('button')).toBeNull();
    const add = within(row('Book landing')).getByRole('button', { name: 'Add on cuts' });
    expect(document.getElementById(add.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Book landing',
    );
    await act(async () => fireEvent.click(add));
    expect(followUp).toHaveBeenCalledWith(
      card.runId,
      'Add the sound “Book landing” (fit/land_book) on the cuts.',
      [],
    );
    expect(screen.getByRole('status').textContent).toBe('Sent to the chat.');
  });

  it('puts the words in the message box without a run, and shows a failure', async () => {
    const ask = vi.fn();
    const { runId: _runId, ...noRun } = fixture('results');
    const { unmount } = wrap(noRun, { ask });
    await act(async () =>
      fireEvent.click(within(row('Cut hit, sub')).getByRole('button', { name: 'Add on cuts' })),
    );
    expect(ask).toHaveBeenCalledWith('Add the sound “Cut hit, sub” (cut_hit/sub) on the cuts.', []);
    expect(screen.getByRole('status').textContent).toBe(
      'It’s in the message box. Press Send when you’re ready.',
    );
    unmount();
    const followUp = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
    }));
    wrap(fixture('results'), { followUp });
    await act(async () =>
      fireEvent.click(within(row('Cut hit, sub')).getByRole('button', { name: 'Add on cuts' })),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
