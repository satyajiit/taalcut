// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-STY "Done when": the Saved collection's summary card, "What your saved reels have in common", shows the
// numbers Taalcut measured and the model's paragraph written on this Mac first, by a cloud model only with the
// person's permission (and says so), and an honest sentence when there is no model; while it loads, bones in its
// own shape; Try again asks again; an empty collection says what fills it; Open goes to the template. Axe clean in
// both themes. Against the fake
// (src/backend/fake/templates/fake-style-profiles.ts); the desktop test covers the real service on a real database.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expectAccessible } from './axe.ts';
import { STY_SCREENS, shootStyle } from './style-profile-support.ts';
import { FAKE_OPTIONS_KEY, open, preferences } from './support.ts';

const SAVED = (collection: string) => ({
  name: 'templates-saved',
  // A collection is a page of its own (UX4 tpl).
  path: `/templates/saved/${collection}`,
});

const scenario = (page: Page, styleProfiles?: string) =>
  page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ latencyMs: 20, ...(styleProfiles ? { styleProfiles } : {}) }),
  });

/** Signs in to Instagram behind its warning, on the collection's page. */
async function savedPage(page: Page, collection = 'col_inspo') {
  await open(page, SAVED(collection));
  await page.getByRole('button', { name: 'Sign in to Instagram' }).click();
  await page
    .getByRole('region', { name: 'Using your Instagram Saved collections in Taalcut' })
    .getByRole('button', { name: 'I understand' })
    .click();
  await expect(page.getByRole('navigation', { name: 'Saved collections' })).toBeVisible();
}

const card = (page: Page) => page.getByRole('region', { name: 'What your saved reels have in common' });

const shoot = (page: Page, name: string, target: Locator = card(page)) => shootStyle(page, name, target);

test.describe('What your saved reels have in common (LRN1-STY)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`measures the collection and says the paragraph was written on this Mac (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page);
      await savedPage(page);
      const found = card(page);
      await expect(found.getByText('Measured from 3 templates')).toBeVisible();
      await expect(found.locator('[data-slot=style-profile-facts] dt')).toHaveCount(8);
      await expect(found.locator('[data-slot=style-profile-exemplar]')).toHaveCount(3);
      await expect(found.locator('[data-written=local]')).toContainText('Written on this Mac by qwen3.5-4b');
      await expectAccessible(page, testInfo, `saved style profile (${theme})`);
      await shoot(page, `after-saved-style-local-${theme}`);
    });

  for (const theme of ['light', 'dark'] as const)
    test(`without a model, says so plainly and asks again on Try again (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page, 'noModel');
      await savedPage(page);
      const found = card(page);
      await expect(found.locator('[data-summary=no_model]')).toContainText(
        'there’s no model on this Mac that can look at frames',
      );
      await expectAccessible(page, testInfo, `saved style profile, no model (${theme})`);
      await shoot(page, `after-saved-style-no-model-${theme}`);
      await found.getByRole('button', { name: 'Try again' }).click();
      await expect(found.getByRole('status')).toContainText('Writing a summary');
      await expect(found.locator('[data-summary=no_model]')).toBeVisible();
    });

  for (const theme of ['light', 'dark'] as const)
    test(`holds the summary’s shape while it loads (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page, 'slow');
      await savedPage(page);
      const bones = page.locator('[data-slot=style-profile-bones]');
      await expect(bones).toBeVisible();
      await expect(bones.getByRole('status')).toHaveText('Loading');
      await expectAccessible(page, testInfo, `saved style profile, loading (${theme})`);
      await shoot(page, `after-saved-style-loading-${theme}`, bones);
    });

  test('a cloud model’s paragraph says the person allowed it to see pictures', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page, 'cloud');
    await savedPage(page);
    await expect(card(page).locator('[data-written=cloud]')).toContainText(
      'Written by gemini-3.1-flash-lite (Google), which you allowed to see pictures.',
    );
    await expectAccessible(page, testInfo, 'saved style profile, cloud');
    await shoot(page, 'after-saved-style-cloud-light');
  });

  test('the model still getting ready writes the paragraph on Try again', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page, 'notYet');
    await savedPage(page);
    const found = card(page);
    await expect(found.locator('[data-summary=not_yet]')).toBeVisible();
    await found.getByRole('button', { name: 'Try again' }).click();
    await expect(found.locator('[data-written=local]')).toBeVisible();
  });

  test('an empty collection says what fills it; Open goes to the template', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'dark', locale: 'en' });
    await scenario(page);
    await savedPage(page, 'col_hooks');
    await expect(card(page).locator('[data-slot=style-profile-empty]')).toContainText(
      'Turn a few of these Reels into templates',
    );
    await expectAccessible(page, testInfo, 'saved style profile, empty');
    await shoot(page, 'after-saved-style-empty-dark');

    await page
      .getByRole('navigation', { name: 'Saved collections' })
      // A collection is a page of its own (UX4 tpl): the rail's collections are links.
      .getByRole('link', { name: /Reels Inspo/ })
      .click();
    const open = card(page).getByRole('button', { name: /^Slow morning routine/ });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/templates\/01K7C5M6Q8/);
  });
});

const KIT = { name: 'dev-kit', path: '/dev/kit' };
const kitCard = (page: Page, state: string) =>
  page.locator(`[data-slot=style-profile-cards-gallery] [data-fixture="styleProfile · ${state}"]`);

test.describe('templates.styleProfile’s card in the chat (LRN1-STY, Part B)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`shows what the agent read, the set by its own name, axe clean (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page);
      await open(page, KIT);
      const local = kitCard(page, 'local');
      await local.scrollIntoViewIfNeeded();
      await expect(local.getByRole('heading', { level: 3 })).toHaveText(
        'What your saved reels have in common',
      );
      await expect(local).toContainText('Travel inspo');
      await expect(local).toContainText('Measured from 6 templates');
      await expect(local.locator('[data-written=local]')).toBeVisible();
      await expect(local.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(kitCard(page, 'cloud').locator('[data-written=cloud]')).toBeVisible();
      await expect(kitCard(page, 'noModel').locator('[data-summary=no_model]')).toBeVisible();
      await expect(kitCard(page, 'empty').locator('[data-slot=style-profile-empty]')).toBeVisible();
      await expectAccessible(page, testInfo, `style profile card (${theme})`);
      mkdirSync(STY_SCREENS, { recursive: true });
      await local.screenshot({ path: `${STY_SCREENS}after-chat-card-${theme}.png`, animations: 'disabled' });
    });
});
