// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, Result, StockResult, Timeline } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_FIXTURES, CardView, toastStore, type CardActions, type CardData } from '../src/index';
import { failed, makeTimeline, ok, wrap } from './make-fixture';

// decide answers with how it went (UX round 1); these tests answer as the run would.
const answered = { ok: true as const, value: 'answered' as const };

const fixture = (state: string) => {
  const card = CARD_FIXTURES.gapFix[state];
  if (!card) throw new Error(`no gapFix fixture ${state}`);
  return card;
};
const [POUR, STREET] = fixture('open').gaps;
const gap = (number: number) => {
  const found = document.querySelector<HTMLElement>(
    `[data-slot=gap][data-gap-id="${fixture('open').gaps.find((g) => g.number === number)?.gapId}"]`,
  );
  if (!found) throw new Error(`no gap ${number}`);
  return within(found);
};
const fix = (number: number, kind: string) => {
  const row = document
    .querySelector(
      `[data-slot=gap][data-gap-id="${fixture('open').gaps.find((g) => g.number === number)?.gapId}"]`,
    )
    ?.querySelector<HTMLElement>(`[data-slot=gap-fix][data-kind=${kind}]`);
  if (!row) throw new Error(`no ${kind} row for gap ${number}`);
  return within(row);
};

const stockItem = (n: number): StockResult => ({
  provider: 'pexels',
  providerId: String(1000 + n),
  kind: 'video',
  title: `Coffee ${n}`,
  author: { name: `Author ${n}`, url: null },
  pageUrl: `https://www.pexels.com/video/${1000 + n}/`,
  licence: n === 2 ? 'CC-BY-4.0' : n === 3 ? 'CC0-1.0' : 'Pexels-Licence',
  seconds: 8 + n,
  width: 1080,
  height: 1920,
  fps: 30,
  preview: `app://media/stock/${String(n).repeat(64).slice(0, 64)}.jpg`,
  renditionKey: 'hd',
  alreadyImported: null,
});
const searchOf = (items: StockResult[]) =>
  vi.fn<NonNullable<CardData['stockSearch']>>(() => Promise.resolve({ ok: true, value: { items } }));

