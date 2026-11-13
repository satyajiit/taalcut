// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-STY follow-up 2: a set's style profile where the set lives, not only on Instagram's Saved page. A folder's
// view of Templates and one tag's have "What these templates have in common" between the filters and the list;
// words (search results), several tags or another filter take it away. Make has "What your own videos have in
// common" as a view of its own, Your style (/projects/style, UX4: it was a card above the exports). Each place shows StyleProfilePanel's states: the bones, a set of one template,
// no model, a failed read, the summary; and reads again on library.changed. An empty folder, a tag nothing has and
// Your style with no finished export from a template show no card: the list's own empty state says what to do (the
// Saved page keeps the card's empty line). Axe clean in both themes,
// screenshots at 1280×800 and 1024×720. Against the fake (src/backend/fake/templates/fake-style-profiles.ts: a
// folder's and a tag's templates, and the templates behind the make fakes' ready exports).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { shootStyle as shoot } from './style-profile-support.ts';
import { FAKE_OPTIONS_KEY, open, preferences } from './support.ts';

const THEMES = ['light', 'dark'] as const;
const TEMPLATES = { name: 'templates', path: '/templates' };
const EXPORTS = { name: 'renders', path: '/renders' };
const STYLE = { name: 'projects-style', path: '/projects/style' };

/** The fake's options: `templates` 200 for a library with full folders and tags, and the profiles' scenario. */
const fake = (page: Page, options: { templates?: number; styleProfiles?: string } = {}) =>
  page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ latencyMs: 20, indexingTickMs: 0, ...options }),
  });

const these = (page: Page) => page.getByRole('region', { name: 'What these templates have in common' });
const yours = (page: Page) => page.getByRole('region', { name: 'What your own videos have in common' });
const list = (page: Page) => page.locator('[data-slot=template-list]');
// A folder is a page (UX4 tpl): the rail's places are links.
const folder = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Template folders' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();

/** The card ends before the list starts. */
async function expectAbove(card: Locator, below: Locator) {
  const [cardBox, belowBox] = [await card.boundingBox(), await below.boundingBox()];
  expect(cardBox && belowBox && cardBox.y + cardBox.height <= belowBox.y).toBe(true);
}

