// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// DSG1-READ: each text line's graphic brief in the review, as a motion designer reads it, editable, with Not a
// graphic; a reading Taalcut took for footage shows as removed with its reason and Restore. The fake's Coast road
// trip (landscape): DAY 1 is a title on the beat, FRESH FISH (slot 7) the stall's sign, read as footage.
import { expect, test, type Page } from '@playwright/test';
import { open, preferences, watchProblems } from './support.ts';
import { heading, LANDSCAPE, openSheet, ran, sheet, shot } from './template-review-support.ts';
import { axeFor } from './axe.ts';
import { expectAccessible, fakes } from './ui2b-support.ts';

// The slot's text list, where the briefs are. The strip above has its own checks (template-review.spec.ts); its cut
// handles and partly scrolled slots fail target-size on some slots at 960 wide, which is the strip's to fix.
const texts = (page: Page) =>
  axeFor(page).include('[data-slot=review-panel]').exclude('[data-slot=slot-strip]');

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

test.describe('the template review: graphic briefs (DSG1-READ)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`a sign read as footage shows as removed; Restore puts it back and ⌘Z takes that back (${theme})`, async ({
      page,
    }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      await page.setViewportSize({ width: 960, height: 600 });
      await open(page, LANDSCAPE);
      await openSheet(page);
      await sheet(page).locator('[data-slot=slot-strip] [data-slot-index="6"]').click();
      await expect(heading(page)).toHaveText('Slot 7 of 15');
      const sign = sheet(page).locator('[data-slot=graphic-brief][data-removed]');
      await expect(sign).toContainText('Not a graphic: footage the reel filmed.');
      await expect(sign).toContainText('Painted on the stall’s awning');
      await expectAccessible(page, testInfo, `graphic brief removed (${theme})`, texts(page));
      await sign.scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(shot(`graphic-brief-removed-960-${theme}`)).pathname });

      await sign.getByRole('button', { name: 'Restore as a graphic' }).click();
      await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('Restored as a graphic');
      expect(await ran(page)).toEqual(['template.graphic.set']);
      const restored = sheet(page).locator('[data-slot=graphic-brief]').last();
      await expect(restored).not.toHaveAttribute('data-removed');
      await expect(restored.getByText('You')).toBeVisible();
      await expect(restored.getByRole('button', { name: 'Not a graphic' })).toBeVisible();

      await page.keyboard.press('ControlOrMeta+z');
      await expect(sheet(page).locator('[data-slot=graphic-brief][data-removed]')).toBeVisible();
      expect(problems).toEqual([]);
    });

  test('a title’s brief says what it is, its part, look, motion, timing and place, and is edited in place', async ({
    page,
  }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await page.setViewportSize({ width: 960, height: 600 });
    await open(page, LANDSCAPE);
    await openSheet(page);
    await sheet(page).locator('[data-slot=slot-strip] [data-slot-index="0"]').click();
    await expect(heading(page)).toHaveText('Slot 1 of 15');
    const title = sheet(page).locator('[data-slot=graphic-brief]').first();
    await title.scrollIntoViewIfNeeded();
    await expect(title).toContainText('Title');
    await expect(title).toContainText('Hook');
    await expect(title).toContainText('the trip’s day title');
    await expect(title).toContainText('comes on on a beat');
    await expect(title.locator('[aria-label="Taalcut’s reading"]')).toBeVisible();
    await page.screenshot({ path: new URL(shot('graphic-brief-title-960-light')).pathname });

    await title.getByRole('button', { name: 'Edit the brief' }).click();
    await title.getByLabel('Part in the story').selectOption('setup');
    await expectAccessible(page, testInfo, 'graphic brief editing', texts(page));
    await title.getByRole('button', { name: 'Save' }).click();
    await expect(sheet(page).locator('[data-slot=review-said]')).toHaveText('Graphic brief changed');
    expect(await ran(page)).toEqual(['template.graphic.edit']);
    await expect(sheet(page).locator('[data-slot=graphic-brief]').first()).toContainText('Setup');
  });
});
