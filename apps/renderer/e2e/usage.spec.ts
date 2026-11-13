// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// G8: Settings › Usage, the dashboard, in four views since UX4 (Overview, Breakdown, Budgets, Requests). Accessible
// in light and dark with three limits in force and on the states behind a click (the table, a filter, the empty,
// slow and failing reads); the pseudo-locale is clean; the period and filters live in the URL and travel between
// the views, and the request log asks the backend for them (round P3-3); Now follows the limits.
import { expect, test, type Page } from '@playwright/test';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';
import { watchWire, wireCalls } from './wire-watch.ts';

const USAGE = { name: 'settings-usage', path: '/settings/usage' };

async function loaded(page: Page) {
  await expect(page.locator('[data-slot=usage-totals]')).toBeVisible();
  await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
}

/** A view without the totals (Breakdown, Requests): its filter bar is there and nothing is busy. */
async function settled(page: Page) {
  await expect(page.locator('[data-slot=usage-filters]')).toBeVisible();
  await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
}

/** One of Usage's views, by its link in the views row. */
const view = (page: Page, name: string) =>
  page.locator('[data-slot=settings-views]').getByRole('link', { name, exact: true });

for (const theme of ['light', 'dark'] as const) {
  test(`Usage in ${theme}: accessible with limits, as a table and filtered`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { limits: 'three' });
    await open(page, USAGE);
    await loaded(page);
    await expect(page.getByRole('list', { name: 'Limits in force' }).getByRole('listitem')).toHaveCount(3);
    await expectAccessible(page, testInfo, `usage (${theme})`);
    await shoot(page, `usage-dashboard-${theme}`);

    // The chart, focused: the day under the keyboard has its tooltip.
    await page.locator('[data-slot=spend-chart]').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-slot=spend-tooltip]')).toBeVisible();
    await expectAccessible(page, testInfo, `usage chart focused (${theme})`);

    await page.getByRole('button', { name: 'Show as table' }).click();
    await expect(page.getByRole('region', { name: 'Spend by day, as a table' })).toBeVisible();
    await expectAccessible(page, testInfo, `usage as a table (${theme})`);

    // Where it went is its own view; a name there filters all of Usage.
    await view(page, 'Breakdown').click();
    await expect(page).toHaveURL(/\/settings\/usage\/breakdown$/);
    await settled(page);
    await expectAccessible(page, testInfo, `usage breakdown (${theme})`);
    await page
      .getByRole('region', { name: 'Spend by job' })
      .getByRole('button', { name: 'Seeing your clips' })
      .click();
    await expect(page).toHaveURL(/\/settings\/usage\/breakdown\?module=vision$/);
    await settled(page);
    await expectAccessible(page, testInfo, `usage filtered (${theme})`);
    // The filter comes along to the overview.
    await view(page, 'Overview').click();
    await expect(page).toHaveURL(/\/settings\/usage\?module=vision$/);
    await loaded(page);

    await view(page, 'Budgets').click();
    await expect(page.getByRole('list', { name: 'Project budgets' })).toBeVisible();
    await expectAccessible(page, testInfo, `usage budgets (${theme})`);
    await view(page, 'Requests').click();
    await expect(page.getByRole('region', { name: 'Requests' })).toBeVisible();
    await settled(page);
    await expectAccessible(page, testInfo, `usage requests (${theme})`);
  });

  test(`Usage states in ${theme}: empty, slow and failing`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { usage: 'empty' });
    await page.goto(USAGE.path);
    await expect(page.getByRole('heading', { name: 'Nothing has used a model yet' })).toBeVisible();
    await expectAccessible(page, testInfo, `usage empty (${theme})`);
    await shoot(page, `usage-empty-${theme}`);

    await fakes(page, { usage: 'slow' });
    await page.goto(USAGE.path);
    await expect(page.locator('[data-boneyard=settings-usage][aria-busy=true]')).toBeVisible();
    await expect(page.locator('[data-slot=usage-totals]')).toBeVisible();

    await fakes(page, { usage: 'failing' });
    await page.goto(USAGE.path);
    await expect(page.getByRole('alert').filter({ hasText: 'took too long' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
    await expectAccessible(page, testInfo, `usage failing (${theme})`);
  });
}

