// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V16 on /projects: several projects picked, one look on all their videos in one batch.applyStyle (the videos
// without captions skipped, said in words), undone from the toast in the app-wide history (a video changed since
// keeps its look, and the toast says so); and Export all sends every video in one render.exportBatch. UX1: picking
// is a mode (Select, or a row's box), with Select all and Done in the bulk bar. The fake's `styles: 'uncaptioned'`
// takes the captions off Golden hour market's second and third videos.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { open, preferences } from './support.ts';
import { expectAccessible } from './ui2b-support.ts';

const PROJECTS = { name: 'projects', path: '/projects' };
const GOLDEN_TIMELINES = [
  '01K7C5M6Q8R9S0T1V2W3X4Y5ZB',
  '01K7C5M6Q8N000000000000002',
  '01K7C5M6Q8N000000000000003',
];
const MONSOON = '01K7C5M6Q8Z000000000000002';

const toast = (page: Page) => page.locator('[data-slot=toast]').last();
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected projects' });

/** A video as the fake holds it (make.timelines.get). */
function video(page: Page, timelineId: string) {
  return page.evaluate((id) => {
    const fake = (
      window as unknown as {
        taalcutFake: { make: { timelines: { get(id: string): unknown } } };
      }
    ).taalcutFake;
    return JSON.parse(JSON.stringify(fake.make.timelines.get(id))) as {
      styleId: string | null;
      captions: { styleSource: string; style: { font: string } } | null;
    };
  }, timelineId);
}

test.describe('projects, many at once (P3-V16)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await page.addInitScript(() =>
      window.localStorage.setItem(
        'taalcut.fake',
        JSON.stringify({ latencyMs: 20, renderTickMs: 0, styles: 'uncaptioned' }),
      ),
    );
  });

  test('a caption style on two projects skips the videos without captions; Undo puts it back', async ({
    page,
  }, testInfo) => {
    await open(page, PROJECTS);
    // Keyboard: Space on each row's checkbox.
    await page.getByRole('checkbox', { name: 'Select Golden hour market' }).press('Space');
    await page.getByRole('checkbox', { name: 'Select Trip to Goa reel' }).press('Space');
    await expect(bar(page)).toContainText('2 projects selected · 4 videos');
    await expectAccessible(page, testInfo, 'projects with two selected');
    await bar(page).getByRole('button', { name: 'Apply a look…' }).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Apply a look' });
    await expect(dialog).toContainText('4 videos. Pick a look to put on them.');
    await dialog.getByRole('radio', { name: 'Bold captions' }).check();
    await expect(dialog).toContainText('4 videos get this look.');
    await expectAccessible(page, testInfo, 'apply a look dialog');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText('Applied Bold captions to 2 videos');
    await expect(toast(page)).toContainText('2 videos have no captions, so they kept their look');
    const batches = (await backend.dispatched(page)).filter((d) => d.name.startsWith('batch.'));
    expect(batches).toEqual([{ name: 'batch.applyStyle', source: 'ui' }]);
    expect((await video(page, GOLDEN_TIMELINES[0]!)).captions?.style.font).toBe('anton');
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(async () => (await video(page, GOLDEN_TIMELINES[0]!)).captions?.style.font)
      .not.toBe('anton');
  });

  test('a brand kit on every video; one changed since keeps its look when the batch is undone', async ({
    page,
  }) => {
    await open(page, PROJECTS);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await bar(page).getByRole('checkbox', { name: 'Select all projects' }).check();
    await bar(page).getByRole('button', { name: 'Apply a look…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Apply a look' });
    await dialog.getByRole('radio', { name: /Chai & Co\./ }).check();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(toast(page)).toContainText('Applied Chai & Co. to 5 videos');
    // The agent changes one video's look after the batch.
    expect(
      await backend.agentDispatch(page, 'timeline.setStyle', {
        projectId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZA',
        timelineId: GOLDEN_TIMELINES[1],
        styleId: MONSOON,
      }),
    ).toBe(true);
    await toast(page).filter({ hasText: 'Applied Chai & Co.' }).getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-slot=toast]').filter({ hasText: 'was changed since' })).toContainText(
      '1 video was changed since; its look stays',
    );
    expect((await video(page, GOLDEN_TIMELINES[0]!)).styleId).toBeNull();
    expect((await video(page, GOLDEN_TIMELINES[1]!)).styleId).toBe(MONSOON);
  });

  test('Export all sends every video of the picked projects in one render.exportBatch', async ({ page }) => {
    await open(page, PROJECTS);
    await page.getByRole('checkbox', { name: 'Select Golden hour market' }).check();
    await bar(page).getByRole('button', { name: 'Export all…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export all' });
    await expect(dialog).toContainText('3 videos will be exported.');
    await dialog.getByRole('combobox', { name: 'Where they’re going' }).selectOption('reels');
    await dialog.getByRole('button', { name: 'Export all' }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText('Exporting 3 videos');
    const sent = (await backend.dispatched(page)).filter((d) => d.name.startsWith('render.'));
    expect(sent).toEqual([{ name: 'render.exportBatch', source: 'ui' }]);
  });

  test('a project with no videos leaves both actions off, and Done leaves selection mode', async ({
    page,
  }) => {
    await open(page, PROJECTS);
    await page.getByRole('checkbox', { name: 'Select Product teaser, 15 s' }).check();
    await expect(bar(page)).toContainText('1 project selected · no videos yet');
    await expect(bar(page).getByRole('button', { name: 'Apply a look…' })).toBeDisabled();
    await expect(bar(page).getByRole('button', { name: 'Export all…' })).toBeDisabled();
    await bar(page).getByRole('button', { name: 'Done' }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Select Product teaser, 15 s' })).not.toBeChecked();
  });

  test('the bulk bar and dialogs are accessible in dark', async ({ page }, testInfo) => {
    await preferences(page, { theme: 'dark', locale: 'en' });
    await open(page, PROJECTS);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await bar(page).getByRole('checkbox', { name: 'Select all projects' }).check();
    await expectAccessible(page, testInfo, 'projects selected (dark)');
    await bar(page).getByRole('button', { name: 'Export all…' }).click();
    await expect(page.getByRole('dialog', { name: 'Export all' })).toContainText('videos will be exported.');
    await expectAccessible(page, testInfo, 'export all dialog (dark)');
  });
});
