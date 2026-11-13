// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-M11 (the window's part): Exports lists every render live, in each state, with its next step;
// Export again, Delete with Undo, the QA review (a fix, then export again; or Export anyway, a person's
// alone), and the export dialog: presets with their limits, the reel's music on by default with its line
// and its off switch (REF1), captions, then the same dialog following the export to Exported.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { fakeChat, open, preferences, screenshotWhole, watchProblems } from './support.ts';

// The YouTube Shorts radio, not its AV1 sibling ("YouTube Shorts (AV1)"): a radio's name runs on into its limit
// and size, so it is matched from the start and stops short of the AV1 one.
const SHORTS = /^YouTube Shorts(?! \(AV1\))/;
const RENDERS = { name: 'renders', path: '/renders' };

const rows = (page: Page) => page.locator('[data-slot=render-row]');
const inState = (page: Page, status: string) => page.locator(`[data-slot=render-row][data-status=${status}]`);
const toast = (page: Page) => page.locator('[data-slot=toast]').last();
const ran = async (page: Page, prefix: string) =>
  (await backend.dispatched(page)).filter((d) => d.name.startsWith(prefix));

test.describe('exports (P2-M11)', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0 });
  });

  test('every export in its state, with its next step', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, RENDERS);
    await expect(rows(page)).toHaveCount(7);
    await expect(inState(page, 'queued')).toContainText('Waiting to start');
    await expect(inState(page, 'rendering').getByRole('progressbar')).toBeVisible();
    await expect(inState(page, 'rendering').getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(inState(page, 'ready').first()).toContainText('Checked: 22 of 23 passed');
    await expect(
      inState(page, 'ready').first().getByRole('button', { name: 'Show in Finder' }),
    ).toBeVisible();
    await expect(inState(page, 'needsAttention').getByRole('button', { name: 'Review' })).toBeVisible();
    await expect(inState(page, 'failed')).toContainText('There isn’t enough free space');
    await expect(inState(page, 'cancelled')).toContainText('Stopped before it finished.');
    await inState(page, 'ready').first().getByRole('button', { name: 'Show in Finder' }).click();
    expect(problems).toEqual([]);
  });

  test('Cancel stops a running export; Export again starts another for a new preset', async ({ page }) => {
    await open(page, RENDERS);
    await inState(page, 'rendering').getByRole('button', { name: 'Cancel' }).click();
    await expect(inState(page, 'cancelled')).toHaveCount(2);
    await inState(page, 'ready').first().getByRole('button', { name: 'Export again' }).click();
    await page.getByRole('menuitem', { name: 'TikTok' }).click();
    await expect(rows(page)).toHaveCount(8);
    expect(await ran(page, 'render.')).toEqual([
      { name: 'render.cancel', source: 'ui' },
      { name: 'render.export', source: 'ui' },
    ]);
  });

  test('Delete takes an export off the list; Undo in the toast brings it back', async ({ page }) => {
    await open(page, RENDERS);
    const first = inState(page, 'ready').first();
    const name = (await first.locator('[data-user-content]').first().textContent()) ?? '';
    await first.getByRole('button', { name: `More for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Delete export' }).click();
    await expect(rows(page)).toHaveCount(6);
    await expect(toast(page)).toContainText(`Deleted ${name}`);
    await toast(page).getByRole('button', { name: 'Undo' }).click();
    await expect(rows(page)).toHaveCount(7);
  });

  test('the QA review: a fix changes the video, then it exports again and is checked again', async ({
    page,
  }) => {
    await open(page, RENDERS);
    await inState(page, 'needsAttention').getByRole('button', { name: 'Review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Needs review before you post it' });
    await expect(dialog.locator('[data-slot=safe-zones]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Move the captions' }).click();
    await expect(dialog.getByRole('status')).toContainText('Changed. Export again to check it.');
    await dialog.getByRole('button', { name: 'Export again' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows(page)).toHaveCount(8);
    expect((await ran(page, 'captions.')).concat(await ran(page, 'render.'))).toEqual([
      { name: 'captions.setStyle', source: 'ui' },
      { name: 'render.export', source: 'ui' },
    ]);
  });

  test('Export anyway is the person’s: the review closes and the export is ready', async ({ page }) => {
    await open(page, RENDERS);
    await inState(page, 'needsAttention').getByRole('button', { name: 'Review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Needs review before you post it' });
    await dialog.getByRole('button', { name: 'Export anyway' }).click();
    await expect(dialog).toBeHidden();
    await expect(inState(page, 'needsAttention')).toHaveCount(0);
    await expect(page.locator('[data-slot=qa-summary][data-verdict=overridden]')).toHaveCount(1);
    expect(await ran(page, 'render.overrideQa')).toEqual([{ name: 'render.overrideQa', source: 'ui' }]);
  });

  test('the export dialog: preset, the reel’s music on by default and the steps when it’s off, captions; then it follows the export', async ({
    page,
  }) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 40 });
    await open(page, RENDERS);
    await inState(page, 'ready').first().getByRole('button', { name: 'Export again' }).click();
    await page.getByRole('menuitem', { name: 'More options…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await expect(dialog.getByRole('radio', { name: /Instagram Reels/ })).toBeVisible();
    await dialog.getByRole('radio', { name: SHORTS }).click();
    await expect(dialog.getByRole('radio', { name: SHORTS })).toHaveAttribute('aria-checked', 'true');
    // One decision a step (UX4): the sound is the next one.
    const next = dialog.getByRole('button', { name: 'Next', exact: true });
    await next.click();
    await expect(dialog.getByRole('heading', { level: 3, name: 'Sound' })).toBeFocused();
    // REF1: the reel's music is in the video by default, with its one line; no warning stands before it.
    const music = dialog.getByRole('switch', { name: 'Music in the video' });
    await expect(music).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('radio', { name: /The reel’s music/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(dialog).toContainText('Instagram and YouTube may mute music added outside their apps.');
    await expect(dialog.locator('[data-slot=reference-audio-warning]')).toHaveCount(0);
    // Off: the steps for adding the sound in YouTube, with the reel's link and sound.
    await music.click();
    const steps = dialog.getByRole('region', { name: 'Add the sound in the app' });
    await expect(steps).toBeVisible();
    await expect(steps).toContainText('Golden Hour (sped up) · JVKE');
    await expect(steps).toContainText('instagram.com/reel/');
    await expect(steps).toContainText('In YouTube Shorts');
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(steps.getByRole('listitem').first()).toHaveText('Upload the video in the YouTube app.');
    // And on again: the reel's music comes back.
    await music.click();
    await expect(dialog.getByRole('radio', { name: /The reel’s music/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await ran(page, 'music.')).toEqual([
      { name: 'music.choosePath', source: 'ui' },
      { name: 'music.choosePath', source: 'ui' },
    ]);
    await next.click();
    await dialog.getByRole('switch', { name: 'Also save a subtitle file (.srt)' }).click();
    // On to the summary, then Export.
    while (await next.isVisible()) await next.click();
    await expect(dialog.getByRole('heading', { level: 3, name: 'Ready to export' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Export for YouTube Shorts' }).click();
    await expect(dialog.locator('[data-slot=render-progress]')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Exported' })).toBeVisible({ timeout: 20_000 });
    // The export's moment: Kaatu, Show in Finder and Make another.
    await expect(dialog.getByRole('button', { name: 'Show in Finder' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Make another' })).toBeVisible();
    // Save as…: main's save panel (the fake answers with a name), then one quiet line saying where it went.
    await dialog.getByRole('button', { name: 'Save as…' }).click();
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Saved a copy as Golden hour market.mp4' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
  });

  test('an export that ends while you watch gets its moment: Kaatu, Show in Finder, Make another', async ({
    page,
  }) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 40 });
    await open(page, RENDERS);
    const moment = page.locator('main [data-slot=kaatu-moment][data-tone=success]');
    await expect(moment).toBeVisible({ timeout: 20_000 });
    await expect(moment).toContainText('is ready to post.');
    await expect(moment.getByRole('button', { name: 'Show in Finder' })).toBeVisible();
    await expect(moment.getByRole('link', { name: 'Make another' })).toHaveAttribute('href', '/chat');
  });

  test('nothing exported yet: where exports land, and one way to start', async ({ page }) => {
    await fakeChat(page, { latencyMs: 30, projects: 'empty' });
    await open(page, RENDERS);
    await expect(page.getByRole('heading', { name: 'Your exports show up here' })).toBeVisible();
    // The page's own Kaatu; the companion at the sidebar's foot is the sidebar's (UX4).
    await expect(page.locator('main [data-slot=mascot]')).toHaveCount(1);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`REF1: the music step, on and off, passes axe (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, RENDERS);
      await inState(page, 'ready').first().getByRole('button', { name: 'Export again' }).click();
      await page.getByRole('menuitem', { name: 'More options…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Export' });
      await dialog.getByRole('radio', { name: /Instagram Reels/ }).click();
      await dialog.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(dialog.getByRole('heading', { level: 3, name: 'Sound' })).toBeFocused();
      await expect(dialog.getByRole('switch', { name: 'Music in the video' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expectAccessible(page, testInfo, `export dialog, music on (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-export-music-on.png`);
      await dialog.getByRole('switch', { name: 'Music in the video' }).click();
      const steps = dialog.getByRole('region', { name: 'Add the sound in the app' });
      await expect(steps).toContainText('In Instagram Reels');
      await expect(
        dialog
          .locator('[data-slot=platform-sound-steps]')
          .locator('xpath=ancestor::*[@data-slot="collapse"][1]'),
      ).toHaveAttribute('data-state', 'open');
      await expectAccessible(page, testInfo, `export dialog, music off (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-export-music-off.png`);
      // The summary says it in words.
      const next = dialog.getByRole('button', { name: 'Next', exact: true });
      while (await next.isVisible()) await next.click();
      await expect(dialog.locator('[data-slot=export-summary]')).toContainText(
        'No music in the file: add the sound in the app',
      );
    });

  test('axe finds nothing on the list, the review and the export dialog, light and dark', async ({
    page,
  }, testInfo) => {
    // Six axe runs, two themes: slow on a loaded machine.
    test.slow();
    for (const theme of ['light', 'dark'] as const) {
      await preferences(page, { theme, locale: 'en' });
      await open(page, RENDERS);
      await expectAccessible(page, testInfo, `exports (${theme})`);
      await inState(page, 'needsAttention').getByRole('button', { name: 'Review' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, testInfo, `exports, review (${theme})`);
      await page.keyboard.press('Escape');
      await inState(page, 'ready').first().getByRole('button', { name: 'Export again' }).click();
      await page.getByRole('menuitem', { name: 'More options…' }).click();
      await expect(page.locator('[data-slot=export-form]')).toBeVisible();
      await expectAccessible(page, testInfo, `exports, export form (${theme})`);
      await page.keyboard.press('Escape');
    }
  });
});
