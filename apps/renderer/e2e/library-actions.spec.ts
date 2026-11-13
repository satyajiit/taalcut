// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-FIND in the window, against the fake library (src/backend/fake/library/fake-actions.ts, fake-places.ts): the
// Activity pill lists what people in the clips are doing, the Trip pill place's trips, the Place pill the countries
// and their cities; each narrows the grid through the URL, and Clear filters lets them go. With nothing to offer a
// pill stays and its menu says how it fills (the toolbar holds still: library.spec.ts). The clip page's summary
// shows the actions in rose beside the people, a free one as the model wrote it. Both themes are scanned and
// photographed; the pseudo-locale leaves no English and clips nothing.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';
import { axeFor } from './axe.ts';
import { expectAccessible, expectPseudoClean } from './ui2b-support.ts';

const SCREENS = process.env.TAALCUT_FIND_SCREENS ?? new URL('screenshots/find/', ARTIFACTS).pathname;
const LIBRARY = { name: 'library', path: '/library' };

const tiles = (page: Page) => page.locator('[data-slot=clip-tile]');
const activity = (page: Page) =>
  page.locator('[data-slot=filter-pill]').filter({ hasText: /^(Activity|Walking)$/ });
const pill = (page: Page, name: string) =>
  page.locator('[data-slot=filter-pill]').filter({ hasText: new RegExp(`^${name}$`) });
const chosen = (page: Page) => page.locator('[data-slot=filter-pill][data-set]');
const count = (page: Page) => page.getByRole('status').filter({ hasText: /clips?$/ });
const happening = (page: Page) => page.getByRole('list', { name: 'What’s happening' });

/** The fake library; `none` has no places, so no trips, and nothing for the actions read. */
async function fakeLibrary(page: Page, none = false): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ indexingTickMs: 0, ...(none ? { places: 'none', actions: 'none' } : {}) }),
  });
}

const EMPTY = {
  Trip: 'No trips yet. A few clips filmed away from home make one.',
  Place: 'No places yet. A clip gets one from the location its phone or camera saved.',
  Activity: 'Nothing yet. What people are doing shows up as Taalcut describes your clips.',
};

/** The first clip the Activity filter keeps for `action`, opened on its page. */
async function clipDoing(page: Page, action: string): Promise<void> {
  await open(page, { name: 'library', path: `/library?action=${encodeURIComponent(action)}` });
  await tiles(page).first().click();
  await expect(page).toHaveURL(/\/library\/[0-9A-Z]{26}/);
  await expect(happening(page)).toBeVisible();
}

/** An axe scan of the open menu alone. */
const menuOnly = (page: Page) => axeFor(page).include('[role=menu]');

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled' });
}