describe('gapFix card (U2)', () => {
  it('shows each gap as its slot and length, the intent in words with its chips, and a row per fix', () => {
    wrap(<CardView card={fixture('open')} />);
    expect(screen.getByRole('heading', { name: 'Shot 3 · 2.5s' })).toBeTruthy();
    const pour = gap(3);
    expect(pour.getByText('A close-up of the coffee pour').closest('[translate=no]')).toBeTruthy();
    expect(pour.getByText('Close-up')).toBeTruthy();
    expect(pour.getByText('Still camera')).toBeTruthy();
    expect(fix(3, 'film').getByText('Add it to your shot list and film it on your phone.')).toBeTruthy();
    expect(fix(3, 'generate').getByText('google · imagen-4').getAttribute('translate')).toBe('no');
    expect(fix(3, 'generate').getByText('about $0.04')).toBeTruthy();
    expect(fix(3, 'drop').getByText('The video becomes 27.5s')).toBeTruthy();
    // Without a provider there is nothing to press.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Film this opens the phone page', () => {
    const navigate = vi.fn();
    wrap(<CardView card={fixture('open')} />, { navigate });
    fireEvent.click(fix(3, 'film').getByRole('button', { name: 'Open on your phone' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'phone' });
  });

  it('after the run, Generate an image puts the request and the slot in the composer', () => {
    const ask = vi.fn();
    wrap(<CardView card={fixture('open')} />, { ask });
    fireEvent.click(fix(3, 'generate').getByRole('button', { name: 'Ask in chat' }));
    expect(ask).toHaveBeenCalledWith('Generate an image for shot 3', [
      {
        kind: 'range',
        timelineId: fixture('open').timelineId,
        range: { start: POUR!.start, duration: POUR!.duration },
      },
    ]);
  });

  it('stock: up to six results with licence and author, then Use it imports and fills, and the gap folds', async () => {
    const stockSearch = searchOf([1, 2, 3, 4, 5, 6, 7, 8].map(stockItem));
    const use = vi.fn<NonNullable<CardActions['stock']>['use']>(() =>
      Promise.resolve({ ok: true, value: { assetId: POUR!.gapId as never } }),
    );
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={fixture('open')} />, { stock: { use }, dispatch }, { stockSearch });
    fireEvent.click(fix(3, 'stock').getByRole('button', { name: 'Find stock video' }));
    expect(stockSearch).toHaveBeenCalledWith({
      query: 'coffee pour close up',
      kind: 'video',
      orientation: 'portrait',
    });
    const results = await screen.findByRole('list', { name: 'Stock videos' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(6);
    expect(within(results).getAllByText('Pexels licence')).toHaveLength(4);
    expect(within(results).getByText('CC BY: credit needed')).toBeTruthy();
    expect(within(results).getByText('CC0')).toBeTruthy();
    expect(within(results).getByText('Author 2').getAttribute('translate')).toBe('no');
    expect(screen.getByText('Videos from Pexels')).toBeTruthy();

    fireEvent.click(within(results).getAllByRole('button', { name: 'Use it' })[1]!);
    await screen.findByText('Shot 3: stock video from Pexels');
    expect(use).toHaveBeenCalledWith({
      item: stockItem(2),
      projectId: fixture('open').projectId,
      timelineId: fixture('open').timelineId,
      gapId: POUR!.gapId,
    });
    // The import and the fill are the action's; the card dispatches nothing itself.
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText('Fixed 1 of 3 gaps')).toBeTruthy();
  });

  it('a failed import keeps the gap open with the cause and Retry, and nothing else is sent', async () => {
    const stockSearch = searchOf([stockItem(1)]);
    const use = vi
      .fn<NonNullable<CardActions['stock']>['use']>()
      .mockResolvedValueOnce(failed('library.stock_download_failed') as Result<never>)
      .mockResolvedValueOnce({ ok: true, value: { assetId: POUR!.gapId as never } });
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={fixture('open')} />, { stock: { use }, dispatch }, { stockSearch });
    fireEvent.click(fix(3, 'stock').getByRole('button', { name: 'Find stock video' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use it' }));
    const alert = await screen.findByRole('alert');
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByText('Shot 3: stock video from Pexels')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByText('Shot 3: stock video from Pexels');
    expect(use).toHaveBeenCalledTimes(2);
  });

  it('a refused search says why in one line (no key, Local only)', async () => {
    const stockSearch = vi.fn<NonNullable<CardData['stockSearch']>>(() =>
      Promise.resolve(failed('library.stock_no_key') as Result<never>),
    );
    wrap(<CardView card={fixture('open')} />, { stock: { use: vi.fn() } }, { stockSearch });
    fireEvent.click(fix(3, 'stock').getByRole('button', { name: 'Find stock video' }));
    expect(
      await within(gap(3).getByRole('list', { name: 'Ways to fill shot 3' })).findByText(
        'Stock video needs your Pexels key in Settings → Accounts.',
      ),
    ).toBeTruthy();
  });

  it('Drop this shot ripples, with Undo on the toast, and the gap folds', async () => {
    const dispatch = vi.fn(() => Promise.resolve(ok()));
    const undo = vi.fn(() => Promise.resolve(ok()));
    wrap(<CardView card={fixture('open')} />, { dispatch, undo });
    const before = toastStore.list().length;
    fireEvent.click(fix(7, 'drop').getByRole('button', { name: 'Drop this shot' }));
    await screen.findByText('Shot 7: dropped');
    expect(dispatch).toHaveBeenCalledWith('timeline.dropSlot', {
      projectId: fixture('open').projectId,
      timelineId: fixture('open').timelineId,
      itemId: STREET!.gapId,
      mode: 'ripple',
    });
    const shown = toastStore.list().slice(before);
    expect(shown.map((entry) => entry.title)).toEqual(['Shot 7 dropped']);
    act(() => shown[0]!.action!.onSelect());
    expect(undo).toHaveBeenCalledOnce();
  });

  it('a failed drop says why and offers Retry; the gap stays', async () => {
    const dispatch = vi.fn(() => Promise.resolve(failed('timeline.item_not_found')));
    wrap(<CardView card={fixture('open')} />, { dispatch });
    fireEvent.click(fix(7, 'drop').getByRole('button', { name: 'Drop this shot' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('Shot 7: dropped')).toBeNull();
  });

  it('says why a fix is not offered, one line each, with the settings page that clears it', () => {
    const navigate = vi.fn();
    wrap(<CardView card={fixture('open')} />, { navigate });
    expect(gap(7).getByText('Stock video needs your Pexels key in Settings → Accounts.')).toBeTruthy();
    expect(gap(9).getByText('Generating an image needs the internet, and Local only is on.')).toBeTruthy();
    expect(gap(9).getByText('Stock video needs the internet, and Local only is on.')).toBeTruthy();
    fireEvent.click(gap(7).getByRole('button', { name: 'Open Accounts' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'settings', section: 'accounts' });
  });

  it('folds fixed gaps to one line and counts them; all fixed is a success line', () => {
    wrap(<CardView card={fixture('partly')} />);
    expect(screen.getByText('Shot 3: filled')).toBeTruthy();
    expect(screen.getByText('Shot 7: dropped')).toBeTruthy();
    expect(screen.getByText('Fixed 2 of 3 gaps')).toBeTruthy();
    expect(screen.queryByText('Every gap is fixed.')).toBeNull();
  });

  it('all settled', () => {
    wrap(<CardView card={fixture('settled')} />);
    expect(screen.getByText('Fixed 2 of 2 gaps')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Every gap is fixed.');
  });

  it('a gap the timeline no longer has (a newer revision) folds to "already fixed"', () => {
    const moved: Timeline = { ...makeTimeline(), id: fixture('alreadyFixed').timelineId, revision: 5 };
    const data: CardData = { watchTimeline: (_id, onChange) => (onChange(moved), () => undefined) };
    wrap(<CardView card={fixture('alreadyFixed')} />, {}, data);
    expect(screen.getByText('Shot 3: already fixed')).toBeTruthy();
  });

  describe('asking', () => {
    const asking = (): CardOf<'gapFix'> => fixture('asking');

    it('is a decision card; choosing ticks gaps into the answer and the primary says what it costs', async () => {
      const decide = vi.fn(() => Promise.resolve(answered));
      wrap(<CardView card={asking()} />, { decide });
      const frame = screen.getByRole('heading', { name: '2 shots have no clip yet' }).closest('article')!;
      expect(frame.dataset.asking).toBe('');
      const go = screen.getByRole('button', { name: 'Fix 0 gaps' });
      expect(go.hasAttribute('disabled')).toBe(true);
      expect(screen.getByText('Choose at least one fix.')).toBeTruthy();

      fireEvent.click(fix(3, 'generate').getByRole('button', { name: 'Choose' }));
      fireEvent.click(fix(7, 'generate').getByRole('button', { name: 'Choose' }));
      expect(fix(3, 'generate').getByRole('button', { name: 'Chosen' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Generate 2 images · about $0.08' }));
      await screen.findByText('Fixing 2 gaps…');
      expect(decide).toHaveBeenCalledWith('ap-gaps', 'approve', {
        answer: {
          kind: 'gapFix',
          fixes: [
            { gapId: POUR!.gapId, fix: 'generate' },
            { gapId: STREET!.gapId, fix: 'generate' },
          ],
        },
      });
      // The answer went: the choices are read only.
      expect(fix(3, 'generate').getByRole('button', { name: 'Chosen' }).hasAttribute('disabled')).toBe(true);
    });

    it('a mix of fixes says how many gaps; choosing again un-ticks', async () => {
      const decide = vi.fn(() => Promise.resolve(answered));
      wrap(<CardView card={asking()} />, { decide });
      fireEvent.click(fix(3, 'stock').getByRole('button', { name: 'Choose' }));
      fireEvent.click(fix(7, 'drop').getByRole('button', { name: 'Choose' }));
      fireEvent.click(fix(7, 'film').getByRole('button', { name: 'Choose' }));
      fireEvent.click(fix(3, 'stock').getByRole('button', { name: 'Chosen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Fix 1 gap' }));
      await waitFor(() =>
        expect(decide).toHaveBeenCalledWith('ap-gaps', 'approve', {
          answer: { kind: 'gapFix', fixes: [{ gapId: STREET!.gapId, fix: 'film' }] },
        }),
      );
    });

    it('Not now sends an empty answer', async () => {
      const decide = vi.fn(() => Promise.resolve(answered));
      wrap(<CardView card={asking()} />, { decide });
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
      await screen.findByText('Leaving the gaps for now. Fix them any time in the editor.');
      expect(decide).toHaveBeenCalledWith('ap-gaps', 'approve', { answer: { kind: 'gapFix', fixes: [] } });
    });

    it('offers no direct actions while asking (no search, no drop)', () => {
      const dispatch = vi.fn();
      wrap(
        <CardView card={asking()} />,
        { decide: vi.fn(), dispatch, navigate: vi.fn() },
        { stockSearch: vi.fn() },
      );
      expect(screen.queryByRole('button', { name: 'Find stock video' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Drop this shot' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open on your phone' })).toBeNull();
    });
  });
});
