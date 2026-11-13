// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// BRK1-REV, the gate's item 5: "The reel doesn't say whose sound it is" is answered in place. Add the credit opens a
// form (title, artist, an optional https link) that writes template.setSoundCredit and undoes like any fix. Synthetic
// words and an example.com link only.
import { expect, test } from '@playwright/test';
import { open, preferences, watchProblems } from './support.ts';
import { count, heading, openSheet, PORTRAIT, ran, sheet, shot } from './template-review-support.ts';
import { expectAccessible, fakes } from './ui2b-support.ts';

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

test.describe('the template review: the sound credit (BRK1-REV)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`Add the credit says whose sound it is, in place; ⌘Z takes it back (${theme})`, async ({
      page,
    }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      await page.setViewportSize({ width: 960, height: 600 });
      await open(page, PORTRAIT);
      await openSheet(page);
      // The tempo is current; the sound's credit waits in view as a line that goes to it.
      const reelDoubts = sheet(page).locator('[data-slot=reel-doubts]');
      await reelDoubts.getByRole('button', { name: 'The reel doesn’t say whose sound it is' }).click();
      await expect(reelDoubts.locator('[data-current]')).toContainText('whose sound it is');
      await reelDoubts.getByRole('button', { name: 'Add the credit' }).click();
      const form = sheet(page).getByRole('form', { name: 'The sound’s credit' });
      await expect(form.getByRole('textbox', { name: 'Title' })).toBeFocused();
      // The form opens whole in the panel's view, Save with it.
      await expect(form.getByRole('button', { name: 'Save the credit' })).toBeInViewport({ ratio: 1 });
      await form.getByRole('textbox', { name: 'Title' }).fill('Rain on tin');
      await form.getByRole('textbox', { name: 'Artist' }).fill('The Made-up Band');
      const link = form.getByRole('textbox', { name: 'Link to the sound (optional)' });
      await link.fill('example.com/sounds/rain');
      await form.getByRole('button', { name: 'Save the credit' }).click();
      await expect(link).toHaveAttribute('aria-invalid', 'true');
      await expect(form.getByRole('alert')).toHaveText(
        'That isn’t a link. Paste one that starts with https://',
      );
      await expectAccessible(page, testInfo, `sound credit form (${theme})`);
      await page.screenshot({ path: new URL(shot(`sound-credit-error-960-${theme}`)).pathname });
      await link.fill('https://example.com/sounds/rain');
      await expect(form.getByRole('alert')).toHaveCount(0);
      await page.screenshot({ path: new URL(shot(`sound-credit-form-960-${theme}`)).pathname });
      await form.getByRole('button', { name: 'Save the credit' }).click();
      await expect(count(page)).toContainText('6 to check');
      await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('Sound credit added');
      await expect(reelDoubts).not.toContainText('whose sound it is');
      expect(await ran(page)).toEqual(['template.setSoundCredit']);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(count(page)).toContainText('7 to check');
      await expect(reelDoubts).toContainText('whose sound it is');
      // Escape in the form puts the question back and stays in the sheet.
      await reelDoubts.getByRole('button', { name: 'The reel doesn’t say whose sound it is' }).click();
      await reelDoubts.getByRole('button', { name: 'Add the credit' }).click();
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toBeVisible();
      await expect(reelDoubts.getByRole('button', { name: 'Add the credit' })).toBeFocused();
      // The gate's item 12: on a slot, what's open about the whole reel stays in view, a line each that goes to it.
      await page.keyboard.press('j');
      await expect(heading(page)).toHaveText('Slot 3 of 10');
      await expect(reelDoubts.locator('[data-slot=reel-doubt]')).toHaveCount(2);
      await expect(reelDoubts.locator('[data-current]')).toHaveCount(0);
      await expect(reelDoubts).toBeInViewport();
      await page.screenshot({ path: new URL(shot(`reel-doubts-on-a-slot-960-${theme}`)).pathname });
      expect(problems).toEqual([]);
    });
});
