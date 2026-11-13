// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardOf, HubBrowseItem, TemplateId } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubResultsCard } from '../src/cards/hub-results-card';
import { HUB_RESULTS_FIXTURES } from '../src/cards/fixtures-hub';
import { CardActionsProvider, CardDataProvider, type CardActions, type CardData } from '../src/index';

const COPY = '01K7C5M6Q85000000000000F00' as TemplateId;

function fixture(name: string): CardOf<'hubResults'> {
  const card = HUB_RESULTS_FIXTURES[name];
  if (!card) throw new Error(`no fixture ${name}`);
  return card;
}

function wrap(card: CardOf<'hubResults'>, actions: CardActions = {}, data: CardData = {}) {
  return render(
    <I18nProvider i18n={i18n}>
      <CardActionsProvider value={actions}>
        <CardDataProvider value={data}>
          <HubResultsCard card={card} />
        </CardDataProvider>
      </CardActionsProvider>
    </I18nProvider>,
  );
}

const row = (name: string) => {
  const found = screen.getByText(name).closest('li');
  if (!found) throw new Error(`no row ${name}`);
  return found;
};

describe('the hub results card (U4)', () => {
  afterEach(() => i18n.activate('en'));

  it('shows ratings through Intl and "New" under three ratings', () => {
    wrap(fixture('results'));
    expect(
      within(row('Puppy first day')).getByRole('img', { name: 'Rated 4.8 out of 5 by 97 people' }),
    ).toBeTruthy();
    const fresh = row('Monsoon diaries').querySelector('[data-slot=hub-rating]');
    expect(fresh?.textContent).toBe('NewNew: fewer than 3 ratings');
    expect(fresh?.hasAttribute('aria-label')).toBe(false);
    act(() => i18n.loadAndActivate({ locale: 'pt-BR', messages: {} }));
    expect(row('Morning café').querySelector('[data-slot=hub-rating]')?.textContent).toContain('4,6');
  });

  it('keeps the author’s words untranslated', () => {
    wrap(fixture('results'));
    expect(screen.getByText('Morning café').getAttribute('translate')).toBe('no');
    expect(screen.getByText('@mira.cuts').getAttribute('translate')).toBe('no');
    expect(screen.getByText('café vlog').getAttribute('translate')).toBe('no');
  });

  it('forks into "In your templates", then Open goes to the copy', async () => {
    const navigate = vi.fn();
    const fork = vi.fn(async () => ({ ok: true as const, value: { templateId: COPY } }));
    wrap(fixture('results'), { navigate, hub: { fork, openShare: vi.fn() } });
    const cafe = row('Morning café');
    await act(async () =>
      fireEvent.click(within(cafe).getByRole('button', { name: 'Copy to my templates' })),
    );
    expect(fork).toHaveBeenCalledWith({
      hubId: '01K7C5M6Q8H000000000000001',
      version: 2,
      sha256: '6545c0e35dfe7b3b081422e270c2de70b150f8743be7c7ca6c4aa800829fdb84',
    });
    expect(within(cafe).getByRole('status').textContent).toBe('In your templates');
    fireEvent.click(within(cafe).getByRole('button', { name: 'Open' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'template', templateId: COPY });
  });

  it('a fork that fails says why under its row', async () => {
    const fork = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'hub.integrity', messageKey: 'errors.hub.integrity', retryable: true },
    }));
    wrap(fixture('results'), { hub: { fork, openShare: vi.fn() } });
    const puppy = row('Puppy first day');
    await act(async () =>
      fireEvent.click(within(puppy).getByRole('button', { name: 'Copy to my templates' })),
    );
    expect(within(puppy).getByRole('alert').getAttribute('data-error-code')).toBe('hub.integrity');
  });

  it('a template removed from the hub since says so, with Copy off', async () => {
    const hubItem = vi.fn(async (): Promise<HubBrowseItem | undefined> => undefined);
    wrap(fixture('removed'), { hub: { fork: vi.fn(), openShare: vi.fn() } }, { hubItem });
    expect(await screen.findByText('Removed from the hub')).toBeTruthy();
    expect(
      within(row('Viral dance trend'))
        .getByRole('button', { name: 'Copy to my templates' })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('opens rows and Show more in the hub; no results offers Show all; an error is its line', () => {
    const navigate = vi.fn();
    wrap(fixture('results'), { navigate });
    fireEvent.click(screen.getByRole('button', { name: 'Morning café' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'hub', hubId: '01K7C5M6Q8H000000000000001' });
    fireEvent.click(screen.getByRole('button', { name: 'Show more in the hub' }));
    expect(navigate).toHaveBeenCalledWith({ to: 'hub', query: 'café vlog' });
    const empty = wrap(fixture('empty'), { navigate });
    fireEvent.click(within(empty.container).getByRole('button', { name: 'Show all' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: 'hub' });
    const failed = wrap(fixture('error'));
    expect(within(failed.container).getByRole('alert').getAttribute('data-error-code')).toBe('hub.offline');
  });

  it('says how old the index is when it is over an hour old', () => {
    wrap(fixture('stale'));
    // Intl's words sit in a <time>, inside the sentence.
    const age = screen.getByText('3 hours ago');
    expect(age.tagName).toBe('TIME');
    expect(age.parentElement?.textContent).toBe('As of 3 hours ago');
  });
});
