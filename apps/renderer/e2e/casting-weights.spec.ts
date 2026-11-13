// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-PREF "Done when": the casting weights Taalcut learned are visible, editable and resettable in Settings →
// Memory: the lean in the reader's language (never the item's English text) with the violet Learned badge, Adjust
// opens five sliders inside their reach that keep the total, Save is one memory.update, Escape leaves them as they
// were, and Reset deletes the item with Undo. Keyboard only, axe in both themes. Against the fake's `casting`
// scenario (src/backend/fake/memory/casting-weights-seed.ts), which checks an update as the library does.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, screenshotWhole } from './support.ts';

const SCREENS =
  process.env.TAALCUT_PREF_SCREENS ?? new URL('screenshots/casting-weights/', ARTIFACTS).pathname;
/** `before` for the page as LRN1-MEM left it, `after` with the casting editor. */
const PHASE = process.env.TAALCUT_PREF_PHASE ?? 'after';
const MEMORY = { name: 'settings-memory', path: '/settings/memory' };
const LEARNED_LEAN =
  'When picking shots, leans toward shots whose camera motion matches the template, and less on picture quality ' +
  'and matching people and subject.';

const scenario = (page: Page) =>
  page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ latencyMs: 20, memory: 'casting' }),
  });

const shot = (name: string) => new URL(name, `file://${SCREENS.replace(/\/?$/, '/')}`).href;
const casting = (page: Page) => page.locator('[data-memory-kind=casting-weights]');
const lean = (page: Page) => casting(page).locator('[data-slot=casting-weights-lean]');
const slider = (page: Page, name: string) => casting(page).getByRole('slider', { name });
const toast = (page: Page) => page.locator('[data-slot=toast]').last();
const memoryCommands = async (page: Page) =>
  (await backend.dispatched(page)).filter((d) => d.name.startsWith('memory.')).map((d) => d.name);

async function openMemory(
  page: Page,
  theme: 'light' | 'dark' = 'light',
  locale: 'en' | 'es' | 'en-XA' = 'en',
) {
  await preferences(page, { theme, locale });
  await scenario(page);
  await open(page, MEMORY);
  await expect(casting(page)).toBeVisible();
}

