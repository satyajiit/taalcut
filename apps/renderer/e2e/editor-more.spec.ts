// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// MORE1: the editor's More tab as a gallery of tiles. Two groups, "This scene" and "This video"; a tile says its
// value in words and opens the surface that suits it: a sheet in the tiles' place for what is judged by eye (the
// viewer stays on screen), a dialog for what ends in a result. It fits the lower panel at 1280 × 800 without
// scrolling, gives focus back to its tile, says why a tile waits, and says a refusal beside the control. In light
// and dark, with axe on the gallery and on every surface.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { PROJECT } from './routes.ts';
import { ARTIFACTS, fakeChat, open, preferences, watchProblems } from './support.ts';

const SCREENS = process.env.TAALCUT_MORE_SCREENS ?? new URL('screenshots/editor-more/', ARTIFACTS).pathname;
const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };

const scenes = (page: Page) => page.locator('[data-scene-clip] button');
const panel = (page: Page) => page.locator('[data-slot=editor-inspector-panel]');
const tile = (page: Page, name: string) => page.locator(`[data-slot=more-tile][data-tile=${name}]`);
const sheet = (page: Page, name: string) => page.locator(`[data-slot=more-sheet][data-sheet=${name}]`);
const card = (page: Page, slot: string, value: string) =>
  page.locator(`[data-slot=${slot}] [role=radio][data-value="${value}"]`);
const line = (page: Page) => page.locator('[data-slot=more-scene-line]');
/** A sheet fades in: its colours are its own only once it has arrived. */
const arrived = (page: Page, name: string) =>
  expect(sheet(page, name).locator('> div').first()).toHaveCSS('opacity', '1');
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);

async function shoot(page: Page, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: `${SCREENS}/${name}.png` });
}

/** The simple view with scene `n` (from 1) selected and More open. */
async function openMore(page: Page, n: number | null = 3) {
  await open(page, EDITOR);
  if (n !== null)
    await scenes(page)
      .nth(n - 1)
      .click();
  await page.locator('[data-tool=more]').click();
  await expect(tile(page, 'cover')).toBeVisible();
}

/** The panel shows everything it holds: nothing to scroll. */
async function expectFits(page: Page) {
  const box = await panel(page).evaluate((node) => ({
    scroll: node.scrollHeight,
    client: node.clientHeight,
  }));
  expect(box.scroll, 'the More panel scrolls').toBeLessThanOrEqual(box.client);
}

test.beforeEach(async ({ page }) => {
  await fakeChat(page, { speed: 0, latencyMs: 0 });
});