test.describe('a set’s style profile where the set lives (LRN1-STY)', () => {
  for (const theme of THEMES)
    test(`a folder’s view has its card above the list; words take it away (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fake(page, { templates: 200 });
      await open(page, TEMPLATES);
      await expect(these(page)).toHaveCount(0);
      await folder(page, 'Travel');
      const card = these(page);
      await expect(card.getByText(/^Measured from \d+ templates$/)).toBeVisible();
      await expect(card.getByRole('heading', { level: 3 })).toBeVisible();
      await expect(card.locator('[data-slot=style-profile-facts] dt')).toHaveCount(8);
      await expect(card.locator('[data-slot=style-profile-exemplar]')).toHaveCount(3);
      await expect(card.locator('[data-written=local]')).toContainText('Written on this Mac');
      await expectAbove(card, list(page));
      await expectAccessible(page, testInfo, `folder style profile (${theme})`);
      await shoot(page, `after-folder-${theme}`, card);

      await page.getByRole('combobox', { name: 'Search your templates' }).fill('market');
      await expect(card).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Search your templates' }).fill('');
      await expect(these(page)).toBeVisible();
    });

  for (const theme of THEMES)
    test(`one tag’s view has its card; a second tag takes it away (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fake(page, { templates: 200 });
      await open(page, { name: 'templates-tag', path: '/templates?tags=travel' });
      const card = these(page);
      await expect(card.getByText(/^Measured from \d+ templates$/)).toBeVisible();
      await expect(card.locator('[data-slot=style-profile-exemplar]')).toHaveCount(3);
      await expectAbove(card, list(page));
      await expectAccessible(page, testInfo, `tag style profile (${theme})`);
      await shoot(page, `after-tag-${theme}`, card);

      await open(page, { name: 'templates-tags', path: '/templates?tags=travel,food' });
      await expect(list(page)).toBeVisible();
      await expect(these(page)).toHaveCount(0);
    });

  for (const theme of THEMES)
    test(`Your style has what the templates behind your exports have in common (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fake(page);
      await open(page, STYLE);
      await expect(
        page.locator('[data-slot=page-views]').getByRole('link', { name: 'Your style' }),
      ).toHaveAttribute('aria-current', 'page');
      const card = yours(page);
      // The fake's ready exports are cut from one template: its own numbers, said so.
      await expect(card.getByText('Measured from 1 template')).toBeVisible();
      await expect(card.locator('[data-slot=style-profile-one]')).toContainText(
        'Export a video made from another template',
      );
      await expect(card.locator('[data-slot=style-profile-exemplars]')).toHaveCount(0);
      // Exports is the queue alone now.
      await page.locator('[data-slot=page-views]').getByRole('link', { name: 'Exports' }).click();
      await expect(page.locator('[data-slot=render-list]')).toBeVisible();
      await expect(yours(page)).toHaveCount(0);
      await page.locator('[data-slot=page-views]').getByRole('link', { name: 'Your style' }).click();
      await expect(yours(page)).toBeVisible();
      await expectAccessible(page, testInfo, `your style (${theme})`);
      await shoot(page, `after-style-${theme}`, card);
    });

  test('one tag’s card reads again when the agent tags another template so', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fake(page);
    await open(page, TEMPLATES);
    await list(page)
      .getByRole('option', { name: /Golden hour market/ })
      .click();
    await expect(page).toHaveURL(/\/templates\/[0-9A-Z]{26}$/);
    const templateId = new URL(page.url()).pathname.split('/').pop() ?? '';

    await open(page, { name: 'templates-tag', path: '/templates?tags=hooks' });
    const card = these(page);
    await expect(card.getByText('Measured from 1 template')).toBeVisible();
    await expect(card.locator('[data-slot=style-profile-one]')).toContainText('Tag another with this');
    await shoot(page, 'after-tag-one-light', card);

    const tagged = await backend.agentDispatch(page, 'template.setTags', {
      projectId: null,
      templateId,
      tags: ['travel', 'golden-hour', 'hooks'],
    });
    expect(tagged).toBe(true);
    await expect(card.getByText('Measured from 2 templates')).toBeVisible();
    await expect(card.locator('[data-slot=style-profile-one]')).toHaveCount(0);
  });

  for (const theme of THEMES)
    test(`an empty folder keeps only the list’s empty state, and so does a tag nothing has (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fake(page);
      await open(page, TEMPLATES);
      await folder(page, 'Client work');
      const nothing = page.getByText('Nothing in this folder yet.');
      await expect(nothing).toBeVisible();
      await expect(these(page)).toHaveCount(0);
      await expect(page.locator('[data-slot=style-profile-bones]')).toHaveCount(0);
      await expectAccessible(page, testInfo, `empty folder, no style profile (${theme})`);
      await shoot(page, `after-folder-empty-${theme}`, nothing);

      await open(page, { name: 'templates-tag', path: '/templates?tags=nothing-here' });
      await expect(page.getByText('No templates match.')).toBeVisible();
      await expect(these(page)).toHaveCount(0);
    });

  test('Your style says how it fills once no finished export comes from a template', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fake(page);
    await open(page, EXPORTS);
    // The Golden hour market export is the one finished from a template; Diwali's stays, made from no template.
    const golden = page
      .locator('[data-slot=render-row][data-status=ready]')
      .filter({ hasText: 'Golden hour market' });
    const name = (await golden.locator('[data-user-content]').first().textContent()) ?? '';
    await golden.getByRole('button', { name: `More for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete export' }).click();
    await page.locator('[data-slot=page-views]').getByRole('link', { name: 'Your style' }).click();
    await expect(page.getByRole('heading', { name: 'Your style shows up here' })).toBeVisible();
    await expect(yours(page)).toHaveCount(0);
    await expect(page.locator('[data-slot=style-profile-bones]')).toHaveCount(0);
  });

  test('a tag without a model says so plainly (light)', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fake(page, { templates: 200, styleProfiles: 'noModel' });
    await open(page, { name: 'templates-tag', path: '/templates?tags=food' });
    await expect(these(page).locator('[data-summary=no_model]')).toContainText(
      'there’s no model on this Mac that can look at frames',
    );
    await expectAccessible(page, testInfo, 'tag style profile, no model');
  });

  for (const theme of THEMES)
    test(`Your style holds the profile’s shape while it loads (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fake(page, { styleProfiles: 'slow' });
      await page.goto(STYLE.path);
      const bones = page.locator('[data-slot=style-profile-bones]');
      await expect(bones).toBeVisible();
      await expect(bones.getByRole('status')).toHaveText('Loading');
      await expectAccessible(page, testInfo, `your style, loading (${theme})`);
      await shoot(page, `after-style-loading-${theme}`, bones);
    });

  test('a folder whose profile can’t be read says why, with Try again', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fake(page, { templates: 200, styleProfiles: 'failing' });
    await open(page, TEMPLATES);
    await folder(page, 'Food');
    const failed = page.locator('[data-slot=style-profile-error]');
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectAccessible(page, testInfo, 'folder style profile, failed');
  });
});
