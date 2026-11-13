// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EDT1-OPS: the editor's own edits. A selected clip's inspector sets its speed, the transition into the next clip,
// its own sound and its colour, each one command from the editor and one ⌘Z; S splits the clip at the playhead and
// ⌫ deletes the selected one, what follows closing up; the sound lane shows each clip's own sound (a press selects
// the clip) and the music, and the captions lane the captions. In light, dark and the pseudo-locale, with axe.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { PROJECT } from './routes.ts';
import { ARTIFACTS, fakeChat, open, preferences, watchProblems } from './support.ts';
import { expectPseudoClean } from './ui2b-support.ts';

const SCREENS = process.env.TAALCUT_OPS_SCREENS ?? new URL('screenshots/editor-ops/', ARTIFACTS).pathname;
const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };

// By its slot, not its name: the pseudo-locale renames the list.
const clips = (page: Page) => page.locator('[data-slot=video-track]').getByRole('option');
const controls = (page: Page) => page.locator('[data-slot=clip-edit-controls]');
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);
const undo = (page: Page) => page.keyboard.press('ControlOrMeta+z');

async function shoot(page: Page, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: `${SCREENS}/${name}.png` });
}

/** Moves the playhead to the middle of clip `n` by pressing the ruler above it. */
async function playheadInto(page: Page, n: number) {
  const clip = await clips(page).nth(n).boundingBox();
  const ruler = await page.locator('[data-slot=timeline-ruler]').boundingBox();
  if (!clip || !ruler) throw new Error('No clip or ruler on screen');
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

test.beforeEach(async ({ page }) => {
  await fakeChat(page, { speed: 0, latencyMs: 0 });
});

test.describe('the editor’s edits (EDT1-OPS)', () => {
  test('the inspector sets speed, the transition, the sound and the colour, each one ⌘Z', async ({
    page,
  }) => {
    const problems = await watchProblems(page);
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await clips(page).nth(0).click();
    await page.locator('[data-tool=more]').click();
    await expect(controls(page)).toBeVisible();

    await controls(page).locator('[data-slot=clip-speed]').selectOption('0.5');
    await expect.poll(() => ran(page, 'timeline.setSpeed')).toEqual(['ui']);
    await expect(controls(page).locator('[data-slot=clip-speed]')).toHaveValue('0.5');

    await controls(page).locator('[data-slot=clip-transition]').selectOption('dissolve');
    await expect.poll(() => ran(page, 'timeline.setTransition')).toEqual(['ui']);
    await expect(controls(page).locator('[data-slot=clip-transition]')).toHaveValue('dissolve');
    await expect(page.locator('[aria-label="Crossfade between clips 1 and 2"]')).toBeAttached();

    await page.locator('[data-tool=sound]').click();
    await controls(page).getByRole('switch', { name: 'Its own sound' }).click();
    await expect.poll(() => ran(page, 'audio.setVolume')).toEqual(['ui']);
    const volume = controls(page).getByRole('slider', { name: 'Volume' });
    await expect(volume).toBeEnabled();
    await volume.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => ran(page, 'audio.setVolume')).toEqual(['ui', 'ui']);

    await page.locator('[data-tool=more]').click();
    await controls(page).locator('[data-slot=clip-look]').selectOption('mono');
    await expect.poll(() => ran(page, 'timeline.setGrade')).toEqual(['ui']);
    await expect(controls(page).getByRole('button', { name: 'Back to the colour as shot' })).toBeVisible();
    await controls(page).scrollIntoViewIfNeeded();
    await shoot(page, 'inspector-light');

    // Back out of the fields, then ⌘Z takes the colour off, then the sound, the transition and the speed.
    await page.locator('[data-tool=more]').focus();
    await undo(page);
    await expect(controls(page).locator('[data-slot=clip-look]')).toHaveValue('none');
    for (let n = 0; n < 4; n++) await undo(page);
    await expect(controls(page).locator('[data-slot=clip-speed]')).toHaveValue('1');
    await expect(controls(page).locator('[data-slot=clip-transition]')).toHaveValue('cut');
    expect(problems).toEqual([]);
  });

  test('S splits the clip at the playhead; ⌫ deletes the selected clip and what follows closes up', async ({
    page,
  }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await expect(clips(page)).toHaveCount(12);
    await playheadInto(page, 2);
    await page.locator('[data-slot=timeline-bed]').focus();
    await page.keyboard.press('s');
    await expect(clips(page)).toHaveCount(13);
    expect(await ran(page, 'timeline.splitClip')).toEqual(['ui']);

    await clips(page).nth(4).click();
    await page.keyboard.press('Backspace');
    await expect(clips(page)).toHaveCount(12);
    expect(await ran(page, 'timeline.deleteClip')).toEqual(['ui']);
    await undo(page);
    await expect(clips(page)).toHaveCount(13);

    // The buttons do the same, and say their keys.
    await expect(page.locator('[data-slot=split]')).toHaveAttribute('aria-keyshortcuts', 's');
    await expect(page.locator('[data-slot=delete-clip]')).toHaveAttribute('aria-keyshortcuts', 'Backspace');
  });

  test('the sound lane shows each clip’s own sound and the music; a press selects the clip', async ({
    page,
  }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const lane = page.locator('[data-slot=sound-lane]');
    await expect(lane).toBeVisible();
    await expect(lane.locator('[data-slot=sound-clip]')).toHaveCount(await clips(page).count());
    await lane.locator('[data-slot=sound-clip]').nth(3).click();
    await expect(clips(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-slot=captions-lane] [data-slot=caption-cue]').first()).toBeVisible();
  });

  test('each lane is one tab stop: the arrow keys move along its items and Enter selects one', async ({
    page,
  }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    // EDT1 gate: a cue or a clip's sound is often narrower than a target can be (WCAG 2.5.8), so the lane is the
    // listbox you tab to, and the active item is its aria-activedescendant.
    const captions = page.locator('[data-slot=captions-lane] [role=listbox]');
    const cues = captions.locator('[data-slot=caption-cue]');
    await captions.focus();
    await page.keyboard.press('ArrowRight');
    await expect(captions).toHaveAttribute(
      'aria-activedescendant',
      (await cues.nth(1).getAttribute('id')) ?? '',
    );
    await page.keyboard.press('Enter');
    await expect(cues.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-slot=inspector] [data-slot=caption-controls]')).toBeVisible();
    await expect(page.locator('[data-slot=caption-words]')).toBeFocused();
    await page.locator('[data-tool=words]').click();

    const sound = page.locator('[data-slot=sound-lane] [role=listbox]');
    await sound.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(clips(page).nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-tool=sound]').click();
    await expect(controls(page).locator('[data-slot=clip-sound]')).toBeVisible();
  });

  test('a press on a caption selects it; the inspector fixes its words, one ⌘Z', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const cue = page.locator('[data-slot=captions-lane] [data-slot=caption-cue]').first();
    const was = (await cue.innerText()).trim();
    await cue.click();
    await expect(cue).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-tool=words]').click();
    const words = page.locator(
      '[data-slot=inspector] [data-slot=caption-controls] [data-slot=caption-words]',
    );
    await expect(words).toHaveValue(was);
    await words.fill('A made-up line');
    await words.press('Enter');
    await expect.poll(async () => ran(page, 'captions.editText')).toEqual(['ui']);
    await expect(cue).toContainText('A made-up line');
    await shoot(page, 'caption-inspector-light');
    // Enter left the field, so ⌘Z is the editor's.
    await undo(page);
    await expect(cue).toContainText(was);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`the controls and lanes pass axe in ${theme}`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, EDITOR);
      await page.locator('[data-slot=timeline-detail-toggle]').click();
      await clips(page).nth(1).click();
      await page.locator('[data-tool=more]').click();
      await expect(controls(page)).toBeVisible();
      await expectAccessible(page, testInfo, `editor ops (${theme})`);
      await shoot(page, `editor-${theme}`);
    });

  test('every word is in the pseudo-locale and fits', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await clips(page).nth(1).click();
    await page.locator('[data-tool=more]').click();
    await expect(controls(page)).toBeVisible();
    await expectPseudoClean(page, 'editor ops');
    await shoot(page, 'editor-pseudo');
  });
});
