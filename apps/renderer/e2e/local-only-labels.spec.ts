// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B10 (the window's part): with Local only on, Models and Privacy say which jobs are simpler on this Mac and
// which are off, in words with an icon; accessible in light and dark, clean in the pseudo-locale.
import { expect, test, type Page } from '@playwright/test';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';

const MODELS = { name: 'settings-models', path: '/settings/models' };
const PRIVACY = { name: 'settings-privacy', path: '/settings/privacy' };

/** Local only as first run turns it on: the switch (the fake starts with it) and the Local only profile. */
async function localOnlyModels(page: Page, theme: 'light' | 'dark', locale: 'en' | 'en-XA' = 'en') {
  await preferences(page, { theme, locale });
  await fakes(page, { localOnly: true });
  await open(page, MODELS);
  await page.locator('[role=radio][value=local-only]').click();
  await expect(page.locator('[role=radio][value=local-only]')).toHaveAttribute('aria-checked', 'true');
  const changes = page.getByRole('list', { name: locale === 'en' ? 'What Local only changes' : /.+/ });
  await expect(page.locator('[data-quality]').first()).toBeVisible();
  return changes;
}

for (const theme of ['light', 'dark'] as const) {
  test(`Models and Privacy with Local only in ${theme}: labelled, accessible`, async ({ page }, testInfo) => {
    const changes = await localOnlyModels(page, theme);
    await expect(changes.getByRole('listitem')).toHaveText([
      'The agent is simpler on this Mac',
      'Descriptions are simpler on this Mac',
      'Voice is off with Local only',
      'Generated images are off with Local only',
    ]);
    await expect(changes.locator('[data-quality=unavailable]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Show jobs' }).click();
    await expect(page.getByRole('region', { name: /^Agent/ }).locator('[data-quality]')).toHaveText(
      'The agent is simpler on this Mac',
    );
    await expectAccessible(page, testInfo, `models local only (${theme})`);
    await shoot(page, `local-only-models-${theme}`);

    // In the page (a reload would start the fake afresh): Privacy shows the same.
    await page.getByRole('link', { name: 'Local only in Privacy' }).click();
    await expect(page.locator('li[data-module=agent]')).toContainText('The agent is simpler on this Mac');
    await expect(page.locator('li[data-module=images]')).toContainText('Off while Local only is on');
    await expectAccessible(page, testInfo, `privacy local only (${theme})`);
    await shoot(page, `local-only-privacy-${theme}`);
  });
}

test('without Local only, no labels', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, MODELS);
  await expect(page.locator('[data-quality]')).toHaveCount(0);
  await open(page, PRIVACY);
  await expect(page.locator('[data-quality]')).toHaveCount(0);
});

test('the labels in the pseudo-locale', async ({ page }) => {
  await localOnlyModels(page, 'light', 'en-XA');
  await expectPseudoClean(page, 'models local only');
});
