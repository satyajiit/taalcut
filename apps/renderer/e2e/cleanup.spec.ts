// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V9 "Done when": a talking head cleans up in one undoable step. The lower Clean up speech panel against the
// fake (src/backend/fake/make/p3/fake-cleanup.ts, the talking-head project seeded with
// `{ "cleanup": { "talkingHead": true } }`): the switches and the pause slider ask for a new plan without running
// anything, Apply runs the plan shown, Undo puts the speech back, and a plan the video has moved past is stale
// until it is checked again. The cleanup card's fixtures are shot from /dev/kit.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { openEditorTask, showDetailedTimeline } from './editor-navigation';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean } from './ui2b-support.ts';

const SCREENS = process.env.TAALCUT_CLEANUP_SCREENS ?? new URL('screenshots/cleanup/', ARTIFACTS).pathname;
const TALKING_PROJECT = '01K7C5M6Q8M00000000000001W';
const TALKING_TIMELINE = '01K7C5M6Q8N00000000000001W';
const EDITOR = { name: 'project-timeline', path: `/projects/${TALKING_PROJECT}/timeline` };
const KIT = { name: 'dev-kit', path: '/dev/kit' };

const panel = (page: Page) => page.locator('[data-slot=cleanup-panel]');
const sentence = (page: Page) => panel(page).locator('[data-slot=cleanup-sentence]');
const apply = (page: Page) => panel(page).locator('[data-slot=cleanup-apply]');
const clips = (page: Page) => page.locator('[data-slot=timeline-clip]');
const total = (page: Page) => page.locator('[data-slot=timecode] span').last();
const ran = async (page: Page) =>
  (await backend.dispatched(page)).filter((d) => d.name === 'timeline.applyCleanup').map((d) => d.source);

/** The talking-head video with its Clean up panel open and its first plan shown. */
async function openCleanup(page: Page) {
  await open(page, EDITOR);
  await showDetailedTimeline(page);
  await openEditorTask(page, 'cleanup');
  await expect(sentence(page)).toContainText(/Remove \d+ fillers/);
  await expect(apply(page)).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ speed: 0, latencyMs: 0, cleanup: { talkingHead: true } }),
  });
});

test.describe('clean up speech (P3-V9)', () => {
  test('the switches and the pause slider re-plan without running anything; the bed marks the cut', async ({
    page,
  }) => {
    await openCleanup(page);
    await expect(
      page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-removed]').first(),
    ).toBeAttached();
    await expect(
      page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-punch]').first(),
    ).toBeAttached();

    await panel(page).getByRole('switch', { name: 'Remove fillers (um, uh)' }).click();
    await expect(sentence(page)).not.toContainText('fillers');
    const withoutFillers = await sentence(page).textContent();

    const slider = panel(page).getByRole('slider', { name: 'Longest pause to keep' });
    await slider.focus();
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', /2/);
    await expect(panel(page).getByRole('switch', { name: /Shorten pauses longer than 2/ })).toBeVisible();
    await expect(sentence(page)).not.toHaveText(withoutFillers ?? '');

    await panel(page).getByRole('switch', { name: 'Punch in on stressed words' }).click();
    await expect(page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-punch]')).toHaveCount(0);
    // Every change was a read: nothing ran on the bus, and the video is as it was.
    expect(await ran(page)).toEqual([]);
    await expect(clips(page)).toHaveCount(3);
    await showDetailedTimeline(page);
    await expect(
      page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-removed]').first(),
    ).toBeVisible();
  });

  test('Apply runs the plan shown, the toast’s Undo puts the speech back', async ({ page }) => {
    await openCleanup(page);
    await expect(total(page)).toHaveText('00:54');
    await panel(page).getByRole('switch', { name: 'Cut retakes (keep the last take)' }).click();
    await expect(sentence(page)).not.toContainText('retakes');
    await expect(apply(page)).toBeEnabled();
    await apply(page).click();

    await expect(panel(page).locator('[data-slot=cleanup-applied]')).toContainText(/Cleaned up: .+ shorter/);
    expect(await ran(page)).toEqual(['ui']);
    await expect(total(page)).not.toHaveText('00:54');
    // The retakes stayed: the plan applied is the one shown, not the agent's default.
    await expect.poll(() => clips(page).count()).toBeGreaterThan(3);
    await expect(page.locator('[data-slot=cleanup-bed-marks]')).toHaveCount(0);

    const toast = page.locator('[data-slot=toast]').last();
    await expect(toast).toContainText('Cleaned up');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(clips(page)).toHaveCount(3);
    await expect(total(page)).toHaveText('00:54');
    await expect(sentence(page)).toContainText(/Remove \d+ fillers/);
  });

  test('a plan the video has moved past is stale until it is checked again', async ({ page }) => {
    await openCleanup(page);
    const first = await clips(page).first().getAttribute('data-clip-id');
    const moved = await backend.agentDispatch(page, 'timeline.moveClip', {
      projectId: TALKING_PROJECT,
      timelineId: TALKING_TIMELINE,
      clipId: first,
      toIndex: 2,
    });
    expect(moved).toBe(true);
    const stale = panel(page).locator('[data-slot=cleanup-stale]');
    await expect(stale).toContainText('Your video changed since this check.');
    await expect(apply(page)).toBeDisabled();
    await expect(page.locator('[data-slot=cleanup-bed-marks]')).toHaveCount(0);
    await stale.getByRole('button', { name: 'Check again' }).click();
    await expect(stale).toHaveCount(0);
    await expect(apply(page)).toBeEnabled();
    await expect(
      page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-removed]').first(),
    ).toBeAttached();
    expect(await ran(page)).toEqual([]);
    await showDetailedTimeline(page);
    await expect(
      page.locator('[data-slot=cleanup-bed-marks] [data-slot=cleanup-removed]').first(),
    ).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const)
    test(`axe is clean on the panel and the card (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await openCleanup(page);
      await expectAccessible(page, testInfo, `cleanup panel ${theme}`);
      await page.screenshot({ path: `${SCREENS}/panel-${theme}.png` });

      await open(page, KIT);
      for (const state of ['proposed', 'stale', 'applied', 'nothingToCut']) {
        const figure = page.locator(`figure[data-fixture="cleanupPlan · ${state}"]`);
        await figure.scrollIntoViewIfNeeded();
        await expect(figure.locator('[data-card-type=cleanupPlan]')).toBeVisible();
        await figure.screenshot({ path: `${SCREENS}/card-${state}-${theme}.png` });
      }
      const stale = page.locator('figure[data-fixture="cleanupPlan · stale"]');
      await expect(stale.locator('[data-slot=cleanup-stale]')).toContainText('Check again');
      await expect(page.locator('figure[data-fixture="cleanupPlan · applied"]')).toContainText(
        'Cleaned up: 11s shorter',
      );
      await expectAccessible(page, testInfo, `cleanup cards ${theme}`);
    });

  test('the pseudo-locale fits, and reduced motion still plans', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, EDITOR);
    await openEditorTask(page, 'cleanup');
    await expect(panel(page).locator('[data-slot=cleanup-sentence]')).toBeVisible();
    await expect(panel(page).locator('[data-slot=cleanup-apply]')).toBeEnabled();
    await expectPseudoClean(page, 'cleanup panel en-XA');
    await page.screenshot({ path: `${SCREENS}/panel-light-en-XA.png` });
  });
});
