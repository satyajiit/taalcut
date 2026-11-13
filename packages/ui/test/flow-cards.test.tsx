// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The flow cards' actions (P2-M13, P2-X1): what each button dispatches and answers, in which order, and
// what it doesn't do when a command fails. Money in and out through Intl.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { Card, CardOf } from '@taalcut/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CARD_FIXTURES,
  CardActionsProvider,
  CardDataProvider,
  CardView,
  ExportReview,
  OpeningChoices,
  OpeningStarters,
  moneyFieldText,
  moneyShape,
  parseMoneyText,
  type CardActions,
} from '../src/index';

// decide answers with how it went (UX round 1); these tests answer as the run would.
const answered = { ok: true as const, value: 'answered' as const };

const wrap = (node: ReactNode, actions: CardActions = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>{node}</CardActionsProvider>
    </I18nProvider>,
  );
const ok = { ok: true as const, value: undefined };
const failed = {
  ok: false as const,
  error: { code: 'core.timeout', messageKey: 'errors.core.timeout', params: {}, retryable: true },
};
const click = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('budget cap card', () => {
  const card = CARD_FIXTURES.budgetCap.pending! as Card;

  it('Raise: the person’s cap command first, then the approval', async () => {
    const order: string[] = [];
    const dispatch = vi.fn(async (name: string, _payload?: unknown) => (order.push(name), ok));
    const decide = vi.fn(async (_id: string, decision: string) => {
      order.push(`decide:${decision}`);
      return answered;
    });
    wrap(<CardView card={card} />, { dispatch, decide });
    fireEvent.change(screen.getByLabelText('Raise the cap to'), { target: { value: '3' } });
    await click('Raise and go on');
    expect(order).toEqual(['project.setBudgetCap', 'decide:approve']);
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({ cap: { currency: 'USD', micros: 3_000_000 } });
    expect(screen.getByText('Raised to $3.00')).toBeTruthy();
  });

  it('a cap command that fails sends no approval and says why', async () => {
    const decide = vi.fn();
    wrap(<CardView card={card} />, { dispatch: vi.fn(async () => failed), decide });
    fireEvent.change(screen.getByLabelText('Raise the cap to'), { target: { value: '3' } });
    await click('Raise and go on');
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('an amount at or under what is spent is refused before anything is sent', async () => {
    const dispatch = vi.fn(async () => ok);
    wrap(<CardView card={card} />, { dispatch, decide: vi.fn() });
    fireEvent.change(screen.getByLabelText('Raise the cap to'), { target: { value: '1' } });
    await click('Raise and go on');
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Enter more than');
  });

  it('a cheaper model is the same switch Settings makes, then the approval; Stop declines', async () => {
    const dispatch = vi.fn(async () => ok);
    const decide = vi.fn(async () => answered);
    const { unmount } = wrap(<CardView card={card} />, { dispatch, decide });
    // The free one on this Mac comes first; each "Use this" is described by its model's name.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Use this' })[0]!);
    });
    expect(dispatch).toHaveBeenCalledWith('models.setModuleOverride', {
      module: 'vision',
      override: { primary: { provider: 'on-device', model: 'qwen3.5-4b' } },
    });
    expect(decide).toHaveBeenCalledWith('ap-cap', 'approve');
    unmount();
    const stop = vi.fn(async () => answered);
    wrap(<CardView card={card} />, { dispatch, decide: stop });
    await click('Stop here');
    expect(stop).toHaveBeenCalledWith('ap-cap', 'deny');
  });
});

/** UX4 (B8): the approval is made on its review page; the preset is behind Options. */
function review(card: CardOf<'exportApproval'>, actions: CardActions) {
  wrap(<ExportReview card={card} onBack={vi.fn()} />, actions);
  fireEvent.click(screen.getByRole('button', { name: 'Options' }));
}

