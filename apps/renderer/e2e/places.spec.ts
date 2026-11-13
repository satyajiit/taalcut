// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-PLACE "Done when", on the fake: a clip with coordinates says its city on its page, with the trip it is in; a
// clip without says the city it borrowed or the countries its time zone names, always as a guess; the grid shows the
// trip's band above its first day, its clips at the trip's own time, and the trip can be renamed and the rename
// undone; searching "Portugal" finds the trip's clips; About credits GeoNames. Saved in light and dark
// (TAALCUT_PLACE_SCREENS, else e2e-artifacts/screenshots/place/), axe-clean in both.
import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { PLACE_CLIPS } from './place-clips.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SHOTS = process.env.TAALCUT_PLACE_SCREENS ?? new URL('screenshots/place/', ARTIFACTS).pathname;
const LIBRARY = { name: 'library', path: '/library' };

const where = (page: Page) =>
  page.locator('[data-slot=clip-facts-group]').filter({
    has: page.getByRole('heading', { level: 3, name: 'When and where' }),
  });
const band = (page: Page) => page.locator('[data-slot=clip-trip-band]').first();
const toast = (page: Page) => page.locator('[data-slot=toast]').last();

async function shoot(target: Locator, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: `${SHOTS.replace(/\/?$/, '/')}${name}.png`, animations: 'disabled' });
}

async function clip(page: Page, id: string): Promise<void> {
  await open(page, { name: 'library-asset', path: `/library/${id}` });
  await expect(where(page)).toBeVisible();
}

/** Scrolls the grid down until the first trip's band is drawn (the grid draws the rows on screen only). */
async function scrollToTrip(page: Page): Promise<void> {
  const scroller = page.locator('[data-slot=scroll-area]').first();
  await expect
    .poll(
      async () => {
        if ((await band(page).count()) === 0) await scroller.evaluate((el) => el.scrollBy(0, 700));
        return band(page).count();
      },
      { timeout: 30_000, intervals: [60] },
    )
    .toBeGreaterThan(0);
  await band(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`places and trips (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
    });

    test('a clip with coordinates names its city, its country and its trip', async ({ page }, testInfo) => {
      await clip(page, PLACE_CLIPS.lisbon);
      const facts = where(page);
      await expect(facts).toContainText('Lisbon');
      await expect(facts).toContainText('Portugal');
      await expect(facts).toContainText('38.722° N, 9.139° W');
      await expect(facts).toContainText('Portugal · Sep 2026');
      await expect(facts).toContainText(/\d+ days · \d+ clips/);
      await shoot(facts, `place-row-gps-${theme}`);
      await expectAccessible(page, testInfo, `clip page, a place from coordinates (${theme})`);
    });

    test('a clip without names a guess: near a city, a neighbour’s city, a time zone’s countries', async ({
      page,
    }) => {
      await clip(page, PLACE_CLIPS.nearCascais);
      await expect(where(page)).toContainText('Near Cascais');
      await clip(page, PLACE_CLIPS.borrowed);
      await expect(where(page)).toContainText('Probably Sintra');
      await expect(where(page)).toContainText(/From a clip filmed .+ apart/);
      await shoot(where(page), `place-row-nearby-${theme}`);
      await clip(page, PLACE_CLIPS.zone);
      await expect(where(page)).toContainText('Probably Nigeria, United Kingdom, or Angola');
      await expect(where(page)).toContainText('From the time zone of a clip filmed nearby, UTC+1');
      await shoot(where(page), `place-row-zone-${theme}`);
      await clip(page, PLACE_CLIPS.hinted);
      await expect(where(page)).toContainText('Trip · Jun 2026');
      await expect(where(page)).toContainText('Probably Brazil, Argentina, or Paraguay');
      await expect(where(page)).toContainText('From the phone’s time zone, UTC−3');
      await shoot(where(page), `place-row-hinted-trip-${theme}`);
    });

    test('the grid shows a trip’s band above its first day; Rename names it, Undo takes it back', async ({
      page,
    }, testInfo) => {
      await open(page, LIBRARY);
      await scrollToTrip(page);
      const heading = band(page).getByRole('heading', { level: 2 });
      await expect(heading).toHaveText('Portugal · Sep 2026');
      await expect(band(page)).toContainText(/4 days · \d+ clips/);
      // The band sits above the day's own heading, in the same section.
      const day = page.locator('[data-slot=clip-day]').filter({ has: band(page) });
      await expect(day.locator('[data-slot=clip-day-heading] h2')).toHaveText('Tuesday, Sep 15');
      // Its clips are told at Lisbon's time, as their day is: the last of the day was shot at 18:23 UTC.
      await expect(day.locator('[data-slot=clip-tile]').first()).toContainText('7:23 PM');
      await shoot(day, `trip-heading-${theme}`);
      await expectAccessible(page, testInfo, `library, a trip's band (${theme})`);

      await band(page).getByRole('button', { name: 'Rename…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename the trip' });
      await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Portugal · Sep 2026');
      await dialog.getByRole('textbox', { name: 'Name' }).fill('Lisbon with Ana');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(toast(page)).toContainText('Renamed to Lisbon with Ana');
      await expect(heading).toHaveText('Lisbon with Ana');
      if (theme === 'light') await shoot(day, 'trip-heading-renamed-light');
      await toast(page).getByRole('button', { name: 'Undo' }).click();
      await expect(heading).toHaveText('Portugal · Sep 2026');
    });

    test('search finds a trip’s clips by its country', async ({ page }) => {
      await open(page, LIBRARY);
      const field = page.getByRole('searchbox', { name: 'Search your clips' });
      await field.fill('Portugal');
      await field.press('Enter');
      await expect(page).toHaveURL(/q=Portugal/);
      await expect(page.locator('[data-slot=search-hit]').first()).toBeVisible();
    });
  });
}

test('About credits GeoNames for the place names', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'settings-about', path: '/settings/about' });
  const row = page.getByRole('list', { name: 'Licences' }).locator('li[data-component="geonames"]');
  await expect(row).toContainText('GeoNames');
  await expect(row).toContainText('CC-BY-4.0');
  await expect(row).toContainText('geonames.org');
});
