// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-R2 "full keyboard path for the core journey" (apps/renderer/SPEC.md, "P3-R2: accessibility pass targets"),
// against the fake backend, with no pointer event: a new chat → an opening choice (paste a reel, which goes at
// once: REF1) → the breakdown's slots → a swap on the cast board → the export approval → Export → Show in Finder;
// then the editor: select, trim and move a clip, undo, and the export dialog, whose Escape gives focus back.
// Every focus stop on the way must show a ring (2.4.7) and not be entirely covered (2.4.11); Tab never gets stuck
// (2.1.2) and an action never drops focus to the page (2.4.3).
import { expect, test, type Page } from '@playwright/test';
import { CHAT_URL } from './review-support.ts';
import { backend } from './backend-driver.ts';
import { FocusLog, focusStop, tabTo } from './keyboard.ts';
import { PROJECT } from './routes.ts';
import { open, preferences, watchProblems } from './support.ts';
import { fakes } from './ui2b-support.ts';

const REEL = 'https://www.instagram.com/reel/C9xYz12AbCd/';
const card = (page: Page, type: string) => page.locator(`[data-card-type=${type}]`);
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);

test.use({ hasTouch: false });

test('the chat: a reel to an exported video and Show in Finder, keyboard only', async ({ page }) => {
  test.slow();
  const problems = await watchProblems(page);
  const log = new FocusLog();
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { speed: 6 });
  await open(page, { name: 'chat', path: '/chat' });

  // An opening choice: Paste a reel puts the caret in the link field.
  await tabTo(page, page.getByRole('button', { name: /Paste a reel/ }), log, { where: 'Paste a reel' });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Link to a reel')).toBeFocused();
  await page.keyboard.type(REEL);
  await tabTo(page, page.getByRole('button', { name: 'Read this reel' }), log, { where: 'Read this reel' });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);

  // The link goes at once (REF1: no download warning to answer); focus stays in the chat while it reads.
  await expect(page.locator('[data-slot=warning-card]')).toHaveCount(0);
  await log.check(page, 'after Read this reel');

  // The breakdown's card is a summary (BRK1-REV); Review the reel opens the review over the chat. Inside it the
  // slots are one tab stop and the arrows move between them; Escape closes it and focus goes back to the button.
  const review = card(page, 'breakdown').getByRole('button', { name: 'Review the reel' });
  await expect(review).toBeVisible({ timeout: 20_000 });
  const exportCard = card(page, 'exportApproval');
  await expect(exportCard).toContainText('Ready to export', { timeout: 30_000 });
  await log.check(page, 'when the approval arrived');
  await tabTo(page, review, log, { where: 'Review the reel', back: true, max: 120 });
  await page.keyboard.press('Enter');
  const sheet = page.locator('[data-slot=review-sheet]');
  await expect(sheet).toBeVisible();
  await log.check(page, 'in the review');
  const slots = sheet.getByRole('listbox', { name: 'Slots' });
  await tabTo(page, slots, log, { where: 'Slots', max: 40 });
  const first = await focusStop(page);
  // A horizontal strip (aria-orientation): the right arrow is the next slot.
  await page.keyboard.press('ArrowRight');
  expect((await focusStop(page)).name, 'ArrowRight moves inside the slots').not.toBe(first.name);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(review).toBeFocused();

  // A swap on the cast board while the export waits: the grid's one tab stop, then the arrows.
  const grid = card(page, 'castBoard').getByRole('grid', { name: 'Your clips, slot by slot' });
  await tabTo(page, grid, log, { where: 'cast board', max: 120 });
  await page.keyboard.press('ArrowRight');
  await expect(grid.locator('[data-alternate]').first()).toBeFocused();
  await log.check(page, 'an other shot');
  await page.keyboard.press('Enter');
  await expect.poll(() => ran(page, 'timeline.swapClip')).toEqual(['ui']);
  await expect(exportCard).toHaveAttribute('data-status', 'pending', { timeout: 20_000 });

  // The approval (UX4): its review page from the card, then ⌘↩ exports and goes back to the chat.
  await tabTo(page, exportCard.getByRole('button', { name: 'Review and export' }), log, {
    where: 'Review and export',
    max: 120,
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-slot=review-page]')).toBeVisible();
  await log.check(page, 'on the review page');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(CHAT_URL);
  await expect(exportCard).toHaveAttribute('data-status', 'exported', { timeout: 30_000 });
  // The run's last words and the next choices come after the card says exported. Checked once the run has
  // ended, the walk below sees one settled transcript at any machine speed, and the card that kept the focus
  // must still be in view after the transcript grew under it (IX3-F4).
  await expect(card(page, 'openingChoices')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-notice=paused]')).toHaveCount(0);
  await log.check(page, 'after Export');

  // Show in Finder on the finished render.
  const reveal = page.getByRole('button', { name: 'Show in Finder' }).last();
  await expect(reveal).toBeVisible({ timeout: 30_000 });
  await tabTo(page, reveal, log, { where: 'Show in Finder', max: 120 });
  await page.keyboard.press('Enter');

  expect(log.problems, `focus stops:\n${log.stops.join('\n')}`).toEqual([]);
  expect(problems).toEqual([]);
});

test('the editor: select, trim and move a clip, undo, and the export dialog, keyboard only', async ({
  page,
}) => {
  test.slow();
  const problems = await watchProblems(page);
  const log = new FocusLog();
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { speed: 0, latencyMs: 0 });
  await open(page, { name: 'chat', path: '/chat' });

  // The sidebar's Make (the projects), the project, then its editor: links reached with Tab, opened with Enter.
  await tabTo(
    page,
    page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Make' }),
    log,
    {
      where: 'Make',
    },
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
  const project = page
    .locator(`[data-slot=project-row][data-project-id="${PROJECT}"]`)
    .getByRole('link')
    .first();
  await tabTo(page, project, log, { where: 'Golden hour market', max: 80 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}`));
  await log.check(page, 'the project opened');

  const clips = page.getByRole('listbox', { name: 'Clips' });
  await expect(clips.getByRole('option')).toHaveCount(12, { timeout: 20_000 });
  await tabTo(page, clips, log, { where: 'Clips', max: 80 });
  await page.keyboard.press('ArrowRight');
  const selected = clips.locator('[aria-selected=true]');
  await expect(selected).toBeFocused();
  await log.check(page, 'a clip');
  await page.keyboard.press(']');
  await expect.poll(() => ran(page, 'timeline.trimClip')).toEqual(['ui']);
  const order = () =>
    clips.getByRole('option').evaluateAll((els) => els.map((el) => el.getAttribute('data-clip-id')));
  const before = await order();
  await page.keyboard.press('Meta+ArrowRight');
  await expect.poll(() => ran(page, 'timeline.moveClip')).toEqual(['ui']);
  await expect.poll(order).not.toEqual(before);
  await log.check(page, 'after moving');
  // ⌘Z puts the clip back (undo is the project's history, not a command of its own); focus stays on a clip.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(order, { timeout: 500 }).toEqual(before);
  }).toPass();
  await log.check(page, 'after undo');

  // The export dialog opens from its button and Escape gives focus back to it.
  const exportButton = page.locator('[data-slot=export]');
  await tabTo(page, exportButton, log, { where: 'Export…', max: 80 });
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await log.check(page, 'in the export dialog');
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
    'focus moves into the dialog',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();

  expect(log.problems, `focus stops:\n${log.stops.join('\n')}`).toEqual([]);
  expect(problems).toEqual([]);
});