describe('export approval review page', () => {
  it('Export with another preset: the preset command, then the approval', async () => {
    const order: string[] = [];
    const dispatch = vi.fn(async (name: string, _payload?: unknown) => (order.push(name), ok));
    const decide = vi.fn(async (_id: string, decision: string) => {
      order.push(`decide:${decision}`);
      return answered;
    });
    review(CARD_FIXTURES.exportApproval.pending!, { dispatch, decide });
    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    await click('Export');
    expect(order).toEqual(['render.setExportPreset', 'decide:approve']);
  });

  it('a preset that fails to save exports nothing', async () => {
    const decide = vi.fn();
    review(CARD_FIXTURES.exportApproval.pending!, { dispatch: vi.fn(async () => failed), decide });
    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    await click('Export');
    expect(decide).not.toHaveBeenCalled();
  });

  it('while it updates after your change, Export waits', () => {
    review(CARD_FIXTURES.exportApproval.updating!, { decide: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Export' })?.hasAttribute('disabled') ?? true).toBe(true);
  });
});

describe('opening choices', () => {
  it('Use my library with sources starts the flow at once, with its sentence', async () => {
    const startFlow = vi.fn(async () => ok);
    wrap(
      <OpeningChoices paths={['library', 'reference', 'template', 'describe']} unavailable={[]} hasSources />,
      {
        startFlow,
      },
    );
    await click(/Use my library/);
    expect(startFlow).toHaveBeenCalledWith({ path: 'library' }, 'Make a video from my latest clips');
  });

  it('describe puts the caret in the composer; with no composer it asks here', async () => {
    const focusComposer = vi.fn();
    const { unmount } = wrap(<OpeningChoices paths={['describe']} unavailable={[]} hasSources />, {
      focusComposer,
      startFlow: vi.fn(async () => ok),
    });
    await click(/Just describe it/);
    expect(focusComposer).toHaveBeenCalled();
    unmount();
    const startFlow = vi.fn(async () => ok);
    wrap(<OpeningChoices paths={['describe']} unavailable={[]} hasSources />, { startFlow });
    await click(/Just describe it/);
    fireEvent.change(screen.getByLabelText('The video you want'), { target: { value: 'A reel of Goa' } });
    await click('Start');
    expect(startFlow).toHaveBeenCalledWith({ path: 'describe' }, 'A reel of Goa');
  });

  it('Local only turns the link off and keeps the file way in', async () => {
    wrap(
      <OpeningChoices
        paths={['reference']}
        unavailable={[{ path: 'reference', reasonKey: 'opening.reference.localOnly' }]}
        hasSources
      />,
      { startFlow: vi.fn(async () => ok), pickFile: vi.fn(async () => ({ ok: true as const, value: null })) },
    );
    await click(/Paste a reel/);
    expect((screen.getByLabelText('Link to a reel') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose a file…' }).hasAttribute('disabled')).toBe(false);
  });
});

describe('opening choices as tiles (UX1)', () => {
  const FOUR = ['library', 'reference', 'template', 'describe'] as const;
  /** The one element a selector finds; a missing one fails the test where it is asked for. */
  const one = <T extends Element = HTMLElement>(selector: string): T => {
    const found = document.querySelector<T>(selector);
    if (!found) throw new Error(`nothing matches ${selector}`);
    return found;
  };
  const tile = (path: string) => one<HTMLButtonElement>(`li[data-path="${path}"] > button`);

  it('the four ways are tiles in "Ways to start"; a way that opens a panel says so, a direct one does not', () => {
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources />, {
      startFlow: vi.fn(async () => ok),
      focusComposer: vi.fn(),
    });
    const list = screen.getByRole('list', { name: 'Ways to start' });
    expect(list.querySelectorAll('li[data-path] > button')).toHaveLength(4);
    expect(tile('reference').getAttribute('aria-expanded')).toBe('false');
    expect(tile('template').getAttribute('aria-expanded')).toBe('false');
    // With sources, the library starts at once; with a composer, describing is typed there.
    expect(tile('library').hasAttribute('aria-expanded')).toBe(false);
    expect(tile('describe').hasAttribute('aria-expanded')).toBe(false);
    // The name is everything the tile says, its words first; nothing describes it until a start fails.
    expect(screen.getByRole('button', { name: /^Paste a reel\s*Copy the cuts/ })).toBe(tile('reference'));
    expect(tile('reference').hasAttribute('aria-describedby')).toBe(false);
    // The drawings are decoration: hidden from assistive tech, one per tile.
    expect(document.querySelectorAll('[data-slot=opening-motif][aria-hidden]')).toHaveLength(4);
  });

  it('an open way’s panel is a row of its own right after its tile, which controls it', async () => {
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources />, { startFlow: vi.fn(async () => ok) });
    await click(/^Paste a reel/);
    const row = tile('reference').parentElement?.nextElementSibling ?? null;
    expect(row?.getAttribute('data-panel-for')).toBe('reference');
    expect(tile('reference').getAttribute('aria-expanded')).toBe('true');
    expect(tile('reference').getAttribute('data-state')).toBe('open');
    const panel = document.getElementById(tile('reference').getAttribute('aria-controls') ?? '');
    expect(panel !== null && row?.contains(panel)).toBe(true);
    expect(panel?.querySelector('input[type=url]')).toBeTruthy();
    // Choosing it again closes the row.
    await click(/^Paste a reel/);
    expect(document.querySelector('[data-panel-for]')).toBeNull();
  });

  it('a start that fails puts its cause in the tile’s row, named from the tile', async () => {
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources />, {
      startFlow: vi.fn(async () => failed),
    });
    await click(/^Use my library/);
    const row = one('[data-panel-for="library"]');
    expect(row.querySelector('[role=alert]')).toBeTruthy();
    expect(tile('library').getAttribute('data-state')).toBe('error');
    const described = document.getElementById(tile('library').getAttribute('aria-describedby') ?? '');
    expect(described !== null && row.contains(described)).toBe(true);
  });

  it('while a run goes every tile waits; a way that is off says why in place of its line', () => {
    const { unmount } = wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources busy />);
    expect(FOUR.every((path) => tile(path).disabled)).toBe(true);
    unmount();
    wrap(
      <OpeningChoices
        paths={FOUR}
        unavailable={[{ path: 'library', reasonKey: 'opening.library.empty' }]}
        hasSources={false}
      />,
    );
    expect(tile('library').disabled).toBe(true);
    expect(tile('library').textContent).toContain('Add a folder or your phone first.');
    expect(tile('reference').disabled).toBe(false);
  });

  it('an odd count (first run’s three) leads with a tile as wide as the row; an even count has none', () => {
    const { unmount } = wrap(
      <OpeningChoices paths={['template', 'reference', 'describe']} unavailable={[]} hasSources starters />,
    );
    expect(document.querySelector('li[data-path="template"]')?.hasAttribute('data-wide')).toBe(true);
    expect(document.querySelectorAll('li[data-wide]')).toHaveLength(1);
    unmount();
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources />);
    expect(document.querySelectorAll('li[data-wide]')).toHaveLength(0);
  });

  it('Use my library with nothing in it is still offered, and says it opens add a folder or the phone', async () => {
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources={false} />, {
      startFlow: vi.fn(async () => ok),
    });
    expect(tile('library').disabled).toBe(false);
    expect(tile('library').getAttribute('aria-expanded')).toBe('false');
    expect(tile('library').textContent).toContain(
      'Nothing in it yet. Add a folder or connect your phone first.',
    );
    // Its frames are drawn empty.
    expect(one('[data-motif=library]').hasAttribute('data-hollow')).toBe(true);
    await click(/^Use my library/);
    expect(one('[data-panel-for="library"]').textContent).toContain('Your library is empty.');
  });

  it('starters that fail to load are an error with Try again; none is an honest line, not "didn’t load"', async () => {
    let failing = true;
    const starters = vi.fn(async () => {
      if (failing) throw new Error('templates.not_found');
      return [];
    });
    render(
      <I18nProvider i18n={i18n}>
        <CardDataProvider value={{ starters }}>
          <OpeningStarters />
        </CardDataProvider>
      </I18nProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('The starters didn’t load.');
    failing = false;
    await click('Try again');
    expect(
      await screen.findByText('There are no starters yet. Paste a reel or describe your video instead.'),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(starters).toHaveBeenCalledTimes(2);
  });

  it('a way taken folds the tiles to its name and one line of the others', async () => {
    wrap(<OpeningChoices paths={FOUR} unavailable={[]} hasSources />, { startFlow: vi.fn(async () => ok) });
    await click(/^Use my library/);
    expect(screen.queryByRole('list', { name: 'Ways to start' })).toBeNull();
    expect(document.querySelector('[data-chosen="library"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paste a reel' }).closest('li')).toBeNull();
  });
});

