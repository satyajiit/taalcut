// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4 (B8): the export approval's review page. The chat's card is a summary that leads to it; the page shows the
// video first, at its own shape on the viewer grey, Export under it, and the other choices behind Options. Space
// plays and pauses, ⌘↩ exports, Escape goes back to the chat. On the fake's hidden demo chat (chat/fake-seed.ts
// reviewDemo), so the page has an export waiting at a fixed link. A swap made on the page closes that approval and
// the run asks again under the same card with a new one (chat/fake-reask.ts, as the agent does): the page follows.
import { expect, test, type Page } from '@playwright/test';
import { REVIEW_APPROVAL, REVIEW_CHAT } from './routes.ts';
import { open, preferences } from './support.ts';
import { expectAccessible, fakes, shoot } from './ui2b-support.ts';

const CHAT = { name: 'chat-review-demo', path: `/chat/${REVIEW_CHAT}` };
const REVIEW = { name: 'chat-review', path: `/chat/${REVIEW_CHAT}/review/${REVIEW_APPROVAL}` };
const reviewPage = (page: Page) => page.locator('[data-slot=review-page]');
const bar = (page: Page) => page.locator('[data-slot=review-bar]');
const summary = (page: Page) => page.locator('[data-card-type=exportApproval]');
const playButton = (page: Page) => page.locator('[data-slot=review-video] button[aria-label]');

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 6 });
});

test('the chat’s card is a summary that opens the review page; Escape goes back to the chat', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, CHAT);
  await expect(summary(page)).toContainText('Ready to export');
  // Nothing on the card decides: one button to the page where you do.
  await expect(summary(page).getByRole('button')).toHaveText(['Review and export']);
  await summary(page).getByRole('button', { name: 'Review and export' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}/review/${REVIEW_APPROVAL}$`));
  await expect(reviewPage(page)).toHaveAttribute('data-status', 'pending');
  // The video comes first, then the bar: Export, with its key.
  const video = page.locator('[data-slot=review-video]');
  const exportButton = bar(page).getByRole('button', { name: 'Export', exact: true });
  expect((await video.boundingBox())!.y).toBeLessThan((await exportButton.boundingBox())!.y);
  await expect(exportButton).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter');
  // A 9:16 video stays 9:16: taller than wide, never stretched to the stage.
  const box = (await video.boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(16 / 9, 1);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
  await expect(summary(page)).toBeVisible();
});

test('Space plays and pauses; Options opens the other choices and Escape leaves a menu first', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, REVIEW);
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause');
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');

  const toggle = page.locator('[data-slot=review-options-toggle]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Where it’s going' })).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Quick swaps', 'Where it’s going', 'Music', 'Captions', 'Anything else'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // Space on a control is the control's: the captions switch flips, the video doesn't start.
  const captions = page.getByRole('switch', { name: 'Captions in the video' });
  await captions.focus();
  const was = await captions.getAttribute('aria-checked');
  await page.keyboard.press('Space');
  await expect(captions).not.toHaveAttribute('aria-checked', was ?? '');
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
});

test('Not now goes back to the chat and the card says so', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, REVIEW);
  await bar(page).getByRole('button', { name: 'Not now' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
  await expect(summary(page)).toHaveAttribute('data-status', 'declined');
  await expect(summary(page)).toContainText('Not exported. Say when you’re ready.');
  await expect(summary(page).getByRole('button', { name: 'Review and export' })).toHaveCount(0);
});

test('⌘↩ exports from anywhere on the page and goes back to the chat', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, REVIEW);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
  await expect(summary(page)).toHaveAttribute('data-status', 'exported');
  await expect(summary(page)).toContainText('Exported');
});

test('the chat stays current in Recent chats while its review page is open', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  // The review demo isn't in the sidebar's list, so this uses a listed chat with no export waiting.
  const listed = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6';
  await open(page, { name: 'chat-review-listed', path: `/chat/${listed}/review/nothing-here` });
  await expect(page.getByRole('heading', { name: 'Nothing to review here' })).toBeVisible();
  // The router marks the link aria-current on any child route by itself; the row's own mark is what shows it.
  await expect(page.locator(`nav a[href="/chat/${listed}"] [data-slot=current-indicator]`)).toHaveCount(1);
});

test('a swap made on the page: it updates, follows the approval the run asks again with, and exports', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, REVIEW);
  await page.locator('[data-slot=review-options-toggle]').click();
  await page.getByRole('listbox', { name: 'Clips' }).getByRole('option').nth(1).click();
  await page
    .getByRole('group', { name: /^Other shots for clip/ })
    .getByRole('button', { name: /^Swap in this shot/ })
    .first()
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Updating with your swap' }).first()).toBeVisible();
  // The new approval, under the same card: the page stays, its link moves to it, and Export is offered again.
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}/review/ap-[0-9A-HJKMNP-TV-Z]{26}$`));
  await expect(reviewPage(page)).toHaveAttribute('data-status', 'pending');
  await expect(page.getByRole('heading', { name: 'Nothing to review here' })).toHaveCount(0);
  const exportButton = bar(page).getByRole('button', { name: 'Export', exact: true });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
  await expect(summary(page)).toHaveAttribute('data-status', 'exported');
});

test('a link with no export waiting says so and leads back to the chat', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'chat-review-missing', path: `/chat/${REVIEW_CHAT}/review/nothing-here` });
  await expect(page.getByRole('heading', { name: 'Nothing to review here' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the chat' }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
});

test('a link with no export waiting: Escape goes back to the chat too', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'chat-review-missing', path: `/chat/${REVIEW_CHAT}/review/nothing-here` });
  await expect(page.getByRole('heading', { name: 'Nothing to review here' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/chat/${REVIEW_CHAT}$`));
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe-clean in ${theme}, Options closed and open`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, REVIEW);
    await expect(playButton(page)).toBeVisible();
    await expectAccessible(page, testInfo, `review page (${theme})`);
    await shoot(page, `review-${theme}`);
    await page.locator('[data-slot=review-options-toggle]').click();
    await expect(page.getByRole('heading', { name: 'Music', exact: true })).toBeVisible();
    await expectAccessible(page, testInfo, `review page, Options open (${theme})`);
    await shoot(page, `review-options-${theme}`);
  });

  test(`REF1: the music off shows the add-the-sound steps for the chosen app, axe-clean in ${theme}`, async ({
    page,
  }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, REVIEW);
    await page.locator('[data-slot=review-options-toggle]').click();
    const music = page.getByRole('switch', { name: 'Music in the video' });
    await expect(music).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /The reel’s music/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await music.click();
    await expect(music).toHaveAttribute('aria-checked', 'false');
    const steps = page.getByRole('region', { name: 'Add the sound in the app' });
    await expect(steps).toBeVisible();
    await expect(steps).toContainText('instagram.com/reel/');
    await expect(steps.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(steps.locator('p').filter({ hasText: /^In / })).toBeVisible();
    await steps.scrollIntoViewIfNeeded();
    await expectAccessible(page, testInfo, `review page, music off (${theme})`);
    await shoot(page, `ref1-review-music-off-${theme}`);
  });
}