test.describe('the More gallery (MORE1)', () => {
  test('a scene’s tiles and the video’s, each with its value, fit the lower panel without scrolling', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await preferences(page, { theme: 'light', locale: 'en' });
    await openMore(page);
    await expect(page.getByRole('region', { name: /^Scene 3/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'This video' })).toBeVisible();
    await expect(tile(page, 'speed')).toContainText('Normal speed');
    await expect(tile(page, 'transition')).toContainText('A plain cut');
    await expect(tile(page, 'colour')).toContainText('As shot');
    await expect(tile(page, 'why')).toContainText('Taalcut picked this');
    await expect(tile(page, 'size')).toContainText('This video is 9:16');
    // The scene's own actions stay beside its title.
    const scene = page.locator('[data-slot=more-scene]');
    await expect(scene.getByRole('button', { name: 'Lock' })).toBeVisible();
    await expect(scene.getByRole('button', { name: 'Add to chat' })).toBeVisible();
    await expectFits(page);
    await shoot(page, 'gallery-light');
    expect(problems).toEqual([]);
  });

  test('a sheet takes the tiles’ place and leaves the viewer on screen; Escape gives focus back and keeps the scene', async ({
    page,
  }) => {
    await openMore(page);
    const stage = page.locator('[data-slot=editor-stage]');
    const before = await stage.boundingBox();
    await tile(page, 'speed').click();
    await expect(sheet(page, 'speed')).toBeVisible();
    await expect(tile(page, 'speed')).toBeHidden();
    // Nothing covers the picture: no dialog, and the stage is where it was.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await stage.boundingBox()).toEqual(before);
    // Focus starts on the speed in use; the arrows walk the cards without sending.
    await expect(card(page, 'clip-speed', '1')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'clip-speed', '1.5')).toBeFocused();
    expect(await ran(page, 'timeline.setSpeed')).toEqual([]);
    await expectFits(page);
    await page.keyboard.press('Escape');
    await expect(sheet(page, 'speed')).toHaveCount(0);
    await expect(tile(page, 'speed')).toBeFocused();
    // The editor's own Escape (which lets go of the scene) did not see that one.
    await expect(page.getByRole('region', { name: /^Scene 3/ })).toBeVisible();
  });

  test('the colour sheet shows each look on the scene’s frame, and an adjustment is one edit said in words', async ({
    page,
  }) => {
    await openMore(page);
    await tile(page, 'colour').click();
    await expect(card(page, 'clip-look', 'none')).toHaveAttribute('aria-checked', 'true');
    await expect(sheet(page, 'colour').locator('[data-slot=grade-picture]')).toHaveCount(10);
    await card(page, 'clip-look', 'warm').click();
    await expect.poll(() => ran(page, 'timeline.setGrade')).toEqual(['ui']);
    const brightness = page.getByRole('slider', { name: 'Brightness' });
    await brightness.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => ran(page, 'timeline.setGrade')).toEqual(['ui', 'ui', 'ui']);
    await expect(page.locator('[data-slot=more-sheet-value]')).toHaveText('Warm · A little brighter');
    await expectFits(page);
    await shoot(page, 'colour-light');
    await page.getByRole('button', { name: 'Back to the colour as shot' }).click();
    await expect(page.locator('[data-slot=more-sheet-value]')).toHaveText('As shot');
    await page.locator('[data-slot=more-sheet-back]').click();
    await expect(tile(page, 'colour')).toBeFocused();
    await expect(tile(page, 'colour')).toContainText('As shot');
  });

  test('with no scene the scene group explains itself and the video group works', async ({ page }) => {
    await openMore(page, null);
    await expect(page.getByRole('heading', { name: 'This scene' })).toBeVisible();
    await expect(line(page)).toHaveText('Pick a scene to change its speed, transition and colour.');
    for (const name of ['speed', 'transition', 'freeze', 'colour', 'why'])
      await expect(tile(page, name)).toHaveAttribute('aria-disabled', 'true');
    await expect(tile(page, 'size')).not.toHaveAttribute('aria-disabled', 'true');
    await expectFits(page);
    await shoot(page, 'no-scene-light');
    // The way back to the scenes is right there.
    await page.locator('[data-slot=more-pick-scene]').click();
    await expect(page.locator('[data-slot=scene-strip]')).toBeVisible();
  });

  test('a locked scene says so, keeps its values, and still answers Why this shot', async ({ page }) => {
    await openMore(page);
    await page.locator('[data-slot=more-scene]').getByRole('button', { name: 'Lock' }).click();
    await expect(line(page)).toHaveText('Locked. Unlock it to change it.');
    await expect(tile(page, 'speed')).toHaveAttribute('aria-disabled', 'true');
    await expect(tile(page, 'speed')).toContainText('Normal speed');
    // Locking moved nothing: the panel still fits.
    await expectFits(page);
    await tile(page, 'speed').click({ force: true });
    await expect(sheet(page, 'speed')).toHaveCount(0);
    await tile(page, 'why').click();
    await expect(page.getByRole('dialog', { name: 'Why this shot' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tile(page, 'why')).toBeFocused();
  });

  test('the last scene says it has no next one, and a refusal is said beside the control', async ({
    page,
  }) => {
    await openMore(page, 12);
    await expect(tile(page, 'transition')).toContainText('No next scene');
    await expect(tile(page, 'transition')).toHaveAttribute('aria-disabled', 'true');
    // The fake refuses a size copy unless asked to run it: the dialog says why and stays open.
    await tile(page, 'size').click();
    const dialog = page.getByRole('dialog', { name: 'Make another size' });
    await expect(dialog.getByRole('radio')).toHaveCount(4);
    await dialog.locator('[data-slot=size-make]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
    // Not said a second time under the transport.
    await expect(page.locator('[data-slot=timeline-editor] [data-slot=error-line]')).toHaveCount(0);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the gallery and every surface pass axe in ${theme}`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await openMore(page);
      await expectAccessible(page, testInfo, `more gallery (${theme})`);
      for (const name of ['speed', 'transition', 'colour'] as const) {
        await tile(page, name).click();
        await expect(sheet(page, name)).toBeVisible();
        await arrived(page, name);
        await expectAccessible(page, testInfo, `more ${name} sheet (${theme})`);
        await shoot(page, `${name}-${theme}`);
        await page.locator('[data-slot=more-sheet-back]').click();
      }
      // The colour sheet again with something to undo: both ways back are on screen.
      await tile(page, 'colour').click();
      await card(page, 'clip-look', 'vintage').click();
      await page.getByRole('slider', { name: 'Warmth' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('button', { name: 'Reset adjustments' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to the colour as shot' })).toBeVisible();
      await arrived(page, 'colour');
      await expectAccessible(page, testInfo, `more colour sheet, graded (${theme})`);
      await shoot(page, `colour-graded-${theme}`);
      await page.locator('[data-slot=more-sheet-back]').click();
      for (const [name, title] of [
        ['size', 'Make another size'],
        ['freeze', 'Freeze this moment'],
        ['why', 'Why this shot'],
      ] as const) {
        await tile(page, name).click();
        await expect(page.getByRole('dialog', { name: title })).toBeVisible();
        await expectAccessible(page, testInfo, `more ${name} dialog (${theme})`);
        await shoot(page, `${name}-${theme}`);
        await page.keyboard.press('Escape');
        await expect(tile(page, name)).toBeFocused();
      }
    });
});

test.describe('the More edits that end in a result (MORE1, the fake running them)', () => {
  test.beforeEach(async ({ page }) => {
    await fakeChat(page, { speed: 0, latencyMs: 0, more: 'commands' });
  });

  test('a frozen moment becomes the selected scene, and its tile then changes the hold’s length', async ({
    page,
  }) => {
    await openMore(page);
    await tile(page, 'freeze').click();
    const dialog = page.getByRole('dialog', { name: 'Freeze this moment' });
    await expect(dialog.getByRole('spinbutton', { name: 'Hold length (seconds)' })).toHaveValue('2');
    await dialog.locator('[data-slot=freeze-confirm]').click();
    await expect.poll(() => ran(page, 'timeline.freezeFrame')).toEqual(['ui']);
    await expect(dialog).toHaveCount(0);
    // The held moment is selected: its tile names it and its length, and it has no speed.
    await expect(tile(page, 'freeze')).toContainText('Held moment');
    await expect(tile(page, 'freeze')).toContainText('For 2 seconds');
    await expect(tile(page, 'speed')).toContainText('A hold has none');
    await tile(page, 'freeze').click();
    const change = page.getByRole('dialog', { name: 'Change hold length' });
    await change.getByRole('button', { name: 'Half a second longer' }).click();
    await change.locator('[data-slot=freeze-confirm]').click();
    await expect.poll(() => ran(page, 'timeline.setHoldDuration')).toEqual(['ui']);
    await expect(tile(page, 'freeze')).toContainText('For 2.5 seconds');
  });

  test('a size copy is made in the dialog, which then opens the new video', async ({ page }) => {
    await openMore(page);
    await tile(page, 'size').click();
    const dialog = page.getByRole('dialog');
    await card(page, 'size-choices', '1:1').click();
    await dialog.getByRole('button', { name: 'Make the 1:1 copy' }).click();
    await expect.poll(() => ran(page, 'timeline.makeSize')).toEqual(['ui']);
    await expect(page.getByRole('dialog', { name: 'The 1:1 copy is ready' })).toBeVisible();
    await shoot(page, 'size-made-light');
    const before = page.url();
    await page.getByRole('button', { name: 'Open the new video' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.url()).not.toBe(before);
    await expect(page).toHaveURL(/timeline=/);
  });
});