test.describe('what people are doing (LIB1-FIND)', () => {
  test('the Activity pill narrows the grid through the URL, and Clear filters lets it go', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeLibrary(page);
    await open(page, LIBRARY);
    const all = await page
      .getByRole('status')
      .filter({ hasText: /clips$/ })
      .innerText();
    await activity(page).click();
    const menu = page.getByRole('menu');
    // Most clips first, after Any: two of the fake's scenes talk (the café, the bedroom), two walk.
    await expect(menu.getByRole('menuitemradio').nth(1)).toHaveText('Talking');
    await expect(menu.getByRole('menuitemradio').nth(2)).toHaveText('Walking');
    await menu.getByRole('menuitemradio', { name: 'Walking' }).click();
    await expect(page).toHaveURL(/[?&]action=walking/);
    await expect(activity(page)).toHaveText('Walking');
    await expect(page.getByRole('status').filter({ hasText: /clips$/ })).not.toHaveText(all);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).not.toHaveURL(/action=/);
    await expect(activity(page)).toHaveText('Activity');
    expect(problems).toEqual([]);
  });

  test('the Trip and Place pills narrow the grid to a trip, a country or a city', async ({ page }) => {
    const problems = await watchProblems(page);
    await fakeLibrary(page);
    await open(page, LIBRARY);
    const all = await count(page).innerText();
    // The fake's trips, newest first: Portugal in September from coordinates, June known only by its time zone.
    await pill(page, 'Trip').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'Any',
      'Portugal · Sep 2026',
      'Trip · Jun 2026',
    ]);
    await expect(menu.locator('[data-slot=filter-empty]')).toHaveCount(0);
    await menu.getByRole('menuitemradio', { name: 'Portugal · Sep 2026' }).click();
    await expect(page).toHaveURL(/[?&]trip=[0-9A-Z]{26}/);
    await expect(chosen(page)).toHaveText('Portugal · Sep 2026');
    const trip = await count(page).innerText();
    expect(trip).not.toBe(all);

    // A city one level in, under its country; a country or a city counts only coordinates.
    await pill(page, 'Place').click();
    const lisbon = menu.getByRole('menuitemradio', { name: 'Lisbon' });
    await expect(menu.getByRole('menuitemradio', { name: 'Portugal' })).toBeVisible();
    await expect(lisbon).toHaveAttribute('class', /pl-12/);
    await lisbon.click();
    await expect(page).toHaveURL(/[?&]city=\d+/);
    await expect(chosen(page)).toHaveText(['Portugal · Sep 2026', 'Lisbon']);
    await expect(count(page)).not.toHaveText(trip);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page).not.toHaveURL(/trip=|country=|city=/);
    await expect(count(page)).toHaveText(all);
    expect(problems).toEqual([]);
  });

  test('with nothing to offer, the Trip, Place and Activity pills stay and say how they fill', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await fakeLibrary(page, true);
    await open(page, LIBRARY);
    for (const [name, words] of Object.entries(EMPTY)) {
      await pill(page, name).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitemradio')).toHaveText(['Any']);
      await expect(menu.locator('[data-slot=filter-empty]')).toHaveText(words);
      // The menu's description, so a screen reader hears it on opening.
      await expect(menu).toHaveAccessibleDescription(words);
      await page.keyboard.press('Escape');
    }
    expect(problems).toEqual([]);
  });

  test('a clip says what its people are doing; a free action is shown as the model wrote it', async ({
    page,
  }) => {
    await fakeLibrary(page);
    await clipDoing(page, 'laughing');
    const chips = happening(page).getByRole('listitem');
    // How many people, then the café's actions in the vocabulary's order (a clip's other shots may add more).
    await expect(chips.first()).toHaveText('2 people');
    await expect(chips).toContainText(['2 people', 'Talking', 'Laughing', 'Drinking']);
    await clipDoing(page, 'kneading dough');
    const free = happening(page).locator('[data-slot=clip-action]').filter({ hasText: 'kneading dough' });
    await expect(free.locator('[translate=no]')).toHaveText('kneading dough');
    await expect(happening(page).locator('[data-slot=clip-action]').first()).toHaveText('Cooking');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe and screenshots, ${theme}: the filter pills`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeLibrary(page);
      await open(page, { name: 'library', path: '/library?action=walking' });
      await expectAccessible(page, testInfo, `library, the Activity filter set (${theme})`);
      await activity(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      // An open menu hides the page behind it from assistive tech, as a modal menu should: the menu is scanned alone.
      await expectAccessible(page, testInfo, `the Activity menu (${theme})`, menuOnly(page));
      await shot(page, `activity-pill-${theme}`);
      await page.keyboard.press('Escape');
      await open(page, { name: 'library', path: '/library?country=PT' });
      await chosen(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expectAccessible(page, testInfo, `the Place menu (${theme})`, menuOnly(page));
      await shot(page, `place-pill-${theme}`);
      await page.keyboard.press('Escape');
      await pill(page, 'Trip').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(page, `trip-pill-${theme}`);
    });

    test(`axe and screenshots, ${theme}: the toolbar at 1280 and 1024, and a pill with nothing`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeLibrary(page, true);
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        await open(page, LIBRARY);
        await page
          .locator('[data-slot=library-toolbar]')
          .screenshot({ path: `${SCREENS}/toolbar-${width}-${theme}.png` });
      }
      await pill(page, 'Place').click();
      await expect(page.locator('[data-slot=filter-empty]')).toBeVisible();
      await expectAccessible(page, testInfo, `the Place menu with nothing (${theme})`, menuOnly(page));
      await shot(page, `place-pill-empty-${theme}`);
    });

    test(`axe and screenshots, ${theme}: what's happening on the clip page`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeLibrary(page);
      await clipDoing(page, 'laughing');
      await expectAccessible(page, testInfo, `clip page, what's happening (${theme})`);
      await shot(page, `clip-actions-${theme}`);
      await page
        .locator('[data-slot=clip-summary]')
        .screenshot({ path: `${SCREENS}/clip-summary-${theme}.png` });
    });
  }

  test('pseudo-locale (en-XA): the pills, their choices and the chips are translated and fit', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakeLibrary(page);
    await open(page, { name: 'library', path: '/library?action=walking' });
    await page.locator('[data-slot=filter-pill][data-set]').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectPseudoClean(page, 'library, the Activity pill open (en-XA)');
    await shot(page, 'activity-pill-light-en-XA');
    await page.keyboard.press('Escape');
    await open(page, { name: 'library', path: '/library?action=walking&country=PT' });
    // Trip, Place, then Activity: the Place pill is the first one set.
    await chosen(page).first().click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectPseudoClean(page, 'library, the Place pill open (en-XA)');
    await shot(page, 'place-pill-light-en-XA');
    await page.keyboard.press('Escape');
    await tiles(page).first().click();
    await expect(page.locator('[data-slot=clip-action]').first()).toBeVisible();
    await expectPseudoClean(page, 'clip page, what’s happening (en-XA)');
    await shot(page, 'clip-actions-light-en-XA');
    // The note of a pill with nothing (the later options win: the fake reads them as the app starts).
    await fakeLibrary(page, true);
    await open(page, LIBRARY);
    await page.locator('[data-slot=filter-pill]').nth(6).click();
    await expect(page.locator('[data-slot=filter-empty]')).toBeVisible();
    await expectPseudoClean(page, 'library, the Activity pill with nothing (en-XA)');
    await shot(page, 'activity-pill-empty-light-en-XA');
  });
});
