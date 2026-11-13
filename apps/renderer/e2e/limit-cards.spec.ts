// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// G8's rateLimit card, an external agent's approval (P3-V4) and the source picker's phone (P3-B4) as the kit shows
// them: every state renders as a real card (none a placeholder), axe is clean in light and dark with the model menu
// and the phone's two ways open, and in the pseudo-locale nothing runs out of its card at a narrow window. An
// external agent's consent and budget-cap asks name it and open what it may do (round P3-3).
import { expect, test, type Page } from '@playwright/test';
import { fakes, expectAccessible } from './ui2b-support.ts';
import { ARTIFACTS, open, preferences, watchProblems } from './support.ts';

const KIT = { name: 'dev-kit', path: '/dev/kit' };
const gallery = (page: Page) => page.locator('[data-slot=limit-cards-gallery]');
const fixture = (page: Page, name: string) => gallery(page).locator(`[data-fixture="${name}"]`);

for (const theme of ['light', 'dark'] as const) {
  test(`every limit, ask and phone state, axe clean (${theme})`, async ({ page }, testInfo) => {
    const problems = await watchProblems(page);
    await fakes(page, { onboarding: 'done', usb: 'iphone' });
    await preferences(page, { theme, locale: 'en' });
    await open(page, KIT);
    await gallery(page).scrollIntoViewIfNeeded();
    await expect(gallery(page).locator('[data-pending]')).toHaveCount(0);
    await expect(gallery(page).locator('[data-card-type=rateLimit]')).toHaveCount(14);
    // Waiting is a decision card; the others are one line.
    await expect(gallery(page).locator('article[data-card-type=rateLimit]')).toHaveCount(7);
    await expect(fixture(page, 'rateLimit · waitingRate').getByText(/^In 1[23] minutes$/)).toBeVisible();
    await expect(fixture(page, 'approval · external')).toContainText(
      'Claude Code (an external agent) is asking',
    );

    await fixture(page, 'rateLimit · waitingSixModels')
      .getByRole('button', { name: 'Use another model' })
      .click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(6);
    await expectAccessible(page, testInfo, `Limit cards, model menu open (${theme})`);
    await page.keyboard.press('Escape');

    const picker = fixture(page, 'sourcePicker · empty');
    await picker.getByRole('button', { name: 'From my phone' }).click();
    // A phone is on the cable in this fake, so the cable comes first.
    await expect(picker.getByRole('radio')).toHaveText(['With a cable', 'Over Wi-Fi']);
    await picker.getByRole('radio', { name: 'With a cable' }).click();
    await expect(picker.getByText('Found Satya’s iPhone.')).toBeVisible();
    await expectAccessible(page, testInfo, `Limit cards, phone choice open (${theme})`);
    expect(problems).toEqual([]);
  });
}

/** Where this spec's card pictures go (the lane's screens; TAALCUT_CONTRACT3_SCREENS moves them). */
const SCREENS =
  process.env.TAALCUT_CONTRACT3_SCREENS ?? new URL('screenshots/contract3/', ARTIFACTS).pathname;

for (const theme of ['light', 'dark'] as const) {
  test(`an external agent's consent and budget-cap asks name it, axe clean (${theme})`, async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await fakes(page, { onboarding: 'done' });
    await preferences(page, { theme, locale: 'en' });
    await open(page, KIT);
    for (const name of ['consent · external', 'budgetCap · external']) {
      const card = fixture(page, name);
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('[data-slot=approval-requester]')).toHaveText(
        'Claude Code (an external agent) is asking',
      );
      await expect(card.locator('[data-slot=approval-requester] [translate=no]')).toHaveText('Claude Code');
      await expect(card.getByRole('button', { name: 'Change what Claude Code can do' })).toBeVisible();
      await card.screenshot({ path: `${SCREENS}requester-${name.split(' ')[0]}-${theme}.png` });
    }
    await expectAccessible(page, testInfo, `External agent asks (${theme})`);

    // The link opens External agents at that session.
    await fixture(page, 'budgetCap · external')
      .getByRole('button', { name: 'Change what Claude Code can do' })
      .click();
    await expect(page).toHaveURL(/\/settings\/external-agents/);
    expect(problems).toEqual([]);
  });
}

test('in the pseudo-locale every card fits a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await fakes(page, { onboarding: 'done' });
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await open(page, KIT);
  await gallery(page).scrollIntoViewIfNeeded();
  const overflowing = await gallery(page)
    .locator('figure > :first-child')
    .evaluateAll((cards) =>
      cards
        .filter((card) => card.scrollWidth > card.clientWidth + 1)
        .map((card) => card.parentElement?.getAttribute('data-fixture')),
    );
  expect(overflowing).toEqual([]);
});
