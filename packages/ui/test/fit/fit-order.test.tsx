// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-TPL: "Start from a template" ordered by fit. With sources and a host that can fit, a "Sort by" select sits over
 * the saved templates: Newest first, or the best fit for one source's clips, which reorders the saved rows (fitted
 * ones first, best first; the rest as they came) and says on each how well the clips fill it. A failed read says
 * why with Try again and leaves the list newest first; without sources or the reader there is no select.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { FitPool, FitTemplatesResult, SourceView } from '@taalcut/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardActionsProvider,
  CardDataProvider,
  OpeningChoices,
  type CardData,
  type TemplateChoice,
} from '../../src/index';
import { FITS, resultOf, SOURCE, SOURCE_2, sourceOf, templateId } from './fit-fixture';

const timeout = { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true };
type Reader = (pool: FitPool, limit: number) => Promise<FitTemplatesResult | { failed: typeof timeout }>;

/** Newest first, as templates.list gives them: Snow day, Night lights, Market walk, Chai at dawn. */
const SAVED: TemplateChoice[] = [4, 3, 2, 1].map((n) => ({
  kind: 'template',
  id: templateId(n),
  name: ['Chai at dawn', 'Market walk', 'Night lights', 'Snow day'][n - 1] ?? '',
  slotCount: 4,
  seconds: 10,
}));
const SOURCES: SourceView[] = [sourceOf(SOURCE, 'Goa trip', 2), sourceOf(SOURCE_2, 'Phone', 1)];

async function open(data: CardData) {
  render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider
        value={{ startFlow: vi.fn(async () => ({ ok: true as const, value: undefined })) }}
      >
        <CardDataProvider value={{ templateChoices: async () => SAVED, starters: async () => [], ...data }}>
          <OpeningChoices paths={['library', 'template']} unavailable={[]} hasSources />
        </CardDataProvider>
      </CardActionsProvider>
    </I18nProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Start from a template/ }));
  });
}

const names = () =>
  within(screen.getByRole('list', { name: 'Your templates' }))
    .getAllByRole('button')
    .map((row) => row.querySelector('[translate=no]')?.textContent);
const choose = (label: string) =>
  act(async () => {
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    const option = within(select).getByRole('option', { name: label });
    fireEvent.change(select, { target: { value: option.getAttribute('value') } });
  });

describe('the template picker ordered by fit', () => {
  it('starts newest first and offers the newest sources', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    await open({ sources: async () => SOURCES, fitTemplates: read });
    const select = screen.getByRole('combobox', { name: 'Sort by' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Newest first', 'Best fit for Goa trip', 'Best fit for Phone']);
    expect(names()).toEqual(['Snow day', 'Night lights', 'Market walk', 'Chai at dawn']);
    expect(read).not.toHaveBeenCalled();
  });

  it('best fit for a source reorders the saved templates and says how well each is filled', async () => {
    const read = vi.fn<Reader>(async () => resultOf(FITS));
    await open({ sources: async () => SOURCES, fitTemplates: read });
    await choose('Best fit for Goa trip');
    expect(read).toHaveBeenCalledWith({ sourceIds: [SOURCE] }, 50);
    expect(names()).toEqual(['Chai at dawn', 'Market walk', 'Night lights', 'Snow day']);
    const facts = [...document.querySelectorAll('[data-slot=fit-facts]')].map((node) => node.textContent);
    expect(facts).toEqual([
      '82% match · Fills all 4 slots',
      '53% match · Fills 3 of 4 slots',
      '26% match · Fills 2 of 5 slots',
      'Fills none of its 2 slots',
    ]);
    await choose('Newest first');
    expect(names()).toEqual(['Snow day', 'Night lights', 'Market walk', 'Chai at dawn']);
    expect(document.querySelector('[data-slot=fit-facts]')).toBeNull();
  });

  it('templates the fit left out keep their newest-first place after the fitted ones', async () => {
    await open({ sources: async () => SOURCES, fitTemplates: async () => resultOf(FITS.slice(1, 3)) });
    await choose('Best fit for Goa trip');
    expect(names()).toEqual(['Market walk', 'Night lights', 'Snow day', 'Chai at dawn']);
  });

  it('a failed read says why with Try again and leaves the list newest first', async () => {
    let failing = true;
    const read = vi.fn<Reader>(async () => (failing ? { failed: timeout } : resultOf(FITS)));
    await open({ sources: async () => SOURCES, fitTemplates: read });
    await choose('Best fit for Phone');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(names()).toEqual(['Snow day', 'Night lights', 'Market walk', 'Chai at dawn']);
    failing = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(read).toHaveBeenLastCalledWith({ sourceIds: [SOURCE_2] }, 50);
    expect(names()[0]).toBe('Chai at dawn');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no select without sources, or where the host cannot fit', async () => {
    await open({ sources: async () => [], fitTemplates: async () => resultOf(FITS) });
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
    cleanup();
    await open({ sources: async () => SOURCES });
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
  });
});