describe('money in fields', () => {
  it('shows and reads amounts the language’s way', () => {
    expect(moneyFieldText({ currency: 'USD', micros: 2_500_000 }, 'en')).toBe('2.50');
    expect(moneyFieldText({ currency: 'EUR', micros: 2_500_000 }, 'de')).toBe('2,50');
    expect(parseMoneyText('$3', 'en', 'USD')).toBe(3_000_000);
    expect(parseMoneyText('2,75', 'de', 'EUR')).toBe(2_750_000);
    expect(parseMoneyText('2.75', 'de', 'EUR')).toBe(2_750_000);
    expect(parseMoneyText('abc', 'en', 'USD')).toBeNull();
    expect(parseMoneyText('1.234', 'en', 'USD')).toBeNull();
  });

  it('writes US dollars "US$" in Spanish and Portuguese, where "$" alone is their own money', () => {
    expect(moneyShape('pt-BR', 'USD')).toMatchObject({ symbol: 'US$', symbolFirst: true, decimal: ',' });
    expect(moneyShape('es', 'USD')).toMatchObject({ symbol: 'US$', symbolFirst: false });
    expect(moneyShape('en', 'USD').symbol).toBe('$');
    expect(parseMoneyText('US$ 2,50', 'pt-BR', 'USD')).toBe(2_500_000);
    expect(parseMoneyText('$3', 'pt-BR', 'USD')).toBe(3_000_000);
    expect(parseMoneyText('2,50 US$', 'es', 'USD')).toBe(2_500_000);
  });
});
