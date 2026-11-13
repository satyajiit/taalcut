// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-MEM "Done when": items are created, edited and deleted in Settings → Memory (keyboard only, each undoable),
// grouped by where they apply with who they came from (teal you, violet AI, each with its word); search finds by
// words; the cloud switch says plainly where memory goes; the empty, failing and loading states say what is true.
// memory.remember's "Remember this?" card in each state, from the kit. Against the fake
// (src/backend/fake/memory/fake-memory.ts); the desktop test covers a restart.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, screenshotWhole } from './support.ts';
import { expectAccessible } from './axe.ts';

const SCREENS = process.env.TAALCUT_MEMORY_SCREENS ?? new URL('screenshots/memory/', ARTIFACTS).pathname;
const MEMORY = { name: 'settings-memory', path: '/settings/memory' };

const scenario = (page: Page, memory?: string) =>
  page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ latencyMs: 20, ...(memory ? { memory } : {}) }),
  });

const group = (page: Page, kind: string) => page.locator(`[data-memory-group=${kind}]`);
const items = (page: Page) => page.locator('[data-slot=memory-item]');
const item = (page: Page, text: string | RegExp) => items(page).filter({ hasText: text });
const toast = (page: Page) => page.locator('[data-slot=toast]').last();
const cloud = (page: Page) => page.locator('[data-setting=memory-cloud]');

