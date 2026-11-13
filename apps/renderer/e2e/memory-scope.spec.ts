// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-MEM follow-up: where a remembered item applies. Settings → Memory adds for every video, a project or a
// template, the last two picked by name from a searchable list (keyboard only); editing moves an item to another
// scope, and a scope the item can't take (what an export taught stays with a template) is disabled. Against the
// fake (backend/fake/memory/fake-memory.ts: names come from the Make and template fakes).
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences } from './support.ts';
import { expectAccessible } from './axe.ts';

const SCREENS = process.env.TAALCUT_MEMORY_SCREENS ?? new URL('screenshots/memory/', ARTIFACTS).pathname;
const MEMORY = { name: 'settings-memory', path: '/settings/memory' };

async function openMemory(page: Page, theme: 'light' | 'dark' = 'light') {
  await preferences(page, { theme, locale: 'en' });
  await page.addInitScript(({ key }) => window.localStorage.setItem(key, JSON.stringify({ latencyMs: 20 })), {
    key: FAKE_OPTIONS_KEY,
  });
  await open(page, MEMORY);
}

const adding = (page: Page) => page.locator('[data-slot=memory-add]');
const group = (page: Page, kind: string) => page.locator(`[data-memory-group=${kind}]`);
const item = (page: Page, text: string) => page.locator('[data-slot=memory-item]').filter({ hasText: text });
const popover = (page: Page) => page.locator('[data-slot=memory-scope-popover]');
const search = (page: Page, what: 'projects' | 'templates') =>
  popover(page).getByRole('combobox', { name: `Search ${what}` });

test.describe('Settings → Memory: where an item applies (LRN1-MEM)', () => {
  test('adds for a project and for a template, each picked by name with the keyboard', async ({ page }) => {
    await openMemory(page);
    const field = page.getByRole('textbox', { name: 'Something to remember', exact: true });

    // A project: choosing it opens the picker with its search box focused.
    await adding(page).getByRole('radio', { name: 'A project…' }).click();
    await expect(search(page, 'projects')).toBeFocused();
    await search(page, 'projects').fill('gold');
    await expect(popover(page).getByRole('option')).toHaveText(['Golden hour market']);
    await search(page, 'projects').press('Enter');
    await expect(popover(page)).toHaveCount(0);
    await expect(adding(page).locator('[data-slot=memory-scope-picker]')).toHaveText('Golden hour market');
    await field.fill('Use the chai close-up as the poster.');
    await field.press('Enter');
    await expect(
      group(page, 'project').filter({ hasText: 'Use the chai close-up as the poster.' }),
    ).toContainText('Project · Golden hour market');
    // The choice stays for the next one.
    await expect(adding(page).locator('[data-slot=memory-scope-picker]')).toHaveText('Golden hour market');

    // A template, searched by the library; ↓ moves to the next match.
    await adding(page).getByRole('radio', { name: 'A template…' }).click();
    await search(page, 'templates').fill('slow morning');
    await expect(popover(page).getByRole('option').first()).toHaveText('Slow morning routine');
    await search(page, 'templates').press('Enter');
    await field.fill('Keep the kettle shot for the last beat.');
    await field.press('Enter');
    await expect(
      group(page, 'template').filter({ hasText: 'Keep the kettle shot for the last beat.' }),
    ).toContainText('Template · Slow morning routine');

    const ran = (await backend.dispatched(page)).filter((d) => d.name.startsWith('memory.'));
    expect(ran).toEqual([
      { name: 'memory.create', source: 'ui' },
      { name: 'memory.create', source: 'ui' },
    ]);
  });

  test('Add waits until a project is chosen, and the picker says when nothing matches', async ({ page }) => {
    await openMemory(page);
    await page.getByRole('textbox', { name: 'Something to remember', exact: true }).fill('Bold captions.');
    await adding(page).getByRole('radio', { name: 'A project…' }).click();
    await search(page, 'projects').fill('zebra');
    await expect(popover(page)).toContainText('No project matches “zebra”.');
    await search(page, 'projects').press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(adding(page).locator('[data-slot=memory-scope-picker]')).toHaveText('Choose a project');
    await expect(adding(page).getByRole('button', { name: 'Add' })).toBeDisabled();
    // Back to every video: Add is ready again.
    await adding(page).getByRole('radio', { name: 'Every video' }).click();
    await expect(adding(page).getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  test('editing moves an item to a project; what an export taught can only move between templates', async ({
    page,
  }) => {
    await openMemory(page);
    const intro = item(page, 'Keep intros under two seconds.');
    await intro.getByRole('button', { name: 'Edit' }).click();
    await expect(intro.getByRole('radio', { name: 'Every video' })).toBeChecked();
    await intro.getByRole('radio', { name: 'A project…' }).click();
    await search(page, 'projects').fill('golden');
    await search(page, 'projects').press('Enter');
    await intro.getByRole('button', { name: 'Save' }).click();
    await expect(group(page, 'project').filter({ hasText: 'Keep intros under two seconds.' })).toContainText(
      'Project · Golden hour market',
    );
    await expect(group(page, 'user').locator('[data-slot=memory-item]')).toHaveCount(2);

    const learned = page
      .locator('[data-slot=memory-item]')
      .filter({ has: page.locator('[data-source=learned]') });
    await learned.getByRole('button', { name: 'Edit' }).click();
    await expect(learned.getByRole('radio', { name: 'A template…' })).toBeChecked();
    await expect(learned.getByRole('radio', { name: 'Every video' })).toBeDisabled();
    await expect(learned.getByRole('radio', { name: 'A project…' })).toBeDisabled();
    await expect(learned.locator('[data-slot=memory-scope-picker]')).toHaveText('Golden hour market');
    await learned.getByRole('button', { name: 'Cancel' }).click();

    const ran = (await backend.dispatched(page)).filter((d) => d.name.startsWith('memory.'));
    expect(ran).toEqual([{ name: 'memory.update', source: 'ui' }]);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the picker is accessible and as designed (${theme})`, async ({ page }, testInfo) => {
      for (const size of [
        { width: 1280, height: 800 },
        { width: 1024, height: 720 },
      ]) {
        await page.setViewportSize(size);
        await openMemory(page, theme);
        await adding(page).getByRole('radio', { name: 'A project…' }).click();
        await expect(popover(page).getByRole('option').first()).toBeVisible();
        await expectAccessible(page, testInfo, `memory scope picker ${size.width} (${theme})`);
        await page.screenshot({
          path: `${SCREENS.replace(/\/?$/, '/')}scope-picker-${theme}-${size.width}x${size.height}.png`,
          animations: 'disabled',
        });
      }
    });
});