test.describe('Settings → Memory: learned casting weights (LRN1-PREF)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`shows how casting leans, from the item's data, with the Learned badge (${theme})`, async ({
      page,
    }, testInfo) => {
      await openMemory(page, theme);
      await expect(lean(page)).toHaveText(LEARNED_LEAN);
      await expect(casting(page)).not.toContainText('Leans toward');
      await expect(casting(page).locator('[data-source=learned]')).toHaveText('Learned');
      await expect(casting(page)).toContainText('From 18 choices you made');
      await expect(casting(page).getByRole('button', { name: 'Adjust' })).toBeVisible();
      await expect(casting(page).getByRole('button', { name: 'Reset to the defaults' })).toBeVisible();
      await expectAccessible(page, testInfo, `settings memory casting weights (${theme})`);

      await casting(page).getByRole('button', { name: 'Adjust' }).click();
      await expect(slider(page, 'Matches the description')).toBeFocused();
      await expectAccessible(page, testInfo, `casting weights editor (${theme})`);
    });

  test('adjusts the weights by keyboard: the others share the difference, Save is one update', async ({
    page,
  }) => {
    await openMemory(page);
    await casting(page).getByRole('button', { name: 'Adjust' }).focus();
    await page.keyboard.press('Enter');
    const description = slider(page, 'Matches the description');
    await expect(description).toBeFocused();
    await expect(description).toHaveAttribute('min', '0.2');
    await expect(description).toHaveAttribute('max', '0.7');
    await expect(description).toHaveAttribute('aria-valuetext', '38%, learned; default 40%');

    // Picture quality up to the top of its reach; the others give way and the five keep their total.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const quality = slider(page, 'Picture quality');
    await expect(quality).toBeFocused();
    await page.keyboard.press('End');
    await expect(quality).toHaveValue('0.3');
    await expect(quality).toHaveAttribute('data-yours', 'true');
    await expect(quality).toHaveAttribute('aria-valuetext', '30%, set by you; default 15%');
    await expect(description).toHaveAttribute('data-yours', 'false');
    const values = await casting(page)
      .getByRole('slider')
      .evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    expect(values).toHaveLength(5);
    expect(Math.round(values.reduce((sum, value) => sum + value, 0) * 1000)).toBe(1000);
    await expect(lean(page)).toContainText('sharp, well-exposed shots');

    await casting(page).getByRole('button', { name: 'Save' }).click();
    await expect(casting(page).getByRole('slider')).toHaveCount(0);
    await expect(casting(page).locator('[data-adjusted=you]')).toHaveText('Adjusted by you');
    await expect(lean(page)).toContainText('leans toward sharp, well-exposed shots');
    await expect(casting(page)).not.toContainText('choices you made');
    expect(await memoryCommands(page)).toEqual(['memory.update']);

    // Opened again, every part is the person's now.
    await casting(page).getByRole('button', { name: 'Adjust' }).click();
    await expect(slider(page, 'Picture quality')).toHaveValue('0.3');
    await expect(slider(page, 'Camera motion')).toHaveAttribute('data-yours', 'true');
  });

  test('Escape leaves the weights as they were, with nothing sent', async ({ page }) => {
    await openMemory(page);
    await casting(page).getByRole('button', { name: 'Adjust' }).click();
    const description = slider(page, 'Matches the description');
    await description.press('ArrowRight');
    await expect(description).toHaveValue('0.39');
    await description.press('PageUp');
    await expect(description).toHaveValue('0.44');
    await description.press('Escape');
    await expect(casting(page).getByRole('slider')).toHaveCount(0);
    await expect(lean(page)).toHaveText(LEARNED_LEAN);
    await expect(casting(page).getByRole('button', { name: 'Adjust' })).toBeVisible();
    expect(await memoryCommands(page)).toEqual([]);
  });

  test('Reset deletes the item, so casting is back on its defaults, and Undo brings it back', async ({
    page,
  }) => {
    await openMemory(page);
    await casting(page).getByRole('button', { name: 'Reset to the defaults' }).click();
    await expect(toast(page)).toContainText('Casting is back on its defaults');
    await expect(casting(page)).toHaveCount(0);
    await expect(page.locator('[data-memory-group=user] [data-slot=memory-item]')).toHaveCount(3);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(lean(page)).toHaveText(LEARNED_LEAN);
    expect(await memoryCommands(page)).toEqual(['memory.delete']);
  });

  test('reads in the language Taalcut is set to', async ({ page }) => {
    await openMemory(page, 'light', 'es');
    await expect(lean(page)).not.toHaveText(LEARNED_LEAN);
    await expect(lean(page)).not.toContainText('shots');
    await expect(casting(page).locator('[data-source=learned]')).not.toHaveText('Learned');
  });

  test('every word of the row and its editor goes through the catalogue (pseudo-locale)', async ({
    page,
  }) => {
    await openMemory(page, 'light', 'en-XA');
    const row = '[data-memory-kind=casting-weights]';
    expect(untranslated(await userFacingText(page, row)), 'the row').toEqual([]);
    await casting(page).locator('[data-action=edit]').click();
    expect(untranslated(await userFacingText(page, row)), 'the editor').toEqual([]);
  });
});

test.describe('Settings → Memory casting weights screenshots (LRN1-PREF)', () => {
  const SIZES = [
    { width: 1280, height: 800 },
    { width: 1024, height: 720 },
  ] as const;
  for (const theme of ['light', 'dark'] as const)
    for (const size of SIZES)
      test(`${PHASE}: ${theme} ${size.width}×${size.height}`, async ({ page }) => {
        await page.setViewportSize(size);
        await preferences(page, { theme, locale: 'en' });
        await scenario(page);
        await open(page, MEMORY);
        await expect(page.locator('[data-memory-group=user] [data-memory-id]')).toHaveCount(4);
        await screenshotWhole(page, shot(`${PHASE}-${theme}-${size.width}x${size.height}.png`));
        if (PHASE !== 'after') return;
        await casting(page).getByRole('button', { name: 'Adjust' }).click();
        await slider(page, 'Camera motion').press('End');
        await page.mouse.move(0, 0);
        await screenshotWhole(page, shot(`${PHASE}-editing-${theme}-${size.width}x${size.height}.png`));
      });
});
