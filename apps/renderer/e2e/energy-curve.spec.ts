// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V12 "Done when": the energy curve re-casts and re-times, undoably. The Pacing tab under the editor's bed
// and on the template page, against the fake (src/backend/fake/make/p3/fake-energy.ts): a change previews
// (ghost cuts, "N shots will be picked again") without dispatching, Apply is one command and one ⌘Z, each band
// is a slider the keyboard drives, and a video or template without music beats says so.
import { expect, test, type Page } from '@playwright/test';
import { showDetailedTimeline } from './editor-navigation';
import { backend } from './backend-driver.ts';
import { PROJECT, TEMPLATE } from './routes.ts';
import { ARTIFACTS, open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes } from './ui2b-support.ts';

const SCREENS = process.env.TAALCUT_ENERGY_SCREENS ?? new URL('screenshots/energy/', ARTIFACTS).pathname;
const PACING = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline?panel=pacing` };
const TRIP = { name: 'project-timeline', path: '/projects/01K7C5M6Q8R9S0T1V2W3X4P001/timeline' };
/** Three-hook vlog opener: a template with no beat map (backend/fake/templates/template-plans.ts). */
// A template's pacing is a page of its own (UX4 tpl: /templates/$templateId/pacing).
const NO_BEATS = {
  name: 'templates-template-pacing',
  path: '/templates/01K7C5M6Q85000000000000003/pacing',
};
const GOLDEN = { name: 'templates-template-pacing', path: `/templates/${TEMPLATE}/pacing` };

const bands = (page: Page) => page.getByRole('slider', { name: /^Section \d+ of \d+$/ });
const band = (page: Page, n: number) => page.getByRole('slider', { name: new RegExp(`^Section ${n} of`) });
const clips = (page: Page) => page.locator('[data-slot=timeline-clip]');
const status = (page: Page) => page.locator('[data-slot=pacing-status]');
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);

test.beforeEach(async ({ page }) => {
  await fakes(page, { speed: 0, latencyMs: 0, renderTickMs: 0 });
});

test.describe('energy curve (P3-V12)', () => {
  test('a faster section previews its cuts, Apply re-cuts the video, one ⌘Z puts it back', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, PACING);
    await showDetailedTimeline(page);
    await expect(clips(page)).toHaveCount(12);
    await expect(bands(page)).toHaveCount(5);
    await expect(status(page)).toHaveAttribute('data-state', 'idle');

    await band(page, 3).focus();
    await page.keyboard.press('End');
    await expect(band(page, 3)).toHaveAttribute('aria-valuetext', 'Energy 100%, cut every beat');
    await expect(status(page)).toHaveAttribute('data-state', 'ready');
    await expect(status(page)).toContainText(/will be picked again/);
    await expect(page.locator('[data-slot=ghost-cut]').first()).toBeAttached();
    // A preview is a read: nothing ran on the bus.
    expect(await ran(page, 'timeline.applyEnergyCurve')).toEqual([]);
    await page.screenshot({ path: `${SCREENS}/editor-preview-light.png` });

    await page.locator('[data-slot=pacing-apply]').click();
    await expect.poll(() => clips(page).count()).toBeGreaterThan(12);
    expect(await ran(page, 'timeline.applyEnergyCurve')).toEqual(['ui']);
    await expect(page.locator('[data-slot=toast]').last()).toContainText('Pacing changed');

    await page.locator('[data-slot=timeline-bed]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(clips(page)).toHaveCount(12);
  });

  test('each band is a slider: arrows 5 %, Page Up 20 %, S splits, M merges; Faster is the drag’s equal', async ({
    page,
  }) => {
    await open(page, PACING);
    await showDetailedTimeline(page);
    const second = band(page, 2);
    await second.focus();
    const start = Number(await second.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowUp');
    await expect(second).toHaveAttribute('aria-valuenow', String(start + 5));
    await page.keyboard.press('PageDown');
    await expect(second).toHaveAttribute('aria-valuenow', String(start - 15));
    await page.keyboard.press('s');
    await expect(bands(page)).toHaveCount(6);
    await band(page, 2).focus();
    await page.keyboard.press('m');
    await expect(bands(page)).toHaveCount(5);

    await band(page, 4).click();
    const before = Number(await band(page, 4).getAttribute('aria-valuenow'));
    await page.getByRole('button', { name: 'Faster' }).click();
    await expect
      .poll(async () => Number(await band(page, 4).getAttribute('aria-valuenow')))
      .toBeGreaterThan(before);
    await page.getByRole('button', { name: /^Beats per cut/ }).click();
    await page.getByRole('menuitemradio', { name: 'Every 8 beats' }).click();
    await expect(page.locator('[data-slot=pacing-words]')).toHaveText('Cut every 8 beats');
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(status(page)).toHaveAttribute('data-state', 'idle');
    expect(await ran(page, 'timeline.applyEnergyCurve')).toEqual([]);
  });

  test('no beat map: a story-mode video has no Pacing tab; a template without beats says why', async ({
    page,
  }) => {
    await open(page, TRIP);
    await showDetailedTimeline(page);
    await expect(clips(page).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pacing' })).toHaveCount(0);
    await open(page, NO_BEATS);
    await expect(page.locator('[data-slot=template-pacing] [data-slot=pacing-no-beats]')).toContainText(
      'follows speech, not music beats',
    );
    await expect(page.locator('[data-slot=pacing-band]')).toHaveCount(0);
  });

  test('the template page: a section changed, Apply makes the next version, Undo puts it back', async ({
    page,
  }) => {
    await open(page, GOLDEN);
    const pacing = page.locator('[data-slot=template-pacing]');
    await expect(pacing.getByRole('slider')).toHaveCount(5);
    await pacing.getByRole('slider').nth(1).focus();
    await page.keyboard.press('End');
    await expect(pacing.locator('[data-slot=pacing-status]')).toContainText(/slots? changes?/);
    expect(await ran(page, 'template.setEnergyCurve')).toEqual([]);
    await pacing.locator('[data-slot=pacing-apply]').click();
    await expect.poll(() => ran(page, 'template.setEnergyCurve')).toEqual(['ui']);
    await expect.poll(() => pacing.getByRole('slider').count()).toBeGreaterThan(0);
    const toast = page.locator('[data-slot=toast]').last();
    await expect(toast).toContainText('Pacing changed');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(pacing.getByRole('slider')).toHaveCount(5);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`axe is clean with a preview showing (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, PACING);
      await showDetailedTimeline(page);
      await band(page, 3).focus();
      await page.keyboard.press('End');
      await expect(status(page)).toHaveAttribute('data-state', 'ready');
      await expectAccessible(page, testInfo, `pacing ${theme}`);
      await page.screenshot({ path: `${SCREENS}/editor-preview-${theme}.png` });
      await open(page, GOLDEN);
      await expect(page.locator('[data-slot=template-pacing] [role=slider]')).toHaveCount(5);
      await expectAccessible(page, testInfo, `template pacing ${theme}`);
      await page
        .locator('[data-slot=template-pacing]')
        .screenshot({ path: `${SCREENS}/template-${theme}.png` });
    });

  test('the pseudo-locale fits, and reduced motion still previews', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, PACING);
    await showDetailedTimeline(page);
    await page.locator('[data-slot=pacing-band]').nth(2).focus();
    await page.keyboard.press('End');
    await expect(status(page)).toHaveAttribute('data-state', 'ready');
    await expectPseudoClean(page, 'pacing en-XA');
    await page.screenshot({ path: `${SCREENS}/editor-preview-light-en-XA.png` });
  });
});