test('the period and the filters are the URL; the default period stays out of it', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, USAGE);
  await loaded(page);
  await page.getByRole('radio', { name: '7 days' }).click();
  await expect(page).toHaveURL(/\/settings\/usage\?period=7d$/);
  await expect(page.locator('[data-slot=spend-chart] [data-day]')).toHaveCount(7);
  // The filters are pills with a menu, as the library's are (UX1, M11).
  const filters = page.locator('[data-slot=usage-filters]');
  await filters.getByRole('button', { name: 'Provider' }).click();
  await page.getByRole('menuitemradio', { name: 'Google' }).click();
  await expect(page).toHaveURL(/period=7d&provider=google$/);
  // A reload keeps the view.
  await page.reload();
  await loaded(page);
  await expect(page.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true');
  await expect(filters.getByRole('button', { name: 'Google' })).toHaveAttribute('data-set', 'true');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('radio', { name: '30 days' }).click();
  await expect(page).toHaveURL(/\/settings\/usage$/);
});

test('the request log asks usage.list for the view: the period, its end, the provider and the project', async ({
  page,
}) => {
  const LIST = '/usage/list';
  type Asked = { limit?: number; from?: number; before?: number; provider?: string; projectId?: string };
  await watchWire(page, [LIST]);
  await preferences(page, { theme: 'light', locale: 'en' });
  await page.goto('/settings/usage/requests?period=7d&provider=openai');
  await settled(page);
  const pages = async () => (await wireCalls<Asked>(page, LIST)).filter((input) => input.limit === 50);
  await expect.poll(pages).toContainEqual(expect.objectContaining({ provider: 'openai' }));
  const first = (await pages()).find((input) => input.provider === 'openai');
  // Seven whole local days up to now: from that midnight to the moment the page was read.
  expect(first?.from).toBeGreaterThan(Date.now() - 8 * 86_400_000);
  expect(first?.from).toBeLessThan(Date.now() - 6 * 86_400_000);
  expect(first?.before).toBeGreaterThan(first?.from ?? Infinity);

  // A project row in Breakdown narrows the log the same way, in the backend.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await view(page, 'Breakdown').click();
  const projects = page.getByRole('region', { name: 'Spend by project' });
  await projects.getByRole('button', { name: 'Golden hour market' }).click();
  await expect(page).toHaveURL(/project=/);
  const project = new URL(page.url()).searchParams.get('project');
  await view(page, 'Requests').click();
  await expect(page).toHaveURL(/\/settings\/usage\/requests\?/);
  await expect.poll(pages).toContainEqual(expect.objectContaining({ projectId: project }));
  expect((await pages()).at(-1)).not.toHaveProperty('provider');
});

test('Now: Use this Mac instead moves the job, and Undo brings it back', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { limits: 'one' });
  await open(page, USAGE);
  await loaded(page);
  const now = page.getByRole('list', { name: 'Limits in force' });
  await now.getByRole('button', { name: 'Use this Mac instead' }).click();
  await expect(page.getByText('Agent runs on this Mac now', { exact: true })).toBeVisible();
  // The agent already runs here: nothing more to offer.
  await expect(now.getByRole('button', { name: 'Use this Mac instead' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(now.getByRole('button', { name: 'Use this Mac instead' })).toBeVisible();
});

test('the pseudo-locale: the dashboard, its limits and its table translated, nothing clipped', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await fakes(page, { limits: 'three' });
  await open(page, USAGE);
  await expect(page.locator('[data-slot=usage-totals]')).toBeVisible();
  await expectPseudoClean(page, 'usage');
  await page.locator('[data-slot=show-as-table]').click();
  await expectPseudoClean(page, 'usage as a table');
  for (const path of ['breakdown', 'budgets', 'requests'] as const) {
    await page.goto(`/settings/usage/${path}`);
    await expect(page.locator('[data-slot=settings-views]')).toBeVisible();
    await expect(page.locator('[aria-busy=true]')).toHaveCount(0);
    // The views' current pill slides to its link as the page turns: measure once it has landed, not mid-slide.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await expectPseudoClean(page, `usage ${path}`);
  }
});