test.describe('Settings → Memory (LRN1-MEM)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`groups what Taalcut remembers by where it applies, with who it came from (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page);
      await open(page, MEMORY);
      await expect(group(page, 'user').getByRole('heading')).toHaveText('Every video');
      await expect(group(page, 'user').locator('[data-slot=memory-item]')).toHaveCount(3);
      await expect(group(page, 'project').getByRole('heading')).toHaveText('Project · Golden hour market');
      await expect(group(page, 'template').getByRole('heading')).toHaveText([
        'Template · Golden hour market',
        'Template · Slow morning routine',
      ]);
      await expect(page.locator('[data-source=user]')).toHaveCount(3);
      await expect(page.locator('[data-source=user]').first()).toHaveText('You');
      await expect(page.locator('[data-source=agent]')).toHaveCount(2);
      await expect(page.locator('[data-source=learned]')).toHaveText('Learned');
      await expect(cloud(page)).toContainText(
        'Your memory goes with each request the agent sends to Anthropic',
      );
      await expectAccessible(page, testInfo, `settings memory (${theme})`);
    });
  }

  test('adds, edits and deletes with the keyboard, and Undo brings a deletion back', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page);
    await open(page, MEMORY);
    const field = page.getByRole('textbox', { name: 'Something to remember' });
    await field.fill('Always end on the logo for two beats.');
    await field.press('Enter');
    await expect(item(page, 'Always end on the logo for two beats.')).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(group(page, 'user').locator('[data-slot=memory-item]')).toHaveCount(4);

    const whip = item(page, 'Never use whip transitions.');
    await whip.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByRole('textbox', { name: 'What Taalcut remembers' });
    await expect(editor).toBeFocused();
    await editor.fill('Never use whip pans or whip zooms.');
    await editor.press('Enter');
    await expect(item(page, 'Never use whip pans or whip zooms.')).toBeVisible();
    await expect(editor).toHaveCount(0);

    // Escape leaves the words as they were.
    await item(page, 'Keep intros under two seconds.').getByRole('button', { name: 'Edit' }).click();
    await editor.fill('Something else');
    await editor.press('Escape');
    await expect(item(page, 'Keep intros under two seconds.')).toBeVisible();

    await item(page, 'Never use whip pans or whip zooms.').getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page)).toContainText('Deleted from memory');
    await expect(item(page, 'Never use whip pans or whip zooms.')).toHaveCount(0);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(item(page, 'Never use whip pans or whip zooms.')).toBeVisible();

    const ran = (await backend.dispatched(page)).filter((d) => d.name.startsWith('memory.'));
    expect(ran.map((d) => d.name)).toEqual(['memory.create', 'memory.update', 'memory.delete']);
    expect(ran.every((d) => d.source === 'ui')).toBe(true);
  });

  test('search finds items by words and says when nothing matches', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page);
    await open(page, MEMORY);
    const search = page.getByRole('searchbox', { name: 'Search memory' });
    await search.fill('capt');
    await expect(items(page)).toHaveCount(2);
    await search.fill('zebra');
    await expect(page.getByText('Nothing in memory matches “zebra”.')).toBeVisible();
    await search.fill('');
    await expect(items(page)).toHaveCount(6);
  });

  test('the cloud switch says plainly where memory goes', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page);
    await open(page, MEMORY);
    const toggle = cloud(page).getByRole('switch', { name: 'Use memory with cloud models' });
    await expect(toggle).toBeChecked();
    await toggle.press('Space');
    await expect(toggle).not.toBeChecked();
    await expect(cloud(page)).toContainText('the agent’s requests to cloud models leave your memory out');
    const ran = (await backend.dispatched(page)).filter((d) => d.name === 'memory.setCloudPrompts');
    expect(ran).toEqual([{ name: 'memory.setCloudPrompts', source: 'ui' }]);
  });

  test('on this Mac, memory never leaves it', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page, 'local');
    await open(page, MEMORY);
    await expect(cloud(page)).toContainText('The agent works on this Mac, so your memory never leaves it.');
  });

  test('empty, it says how to add one; failing, it says why with Try again', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await scenario(page, 'empty');
    await open(page, MEMORY);
    // The kit's empty state (UX4): Kaatu, its heading, the line on how to add one, and Start a chat.
    await expect(page.getByRole('heading', { name: 'Nothing remembered yet' })).toBeVisible();
    await expect(page.getByText(/say yes when it asks “Remember this\?”/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a chat' })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expectAccessible(page, testInfo, 'settings memory (empty)');

    const failing = await page.context().newPage();
    await preferences(failing, { theme: 'light', locale: 'en' });
    await scenario(failing, 'failing');
    await open(failing, MEMORY);
    await expect(failing.getByText('Your memory didn’t load.')).toBeVisible();
    await expect(failing.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

const KIT = { name: 'dev-kit', path: '/dev/kit' };
const proposal = (page: Page, state: string) =>
  page.locator(`[data-slot=memory-cards-gallery] [data-fixture="memoryProposal · ${state}"]`);

test.describe('"Remember this?" (LRN1-MEM)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`asks with the words, where they apply and two answers, axe clean (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await scenario(page);
      await open(page, KIT);
      const pending = proposal(page, 'pending');
      await pending.scrollIntoViewIfNeeded();
      await expect(pending.getByRole('heading')).toHaveText('Remember this?');
      await expect(pending).toContainText('Never use whip transitions.');
      await expect(pending).toContainText('Applies to every video.');
      await expect(pending.locator('[data-source=agent]')).toHaveText('Agent');
      await expect(pending.getByRole('button')).toHaveText(['Remember', 'Not now']);
      await expect(proposal(page, 'project')).toContainText('Applies to the project Golden hour market.');
      await expect(proposal(page, 'template')).toContainText('Approved');
      await expect(proposal(page, 'declined')).toContainText('Not remembered');
      await expect(proposal(page, 'declined')).toContainText('Nothing was stored.');
      await expect(proposal(page, 'declined')).not.toContainText('later chats');
      await expect(proposal(page, 'declined').getByRole('button')).toHaveCount(0);
      await expectAccessible(page, testInfo, `memory proposal card (${theme})`);
      // Tall enough for every state in one picture.
      await page.setViewportSize({ width: 1280, height: 2000 });
      await page
        .locator('[data-slot=memory-cards-gallery]')
        .screenshot({ path: `${SCREENS.replace(/\/?$/, '/')}proposal-${theme}.png`, animations: 'disabled' });

      const remembered = proposal(page, 'remembered');
      await expect(remembered).toContainText('Remembered');
      await remembered.getByRole('button', { name: 'See it in Settings → Memory' }).click();
      await expect(page).toHaveURL(/\/settings\/memory$/);
    });
});

test.describe('Settings → Memory screenshots (LRN1-MEM)', () => {
  const SIZES = [
    { width: 1280, height: 800 },
    { width: 1024, height: 720 },
  ] as const;
  for (const theme of ['light', 'dark'] as const)
    for (const size of SIZES)
      test(`after: ${theme} ${size.width}×${size.height}`, async ({ page }) => {
        await page.setViewportSize(size);
        await preferences(page, { theme, locale: 'en' });
        await scenario(page);
        await open(page, MEMORY);
        await expect(items(page)).toHaveCount(6);
        await screenshotWhole(
          page,
          new URL(`after-${theme}-${size.width}x${size.height}.png`, `file://${SCREENS.replace(/\/?$/, '/')}`)
            .href,
        );
      });
});
