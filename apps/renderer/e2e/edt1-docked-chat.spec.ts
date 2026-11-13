// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EDT1-CTX "Done when": the editor keeps Chat visible; what is selected on the
// bed, words on screen as much as a clip, shows as a chip in the docked composer and goes with the message, with the
// editor as you see it; the AI's change comes back as one changes card whose rows open their item and whose
// editor's Undo AI changes takes the whole turn back (Redo restores it). In light, dark and pseudo, with axe.
// Against the Make fakes: Golden hour market's first video (12 clips, 4 words on screen) and the fake agent's trim.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { showDetailedTimeline } from './editor-navigation';
import { PROJECT } from './routes.ts';
import { ARTIFACTS, fakeChat, open, preferences, screenshotWhole, watchProblems } from './support.ts';
import { clippedText } from './inspect.ts';
import { expectAccessible, expectPseudoClean } from './ui2b-support.ts';

const SCREENS = process.env.TAALCUT_EDT1_SCREENS ?? new URL('screenshots/edt1-ctx/', ARTIFACTS).pathname;
const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };

const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const clips = (page: Page) => page.locator('[data-slot=timeline-clip]');
const tray = (page: Page) => dock(page).locator('[data-slot=composer] [data-slot=selection-chip]');
const card = (page: Page) => dock(page).locator('[data-card-type=editChanges]');
const widthOf = (page: Page, n: number) =>
  clips(page)
    .nth(n)
    .evaluate((el) => el.getBoundingClientRect().width);

async function ask(page: Page, text: string) {
  const box = dock(page).getByRole('textbox', { name: /.+/ }).last();
  await box.fill(text);
  await box.press('Enter');
}

async function shot(page: Page, name: string) {
  await screenshotWhole(page, new URL(`${name}.png`, `file://${SCREENS.replace(/\/?$/, '/')}`).href);
}

test.beforeEach(async ({ page }) => {
  await fakeChat(page, { speed: 0, latencyMs: 0 });
});

test.describe('the editor’s docked chat (EDT1-CTX)', () => {
  test('chat stays visible through editor tasks and reload', async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, EDITOR);
    await expect(dock(page).getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await page.locator('[data-tool=sound]').click();
    await expect(page.getByRole('button', { name: 'Record voice', exact: true })).toBeVisible();
    await expect(dock(page).getByRole('textbox', { name: 'Message Taalcut' })).toBeInViewport();
    await page.reload();
    await expect(page.locator('[data-slot=timeline-editor]')).toBeVisible();
    await expect(dock(page).getByRole('textbox', { name: 'Message Taalcut' })).toBeInViewport();
  });

  test('words on screen are chip-able, and removing the chip lets go of them', async ({ page }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    const words = page.getByRole('listbox', { name: 'Text on screen' }).getByRole('option');
    await words.nth(1).click();
    await expect(words.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tray(page)).toHaveCount(1);
    await expect(tray(page)).toHaveAttribute('data-kind', 'item');
    await expect(tray(page)).toContainText('Text');
    await tray(page)
      .getByRole('button', { name: /^Remove/ })
      .click();
    await expect(words.nth(1)).toHaveAttribute('aria-selected', 'false');
    await expect(tray(page)).toHaveCount(0);
  });

  test('“make this clip shorter”: one changes card; a row opens its clip; undo takes the turn back', async ({
    page,
  }) => {
    await preferences(page, { locale: 'en', theme: 'light' });
    const problems = await watchProblems(page);
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await clips(page).nth(2).click();
    await expect(tray(page)).toContainText('Clip 3');
    const before = await widthOf(page, 2);

    await ask(page, 'make this clip shorter');
    await expect(card(page)).toBeVisible();
    await expect.poll(() => widthOf(page, 2)).toBeLessThan(before - 4);
    expect(
      (await backend.dispatched(page)).filter((d) => d.name === 'timeline.trimClip').map((d) => d.source),
    ).toEqual(['agent']);
    const row = card(page).getByRole('button', { name: /^Clip 3: \d+(\.\d)?\s?s → \d+(\.\d)?\s?s/ });
    await expect(row).toBeVisible();
    // The message carried what was selected.
    await expect(dock(page).locator('article [data-slot=selection-chip][data-kind=clip]')).toContainText(
      'Clip 3',
    );

    // A row selects its clip again.
    await page.keyboard.press('Escape');
    await clips(page).nth(0).click();
    await row.click();
    await expect(clips(page).nth(2)).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: 'Undo AI changes', exact: true }).click();
    await expect.poll(() => widthOf(page, 2)).toBeGreaterThan(before - 2);
    await expect(card(page)).toContainText('Undone');
    await page
      .getByRole('group', { name: 'Edit', exact: true })
      .getByRole('button', { name: 'Redo', exact: true })
      .click();
    await expect.poll(() => widthOf(page, 2)).toBeLessThan(before - 4);
    await expect(card(page)).not.toContainText('Undone');
    // ⌘Z (focus outside the composer) takes the whole turn back too.
    await page.getByRole('group', { name: 'Video preview' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => widthOf(page, 2)).toBeGreaterThan(before - 2);
    expect(problems).toEqual([]);
  });

  for (const [theme, locale] of [
    ['light', 'en'],
    ['dark', 'en'],
    ['light', 'en-XA'],
  ] as const)
    test(`the dock, its chips and the changes card (${theme}, ${locale})`, async ({ page }, testInfo) => {
      await preferences(page, { locale, theme });
      const problems = await watchProblems(page);
      await open(page, EDITOR);
      await showDetailedTimeline(page);
      await clips(page).nth(2).click();
      await expect(tray(page)).toHaveCount(1);
      await ask(page, 'make this clip shorter');
      await expect(card(page)).toBeVisible();
      await expect(card(page).getByRole('button').first()).toBeVisible();
      // The composer shows the clip still selected.
      await expect(tray(page)).toHaveCount(1);
      await expect(dock(page).getByRole('textbox').last()).toBeVisible();
      await expectAccessible(page, testInfo, `edt1 docked chat ${theme} ${locale}`);
      // Everything in the dock fits it: the composer's row wraps rather than pushing Send out.
      expect(await clippedText(page, '[data-slot=editor-dock] *'), 'text that does not fit the dock').toEqual(
        [],
      );
      if (locale === 'en-XA') await expectPseudoClean(page, 'edt1 docked chat');
      await shot(page, `edt1-ctx-${locale === 'en' ? theme : 'pseudo'}`);
      expect(problems).toEqual([]);
    });
});
