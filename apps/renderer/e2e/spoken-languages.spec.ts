// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-LANG: a spoken language people can trust, in the window. Settings › General's languages you speak (Odia
// added brings the identifier, named for why, into the one download); first run's question on Your videos; and the
// clip page's language row: Hindi and English, unclear, Odia with the honest line where its transcript would be, and
// a language set by hand. Each is axe-clean. Set TAALCUT_LANG_SHOTS to a folder to keep light and dark screenshots.
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';
import { fakes } from './ui2b-support.ts';

/** fakeUlid(KIND.asset, 90_011 to 90_015): backend/fake/library/language-clips.ts. */
const CLIPS = {
  unclear: '01K7C5M6Q81000000000002QWV',
  mixed: '01K7C5M6Q81000000000002QWW',
  odia: '01K7C5M6Q81000000000002QWX',
  brief: '01K7C5M6Q81000000000002QWY',
  recheck: '01K7C5M6Q81000000000002QWZ',
} as const;
const SHOTS = process.env.TAALCUT_LANG_SHOTS;

async function keep(page: Page, target: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    // The theme's colours settle before the picture.
    await page.waitForTimeout(250);
    await target.screenshot({ path: join(SHOTS, `${name}-${theme}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function clip(page: Page, id: string): Promise<void> {
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'library-asset', path: `/library/${id}` });
}

const sound = (page: Page) => page.locator('[data-slot=clip-facts-group]').filter({ hasText: 'Sound' });

test.describe('a spoken language people can trust', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await preferences(page, { locale: 'en', theme: 'system' });
  });

  test('Settings › General: Odia added brings the identifier into the download, named for why', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await fakes(page, { downloadTickMs: 0 });
    await open(page, { name: 'settings-general', path: '/settings/general' });
    const section = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Languages you speak' }) });
    const list = section.getByRole('list', { name: 'Languages you speak' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(section).toContainText('Until you choose, these are Taalcut’s language and English.');
    await keep(page, section, 'settings-default');

    await section.getByLabel('Add a language').selectOption('or');
    await section.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Odia');
    const identifier = section.locator('[data-slot=spoken-identifier]');
    await expect(identifier).toContainText('Language identifier for Odia and other Indian languages');
    await expect(identifier).toContainText('437 MB');
    await expect(identifier).toContainText('On this Mac');
    await expectAccessible(page, testInfo, 'the languages you speak, with Odia and the identifier');
    await keep(page, section, 'settings-odia');

    // Settings › Models lists it by its name, under speech (in the window: a reload would start a new fake).
    await section.getByRole('link', { name: 'Settings › Models' }).click();
    await expect(page.locator('li[data-job="speech"]')).toContainText(
      'Language identifier for Odia and other Indian languages',
    );
    await page.goBack();
    await section.getByRole('button', { name: 'Remove Odia' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(identifier).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('first run asks on Your videos, and Change opens the same list in place', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await fakes(page, { onboarding: 'midway', downloadTickMs: 0 });
    await page.goto('/onboarding/sources');
    const question = page.locator('[data-slot=spoken-languages-question]');
    await expect(question).toContainText('Languages spoken in your videos');
    await expect(question).toContainText('Taalcut listens for English first.');
    await question.getByRole('button', { name: 'Change' }).click();
    await expect(question.getByRole('list', { name: 'Languages you speak' })).toBeVisible();
    await expectAccessible(page, testInfo, 'first run’s languages question, open');
    await keep(page, question, 'first-run-open');
    await question.getByRole('button', { name: 'Done' }).click();
    await expect(question.getByRole('list', { name: 'Languages you speak' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a clip in Hindi and English says both, with the AI mark', async ({ page }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.mixed);
    await expect(sound(page)).toContainText('Hindi and English speech');
    await expect(sound(page).getByLabel('Heard by Taalcut')).toBeVisible();
    await expectAccessible(page, testInfo, 'a Hindi and English clip');
    await keep(page, sound(page), 'clip-mixed');
    expect(problems).toEqual([]);
  });

  test('a clip in Odia says so, and says Taalcut can’t write it out yet', async ({ page }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.odia);
    await expect(sound(page)).toContainText('Odia speech');
    const said = page.getByText('Taalcut can’t write out Odia speech yet.');
    await expect(said).toBeVisible();
    await expectAccessible(page, testInfo, 'an Odia clip');
    await keep(page, sound(page), 'clip-odia');
    await keep(page, said, 'clip-odia-transcript');
    expect(problems).toEqual([]);
  });

  test('a second of speech nobody could write down names no language and doesn’t say no one speaks', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.brief);
    await expect(sound(page)).toContainText('Speech, language unclear');
    const said = page.locator('[data-slot=clip-transcript]');
    await expect(said).toContainText('Taalcut heard a little speech, too short or unclear to write down.');
    await expect(said).not.toContainText('No one speaks');
    await expect(said.getByRole('heading')).toHaveText('What’s said');
    await expectAccessible(page, testInfo, 'speech too short to write down');
    await keep(page, said, 'clip-brief-transcript');
    await keep(page, sound(page), 'clip-brief-sound');
    expect(problems).toEqual([]);
  });

  test('a clip heard before LIB1 says it’s checking the language, not its old guess', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.recheck);
    await expect(sound(page)).toContainText('Speech, checking the language');
    await expect(sound(page).locator('[data-slot=clip-language]')).toHaveAttribute('data-state', 'checking');
    await expect(page.locator('[data-slot=clip-transcript]').getByRole('heading')).toHaveText('What’s said');
    await expectAccessible(page, testInfo, 'language being decided again');
    await keep(page, sound(page), 'clip-checking-sound');
    expect(problems).toEqual([]);
  });

  test('unclear, set by hand, then given back to what Taalcut heard', async ({ page }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.unclear);
    await expect(sound(page)).toContainText('Speech, language unclear');
    await keep(page, sound(page), 'clip-unclear');

    const change = sound(page).getByRole('button', { name: 'Change the language' });
    await change.click();
    const popover = page.locator('[data-slot=popover-content]');
    const picker = popover.getByLabel('Language spoken in this clip');
    await expect(picker).toBeFocused();
    await picker.selectOption('vi');
    await expect(popover).toContainText('Taalcut files the clip under Vietnamese');
    await expectAccessible(page, testInfo, 'a clip’s language picker');
    await keep(page, popover, 'clip-picker');
    await popover.getByRole('button', { name: 'Use Vietnamese' }).click();
    await expect(popover).toHaveCount(0);
    await expect(change).toBeFocused();
    await expect(sound(page)).toContainText('Vietnamese speech');
    await expect(sound(page)).toContainText('Set by you');
    await keep(page, sound(page), 'clip-chosen');

    await change.click();
    await page
      .locator('[data-slot=popover-content]')
      .getByRole('button', { name: 'Use what Taalcut heard' })
      .click();
    await expect(sound(page)).toContainText('Speech, language unclear');
    await expect(sound(page)).not.toContainText('Set by you');
    expect(problems).toEqual([]);
  });
});
