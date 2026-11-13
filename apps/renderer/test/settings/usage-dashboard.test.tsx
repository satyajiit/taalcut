// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// G8: Settings › Usage on the fake backend: the period and filters in the URL (and across its views, UX4), Now with
// zero, one and three limits (live), the totals, the spend chart and its table twin, the breakdown tables as
// filters, and the empty, loading and error states.
import { MODEL_COMMANDS } from '@taalcut/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeBackendOptions } from '../../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT } from '../../src/backend/fake/make/ids';
import { activateLocale } from '../../src/i18n/i18n';
import type { Locale } from '../../src/i18n/locales';
import { renderApp } from '../render-app';

type Options = Pick<FakeBackendOptions, 'usageHistory' | 'usageMode' | 'phase3'>;

/** The app at `path` with a month of usage (as the preview has it) unless told otherwise. */
const renderUsage = (path: string, options: Options = {}, locale: Locale = 'en') =>
  renderApp(path, { usageHistory: true, ...options }, locale);

const search = (router: Awaited<ReturnType<typeof renderUsage>>['router']) => router.state.location.search;
const totals = () =>
  screen.findByText('Spent', { selector: 'dt' }).then((dt) => dt.closest('dl') as HTMLElement);
const days = () => document.querySelectorAll('[data-slot=spend-chart] [data-day]');
/** The filter bar above the numbers. */
const filters = () =>
  within(document.querySelector<HTMLElement>('[data-slot=usage-filters]') ?? document.body);

