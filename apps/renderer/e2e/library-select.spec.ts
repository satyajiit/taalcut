// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 lib: the Library's grid by day, picking clips, the bar of picks and the tiles' own actions.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

async function fakeLibrary(page: Page, options: Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify(options),
  });
}

const LIBRARY = { name: 'library', path: '/library' };
const tiles = (page: Page) => page.locator('[data-slot=clip-tile]');
const boxes = (page: Page) => page.locator('[data-slot=clip-tile-box]');
const headings = (page: Page) => page.locator('[data-slot=clip-day-heading] h2');
const bar = (page: Page) => page.locator('[data-slot=bulk-bar]');

test.describe('the Library by day', () => {
  test('clips sit under their day, newest first; sorted by length there are no days', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    await expect(headings(page).first()).toBeVisible();
    expect(await headings(page).count()).toBeGreaterThan(1);
    // Each day is a labelled group, its clips a list of their own with their place in it.
    const day = page.locator('[data-slot=clip-day]').first();
    await expect(day).toHaveAttribute('aria-labelledby', /.+/);
    await expect(day.locator('li[data-index]').first()).toHaveAttribute('aria-posinset', '1');

    await page.goto('/library?sort=duration');
    await expect(tiles(page).first()).toBeVisible();
    await expect(headings(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('the day heading stays at the top while its clips scroll under it', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    await expect(headings(page).first()).toBeVisible();
    await page.locator('[data-slot=scroll-area]').evaluate((scroller) => (scroller.scrollTop = 1600));
    // Once the rows at that scroll have rendered, one day's heading sits at the scroll area's top edge.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.querySelector('[data-slot=scroll-area]')!.getBoundingClientRect();
          return [...document.querySelectorAll('[data-slot=clip-day-heading]')].some(
            (heading) => Math.abs(heading.getBoundingClientRect().top - scroller.top) < 2,
          );
        }),
      )
      .toBe(true);
  });
});

test.describe('picking clips', () => {
  test('a box picks a clip, Shift picks a range, and the bar makes a video with them', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    await expect(bar(page)).toHaveCount(0);

    // The box shows when the tile is pointed at; ticking it starts picking.
    await boxes(page).nth(0).hover();
    const box = boxes(page).nth(0).getByRole('checkbox');
    await expect(box).toHaveAccessibleName(/^Select /);
    await box.click();
    await expect(box).toBeChecked();
    await expect(bar(page)).toContainText('1 clip selected');

    // Shift with a click picks every clip from the last one ticked; while picking, a plain click picks too.
    await tiles(page).nth(3).click({ modifiers: ['Shift'] });
    await expect(bar(page)).toContainText('4 clips selected');
    await tiles(page).nth(5).click();
    await expect(bar(page)).toContainText('5 clips selected');
    await expect(boxes(page).nth(5)).toHaveAttribute('data-picked', 'true');
    await expectAccessible(page, testInfo, 'library, picking');

    // Escape lets them go; picking again and Make a video with these opens a chat with them in its composer.
    await tiles(page).nth(5).focus();
    await page.keyboard.press('Escape');
    await expect(bar(page)).toHaveCount(0);
    await tiles(page).nth(1).focus();
    await page.keyboard.press('Space');
    await expect(bar(page)).toContainText('1 clip selected');
    await bar(page).getByRole('button', { name: 'Make a video with these' }).click();
    await expect(page).toHaveURL(/\/chat\//);
    await expect(page.getByRole('textbox').first()).toHaveValue(/^Make a short video with my clip/);
    expect(problems).toEqual([]);
  });

  test('a day’s box picks the whole day', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    const day = page.locator('[data-slot=clip-day]').nth(1);
    await day.hover();
    const count = await day.locator('li[data-index]').count();
    await day.getByRole('checkbox', { name: 'Select day' }).click();
    await expect(bar(page)).toContainText(count === 1 ? '1 clip selected' : `${count} clips selected`);
    await expect(day.getByRole('checkbox', { name: 'Select day' })).toBeChecked();
    await bar(page).getByRole('button', { name: 'Done' }).click();
    await expect(bar(page)).toHaveCount(0);
  });
});

test.describe('a tile’s own actions', () => {
  test('pointed at or reached by Tab: Open, and the box, each named for its clip', async ({ page }) => {
    await fakeLibrary(page, { indexingTickMs: 0 });
    await open(page, LIBRARY);
    // Nothing but the frame until it is pointed at.
    await expect(page.locator('[data-slot=clip-select]')).toHaveCount(0);
    await tiles(page).first().focus();
    // Focus within the tile brings its controls; Tab reaches them after the clip.
    await expect(boxes(page).first().locator('[data-slot=clip-select]')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('role', 'checkbox');
    const openButton = boxes(page).first().getByRole('button', { name: 'Open' });
    await openButton.focus();
    await openButton.press('Enter');
    await expect(page).toHaveURL(/\/library\/[0-9A-Z]{26}$/);
  });
});
