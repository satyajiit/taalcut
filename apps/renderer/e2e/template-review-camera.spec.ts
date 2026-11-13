// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FRM1-MOT: a slot's camera move is measured from the reel; one Taalcut isn't sure of is asked in the review and
// answered in place with the camera-move picker (template.setMotion), from the mouse or the keyboard, undone by ⌘Z.
// The fake's Coast road trip (landscape): slot 7 was measured as a pan, not surely, so its move is unknown.
import { expect, test } from '@playwright/test';
import { open, preferences, watchProblems } from './support.ts';
import { count, heading, LANDSCAPE, openSheet, ran, sheet, shot } from './template-review-support.ts';
import { expectAccessible, fakes } from './ui2b-support.ts';

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

test.describe('the template review: the camera move (FRM1-MOT)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`a camera move Taalcut isn’t sure of is picked in place; ⌘Z takes it back (${theme})`, async ({
      page,
    }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      await page.setViewportSize({ width: 960, height: 600 });
      await open(page, LANDSCAPE);
      await openSheet(page);
      await expect(count(page)).toContainText('5 to check');
      // J steps to slot 7's question, after the whole reel's.
      for (let i = 0; i < 3 && (await heading(page).textContent()) !== 'Slot 7 of 15'; i++)
        await page.keyboard.press('j');
      await expect(heading(page)).toHaveText('Slot 7 of 15');
      const question = sheet(page).locator('[data-current]');
      await expect(question).toContainText('Taalcut isn’t sure how the camera moves');
      const pick = question.getByRole('button', { name: 'Pick the camera move' });
      await expect(pick).toBeVisible();
      await expect(question.getByRole('button', { name: 'Leave it unknown' })).toBeVisible();
      // Beside the description, the move reads as not known yet.
      await expect(
        sheet(page).getByRole('button', { name: 'Camera move in slot 7: Not known. Change it' }),
      ).toBeVisible();
      await page.screenshot({ path: new URL(shot(`camera-move-question-960-${theme}`)).pathname });

      // From the keyboard: the picker opens on Enter, the arrows move, Enter picks.
      await pick.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu).toContainText('Taalcut measured Pan, but isn’t sure');
      await expect(menu.getByRole('menuitemradio')).toHaveCount(8);
      await expect(menu.getByRole('menuitemradio', { name: /I don’t know/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expectAccessible(page, testInfo, `camera-move picker (${theme})`);
      await page.screenshot({ path: new URL(shot(`camera-move-picker-960-${theme}`)).pathname });
      const panItem = menu.getByRole('menuitemradio', { name: /^Pan/ });
      for (let i = 0; i < 8 && !(await panItem.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press('ArrowDown');
      await expect(panItem).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toBeHidden();
      await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText(
        'Slot 7’s camera move is now Pan',
      );
      await expect(count(page)).toContainText('4 to check');
      expect(await ran(page)).toEqual(['template.setMotion']);
      // The review goes on to what is left; back on slot 7, the pick agrees with what was measured, so it reads as
      // Taalcut's, now sure.
      const seven = sheet(page).locator('[data-slot=slot-strip] [data-slot-index="6"]');
      await seven.click();
      await expect(heading(page)).toHaveText('Slot 7 of 15');
      const value = sheet(page).locator('[data-slot=camera-move]');
      await expect(value).toContainText('Pan');
      await expect(value.locator('[aria-label="Taalcut’s reading"]')).toBeVisible();
      await expect(sheet(page).locator('[data-slot=doubt-answers]')).toHaveCount(0);
      await value.scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(shot(`camera-move-picked-960-${theme}`)).pathname });

      await page.keyboard.press('ControlOrMeta+z');
      await expect(count(page)).toContainText('5 to check');
      await expect(sheet(page).getByText('Taalcut isn’t sure how the camera moves')).toBeVisible();
      await expect(
        sheet(page).getByRole('button', { name: 'Camera move in slot 7: Not known. Change it' }),
      ).toBeVisible();
      expect(problems).toEqual([]);
    });

  test('a measured move shows as Taalcut’s reading and changes from beside the description', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await page.setViewportSize({ width: 960, height: 600 });
    await open(page, LANDSCAPE);
    await openSheet(page);
    const value = sheet(page).locator('[data-slot=camera-move]');
    await expect(value).toBeVisible();
    await value.click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('from the reel');
    await menu.getByRole('menuitemradio', { name: /Handheld/ }).click();
    await expect(sheet(page).locator('[data-slot=review-said]')).toContainText('camera move is now Handheld');
    expect(await ran(page)).toEqual(['template.setMotion']);
  });
});