describe('Settings › Usage dashboard (G8)', () => {
  it('opens on 30 days with the period out of the URL, and each period changes the view and the URL', async () => {
    const { router } = await renderUsage('/settings/usage');
    await totals();
    expect(search(router)).toEqual({});
    expect(screen.getByRole('radio', { name: '30 days' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(days()).toHaveLength(30));

    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(search(router)).toEqual({ period: '7d' }));
    await waitFor(() => expect(days()).toHaveLength(7));

    fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
    await waitFor(() => expect(search(router)).toEqual({ period: 'month' }));
    await waitFor(() => expect(days()).toHaveLength(new Date().getDate()));

    // All time starts at the first day anything called a model, not 400 empty days earlier.
    fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
    await waitFor(() => expect(search(router)).toEqual({ period: 'all' }));
    await waitFor(() => expect(days().length).toBeGreaterThan(28));
    expect(days().length).toBeLessThan(40);

    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));
    await waitFor(() => expect(search(router)).toEqual({}));
  });

  it('a malformed link opens the default view instead of failing', async () => {
    const { router } = await renderUsage('/settings/usage?period=year&module=nope&project=x&provider=%20');
    await totals();
    expect(search(router)).toEqual({});
  });

  it('the totals: spend, requests and how many ran here, bytes sent, and the units that aren’t tokens', async () => {
    await renderUsage('/settings/usage');
    const strip = await totals();
    expect(within(strip).getByText('Requests')).toBeTruthy();
    expect(within(strip).getByText(/on this Mac, free/)).toBeTruthy();
    expect(within(strip).getByText('Sent from this Mac')).toBeTruthy();
    expect(within(strip).getByText(/characters$/)).toBeTruthy();
    expect(within(strip).getByText(/seconds of audio$/)).toBeTruthy();
    expect(within(strip).getByText(/images?$/)).toBeTruthy();
  });

  it('filters: Show, a job row, a provider row and a project row each narrow Usage and land in the URL', async () => {
    const { router } = await renderUsage('/settings/usage/breakdown');
    await screen.findByRole('region', { name: 'Spend by job' });
    // The Job pill: a menu of the jobs, as the library's filters are (UX1, M11).
    fireEvent.keyDown(filters().getByRole('button', { name: 'Job' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Seeing your clips' }));
    await waitFor(() => expect(search(router)).toEqual({ module: 'vision' }));
    expect(filters().getByRole('button', { name: 'Seeing your clips' }).getAttribute('data-set')).toBe(
      'true',
    );
    const jobs = await screen.findByRole('region', { name: 'Spend by job' });
    await waitFor(() => expect(within(jobs).getAllByRole('row')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(search(router)).toEqual({}));

    const providers = screen.getByRole('region', { name: 'Spend by provider' });
    await waitFor(() => within(providers).getByRole('button', { name: /Google/ }));
    fireEvent.click(within(providers).getByRole('button', { name: /Google/ }));
    await waitFor(() => expect(search(router)).toEqual({ provider: 'google' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Spend by provider' })).getAllByRole('row'),
      ).toHaveLength(2),
    );
    expect(
      within(screen.getByRole('region', { name: 'Spend by provider' }))
        .getByRole('button', { name: /Google/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    const projects = screen.getByRole('region', { name: 'Spend by project' });
    await waitFor(() => within(projects).getByRole('button', { name: 'Golden hour market' }));
    fireEvent.click(within(projects).getByRole('button', { name: 'Golden hour market' }));
    await waitFor(() => expect(search(router)).toEqual({ project: GOLDEN_PROJECT }));
    // The filter comes along to the other views (UX4): on the overview, one project's budget, all time, sits
    // above the chart.
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/usage'));
    expect(search(router)).toEqual({ project: GOLDEN_PROJECT });
    const budget = await screen.findByText('This project’s budget, all time');
    await waitFor(() => expect(within(budget.parentElement as HTMLElement).getByRole('meter')).toBeTruthy());
  });

  it('the job in the accent follows the legend; the chart has a table twin, and Show as table shows it', async () => {
    await renderUsage('/settings/usage');
    await totals();
    const legend = await screen.findByRole('group', { name: 'Highlight a job' });
    const chips = within(legend).getAllByRole('button');
    // The biggest spender leads.
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true');
    const images = within(legend).getByRole('button', { name: 'Image making' });
    fireEvent.click(images);
    expect(images.getAttribute('aria-pressed')).toBe('true');
    const emphasised = document.querySelectorAll('[data-slot=spend-chart] [data-part].bg-primary-strong');
    expect([...emphasised].every((part) => part.getAttribute('data-part') === 'images')).toBe(true);
    // A second press takes the accent away.
    fireEvent.click(images);
    expect(document.querySelectorAll('[data-slot=spend-chart] .bg-primary-strong')).toHaveLength(0);

    // The twin is always there for screen readers.
    const twin = screen.getByRole('table', { name: 'Spend by day, newest first' });
    expect(twin.closest('.sr-only')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const shown = await screen.findByRole('region', { name: 'Spend by day, as a table' });
    expect(shown.closest('.sr-only')).toBeNull();
    expect(document.querySelector('[data-slot=spend-chart]')).toBeNull();
    const dayRows = within(shown).getAllByRole('row').length - 1;
    expect(dayRows).toBeGreaterThan(20);
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }));
    expect(document.querySelector('[data-slot=spend-chart]')).not.toBeNull();
  });

  it('the chart reads by keyboard: arrows move the day and say it', async () => {
    await renderUsage('/settings/usage?period=7d');
    await totals();
    const chart = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot=spend-chart]');
      if (!found) throw new Error('no chart yet');
      return found;
    });
    act(() => chart.focus());
    const live = document.getElementById(chart.getAttribute('aria-describedby') ?? '') as HTMLElement;
    await waitFor(() => expect(live.textContent).toMatch(/requests?\.$/));
    const last = live.textContent;
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    await waitFor(() => expect(live.textContent).not.toBe(last));
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(document.querySelector('[data-day].bg-hover\\/70')).toBe(days()[0]);
    fireEvent.keyDown(chart, { key: 'Escape' });
    expect(live.textContent).toBe('');
  });

  it('Now: nothing without limits; one; three with Add credit; live as they change', async () => {
    const { controls } = await renderUsage('/settings/usage');
    await totals();
    expect(screen.queryByRole('heading', { name: 'Now' })).toBeNull();

    act(() =>
      controls.phase3.limits.set([
        {
          provider: 'openai-codex',
          modules: ['agent'],
          kind: 'plan',
          since: Date.now() - 60_000,
          resetsAt: Date.now() + 20 * 60_000,
          waiting: ['run'],
        },
      ]),
    );
    const now = await screen.findByRole('list', { name: 'Limits in force' });
    expect(within(now).getByText(/ChatGPT plan is busy\./)).toBeTruthy();
    expect(within(now).getByText('in 20 minutes')).toBeTruthy();
    expect(within(now).getByText('A chat is waiting. It carries on by itself.')).toBeTruthy();

    act(() => controls.phase3.limits.set([]));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Limits in force' })).toBeNull());
  });

  it('three limits: the reset time, no reset time, and a quota with its billing page', async () => {
    await renderUsage('/settings/usage', { phase3: { limits: 'three' } });
    const now = await screen.findByRole('list', { name: 'Limits in force' });
    expect(within(now).getAllByRole('listitem')).toHaveLength(3);
    expect(within(now).getByText(/Your OpenAI key is out of credit\./)).toBeTruthy();
    const credit = within(now).getByRole('link', { name: /Add credit/ });
    expect(credit.getAttribute('href')).toBe('https://platform.openai.com/settings/organization/billing');
    expect(credit.getAttribute('target')).toBe('_blank');
    expect(within(now).getByText(/Resets around/)).toBeTruthy();
  });

  it('Use this Mac instead: the job’s local model, as the person, and Undo puts it back', async () => {
    const { controls } = await renderUsage('/settings/usage', { phase3: { limits: 'one' } });
    const now = await screen.findByRole('list', { name: 'Limits in force' });
    const move = await within(now).findByRole('button', { name: 'Use this Mac instead' });
    await act(async () => {
      fireEvent.click(move);
    });
    await waitFor(() =>
      expect(controls.dispatched.at(-1)).toEqual({ name: MODEL_COMMANDS.setModuleOverride, source: 'ui' }),
    );
    const agent = controls.models.watch.get().modules.find((m) => m.module === 'agent');
    expect(agent?.override?.primary?.provider).toBe('on-device');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    });
    await waitFor(() =>
      expect(
        controls.models.watch.get().modules.find((m) => m.module === 'agent')?.override?.primary,
      ).toBeUndefined(),
    );
  });

  it('empty: nothing ever used a model', async () => {
    await renderUsage('/settings/usage', { usageMode: 'empty' });
    expect(await screen.findByRole('heading', { name: 'Nothing has used a model yet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start a chat' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Period' })).toBeNull();
    // Budgets stay a view away: a cap can be set before anything is spent.
    expect(screen.getByRole('link', { name: 'Budgets' })).toBeTruthy();
  });

  it('loading: bones only once the answer is slow, then the numbers', async () => {
    await renderUsage('/settings/usage', { usageMode: 'slow' });
    const bones = () => document.querySelector('[data-boneyard=settings-usage][aria-busy=true]');
    expect(bones()).toBeNull();
    await waitFor(() => expect(bones()).not.toBeNull(), { timeout: 1_200 });
    // The filters keep their place before and after the numbers come (UX1, M11).
    const job = filters().getByRole('button', { name: 'Job' });
    await screen.findByText('Spent', { selector: 'dt' }, { timeout: 3_000 });
    expect(bones()).toBeNull();
    expect(filters().getByRole('button', { name: 'Job' })).toBe(job);
  });

  it('error: the cause in words and Try again', async () => {
    await renderUsage('/settings/usage', { usageMode: 'failing' });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => /took too long/.test(alert.textContent ?? ''))).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('nothing on the page animates position or size (reduced motion has nothing to undo)', async () => {
    await renderUsage('/settings/usage');
    await totals();
    const main = document.querySelector('main') ?? document.body;
    const moving = [...main.querySelectorAll('[class*="animate-"], [class*="transition-[transform"]')].filter(
      (el) => !el.closest('[role=radiogroup]'),
    );
    expect(moving).toHaveLength(0);
  });

  it('formats money and dates the language’s way (Brazilian Portuguese)', async () => {
    // The app's own language setting says pt-BR too, or LocaleSync would switch the page back to English.
    await renderUsage('/settings/usage?period=7d', { phase3: { locale: { preference: 'pt-BR' } } }, 'pt-BR');
    const strip = await screen.findByText((_, el) => el?.getAttribute('data-slot') === 'usage-totals');
    const value = within(strip).getAllByText(/US\$|R\$|\$/)[0]?.textContent ?? '';
    expect(value).toMatch(/^US\$\s?\d+,\d{2}$/);
    const tick = document.querySelector('[data-slot=spend-chart] ~ * time, time[datetime]');
    expect(tick?.textContent).toBeTruthy();
    await activateLocale('en');
  });
});
