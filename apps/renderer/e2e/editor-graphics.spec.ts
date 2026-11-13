// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EDT1-GFX: the editor's graphics lane and inspector on the fake's Golden hour market with its graphics arranged
// (`media: { arranged: true }`), each drawn with a design: the lane shows each motion graphic at its time, the chat's
// founder card ("add a lower third with my name") marked Proposed; selecting it opens its inspector with Use it, which
// makes it part of the video (⌘Z makes it a proposal again); a drag moves a graphic and an edge trims it, each one
// graphics.edit. Axe is clean in dark, and in the pseudo-locale nothing is English. A designed graphic's words and
// colours, Change the look… and Move or resize on screen…, and axe in light are hfw1-designs.spec.ts's. Screens go to
// TAALCUT_GFX_SCREENS (the lane's folder) or the artifacts.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { axeFor, expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { showDetailedTimeline } from './editor-navigation';
import { PROJECT } from './routes.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
const SCREENS = process.env.TAALCUT_GFX_SCREENS ?? new URL('screenshots/gfx/', ARTIFACTS).pathname;

const lane = (page: Page) => page.locator('[data-slot=graphics-lane]');
const graphics = (page: Page) => lane(page).locator('[data-slot=timeline-graphic]');
const proposed = (page: Page) => page.locator('[data-slot=timeline-graphic][data-proposed]');
const inspector = (page: Page) => page.locator('[data-slot=inspector]');
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((entry) => entry.name === name).map((entry) => entry.source);

async function openEditor(page: Page, theme: 'light' | 'dark' = 'light', locale: 'en' | 'en-XA' = 'en') {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ onboarding: 'done', media: { arranged: true } }),
  });
  await preferences(page, { theme, locale });
  await open(page, EDITOR);
  await showDetailedTimeline(page);
  await expect(lane(page)).toBeVisible();
}

async function shot(page: Page, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: `${SCREENS}/${name}.png` });
}

async function accessible(page: Page, testInfo: TestInfo, label: string) {
  await expectAccessible(page, testInfo, label, axeFor(page).include('[data-slot=inspector]'));
}

test.describe('the editor’s graphics (EDT1-GFX)', () => {
  test('the lane marks the chat’s proposal; Use it puts it in the video and ⌘Z undoes it', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await openEditor(page);
    await expect(graphics(page)).toHaveCount(3);
    await expect(proposed(page)).toHaveCount(1);
    await expect(proposed(page)).toContainText('Founder card');
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).getByRole('heading', { name: 'Founder card' })).toBeVisible();
    const row = inspector(page).locator('[data-slot=design-proposal]');
    await expect(
      row.getByText('Proposed: it plays in the viewer and isn’t in your video yet.'),
    ).toBeVisible();
    await shot(page, 'editor-proposed-light');

    await row.getByRole('button', { name: 'Use it' }).click();
    await expect(proposed(page)).toHaveCount(0);
    expect(await ran(page, 'graphics.useProposal')).toEqual(['ui']);
    await expect(inspector(page).locator('[data-slot=design-proposal]')).toHaveCount(0);
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+z');
      await expect(proposed(page)).toHaveCount(1, { timeout: 500 });
    }).toPass();
    expect(problems).toEqual([]);
  });

  test('a drag moves a graphic and an edge trims it: one graphics.edit each', async ({ page }) => {
    await openEditor(page);
    const first = graphics(page).first();
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.x).toBeGreaterThan(box.x + 30);
    expect(await ran(page, 'graphics.edit')).toEqual(['ui']);

    const moved = (await first.boundingBox())!;
    await page.mouse.move(moved.x + moved.width - 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + moved.width + 40, moved.y + moved.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(moved.width + 20);
    expect(await ran(page, 'graphics.edit')).toEqual(['ui', 'ui']);
  });

  test('both trim handles appear on hover; the start edge extends and a cancelled drag is discarded', async ({
    page,
  }) => {
    await openEditor(page);
    const first = graphics(page).first();
    await first.hover();
    const start = first.locator('[data-trim-edge=start]');
    const end = first.locator('[data-trim-edge=end]');
    await expect(start).toHaveCSS('opacity', '1');
    await expect(end).toHaveCSS('opacity', '1');
    await expect(start).toHaveCSS('cursor', 'ew-resize');
    await shot(page, 'editor-trim-handles-light');
    const before = (await first.boundingBox())!;
    const edge = (await end.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + 40, edge.y + edge.height / 2, { steps: 4 });
    await first.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.width).toBeCloseTo(before.width, 0);
    expect(await ran(page, 'graphics.edit')).toEqual([]);

    // First move it away from time zero, then pull its start back to lengthen it.
    await first.focus();
    await page.keyboard.press('Alt+ArrowRight');
    const moved = (await first.boundingBox())!;
    const left = (await start.boundingBox())!;
    await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
    await page.mouse.down();
    await page.mouse.move(left.x - 30, left.y + left.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(moved.width);
    expect(await ran(page, 'graphics.edit')).toEqual(['ui', 'ui']);
  });

  test('dragging the playhead outside a zoomed timeline keeps it inside the visible viewport', async ({
    page,
  }) => {
    await openEditor(page);
    const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
    await zoom.click();
    await zoom.click();
    const scroller = page.locator('[data-slot=timeline-bed] [data-scroll-x]');
    const viewport = (await scroller.boundingBox())!;
    const handle = page.locator('[data-slot=playhead-handle]');
    const knob = (await handle.boundingBox())!;
    await page.mouse.move(Math.max(viewport.x + 2, knob.x + knob.width / 2), knob.y + knob.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width + 120, knob.y + knob.height / 2, { steps: 8 });
    await expect
      .poll(async () => {
        const at = (await handle.boundingBox())!;
        return at.x + at.width;
      })
      .toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    await page.mouse.move(viewport.x - 80, knob.y + knob.height / 2, { steps: 8 });
    await expect.poll(async () => (await handle.boundingBox())!.x).toBeGreaterThanOrEqual(viewport.x - 1);
    await page.mouse.up();
  });

  test('from the keyboard: arrows move between graphics, ⌥→ moves one by a beat', async ({ page }) => {
    await openEditor(page);
    await graphics(page).first().click();
    await page.keyboard.press('ArrowRight');
    await expect(graphics(page).nth(1)).toBeFocused();
    await expect(graphics(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    const before = (await graphics(page).nth(1).boundingBox())!.x;
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(async () => (await graphics(page).nth(1).boundingBox())!.x).toBeGreaterThan(before);
    expect(await ran(page, 'graphics.edit')).toEqual(['ui']);
  });

  test('dark: axe is clean on the lane and the proposal', async ({ page }, testInfo) => {
    await openEditor(page, 'dark');
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).locator('[data-slot=design-proposal]')).toBeVisible();
    await shot(page, 'editor-proposed-dark');
    await accessible(page, testInfo, 'graphics inspector, proposed, dark');
  });

  test('in the pseudo-locale the lane and the inspector are translated', async ({ page }) => {
    await openEditor(page, 'light', 'en-XA');
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).locator('[data-slot=design-proposal]')).toBeVisible();
    await shot(page, 'editor-proposed-pseudo');
    const phrases = englishPhrases();
    for (const within of ['[data-slot=graphics-lane]', '[data-slot=graphic-inspector]']) {
      const text = await userFacingText(page, within);
      expect(englishShowing(text, phrases), `${within}: English source strings`).toEqual([]);
      expect(untranslated(text), `${within}: strings that skipped the catalogue`).toEqual([]);
    }
  });
});
