// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// HFW1-UI: the editor's designed graphics on the fake's Golden hour market with `media: { arranged, designs }`: two
// chat bubbles (one design, used) and a price tag the chat proposed. The lane shows each by its design's name and
// words, with no kind; selecting the proposal shows its name and when it plays, with Use it (⌘Z makes it a proposal
// again); its words and colours save through graphics.edit; there is no Where on screen or Size for a designed
// graphic: Change the look… and Move or resize on screen… put it in the docked chat as a chip. From the keyboard the
// lane is one tab stop and ⌥→ moves a graphic by a beat. Axe is clean in light and dark, and in the pseudo-locale
// nothing is English. Made-up designs only. Screens go to TAALCUT_HFW1_SCREENS (the lane's folder) or the artifacts.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { axeFor, expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { openEditorTask, showDetailedTimeline } from './editor-navigation';
import { PROJECT } from './routes.ts';
import { ARTIFACTS, FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
const SCREENS = process.env.TAALCUT_HFW1_SCREENS ?? new URL('screenshots/hfw1-ui/', ARTIFACTS).pathname;

const lane = (page: Page) => page.locator('[data-slot=graphics-lane]');
const graphics = (page: Page) => lane(page).locator('[data-slot=timeline-graphic]');
const proposed = (page: Page) => page.locator('[data-slot=timeline-graphic][data-proposed]');
const inspector = (page: Page) => page.locator('[data-slot=inspector]');
const variables = (page: Page) => inspector(page).locator('[data-slot=design-variables]');
const chips = (page: Page) =>
  page.locator('[data-slot=editor-dock] [data-slot=composer] [data-slot=selection-chip]');
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((entry) => entry.name === name).map((entry) => entry.source);

async function openEditor(page: Page, theme: 'light' | 'dark' = 'light', locale: 'en' | 'en-XA' = 'en') {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({
      onboarding: 'done',
      speed: 0,
      latencyMs: 0,
      media: { arranged: true, designs: true },
    }),
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

test.describe('the editor’s designed graphics (HFW1-UI)', () => {
  test('double click opens the graphic’s words beside the preview and keeps the timeline available', async ({
    page,
  }) => {
    await openEditor(page);
    await graphics(page).first().dblclick();
    const words = variables(page).getByLabel('Message');
    await expect(words).toBeFocused();
    await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
    await words.fill('Meet me at the market');
    await words.press('Enter');
    await expect.poll(() => ran(page, 'graphics.edit')).toEqual(['ui']);
    await expect(graphics(page).first()).toContainText('Meet me at the market');
    await graphics(page).first().dblclick();
    await expect(words).toBeFocused();
    expect(
      await words.evaluate((field: HTMLInputElement) => field.selectionEnd! - field.selectionStart!),
    ).toBe('Meet me at the market'.length);
    for (const [width, height] of [
      [1440, 900],
      [960, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(words).toBeVisible();
      await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
      await shot(page, `editor-direct-words-${width}`);
    }
  });

  test('direct graphic editing fits the dark pseudo-locale at wide and compact window sizes', async ({
    page,
  }) => {
    await openEditor(page, 'dark', 'en-XA');
    await graphics(page).first().dblclick();
    await expect(variables(page).getByLabel('Message')).toBeFocused();
    for (const [width, height] of [
      [1440, 900],
      [960, 600],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect(variables(page).getByLabel('Message')).toBeVisible();
      await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
      await shot(page, `editor-direct-words-dark-pseudo-${width}`);
    }
  });

  test('double click and Enter open a caption for editing without a chat turn', async ({ page }) => {
    await openEditor(page);
    const cue = page.locator('[data-slot=caption-cue]').first();
    await cue.dblclick();
    const words = page.locator('[data-slot=caption-words]');
    await expect(words).toBeFocused();
    await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
    await page.locator('[data-slot=captions-lane] [role=listbox]').focus();
    await page.keyboard.press('Enter');
    await expect(words).toBeFocused();
  });

  test('selecting a graphic clears scene bulk actions', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const scenes = page.locator('[data-slot=scene-strip]');
    await scenes.getByRole('button').first().click();
    await scenes
      .getByRole('button')
      .nth(2)
      .click({ modifiers: ['Shift'] });
    await expect(page.getByRole('button', { name: 'Adjust selected (3)' })).toBeVisible();
    await showDetailedTimeline(page);
    await graphics(page).first().click();
    await expect(page.getByRole('button', { name: /Adjust selected/ })).toHaveCount(0);
  });

  test('the detail toggle exits a task and reveals the timeline in one press', async ({ page }) => {
    await openEditor(page);
    await openEditorTask(page, 'comments');
    await expect(page.getByRole('region', { name: 'Comments', exact: true })).toBeVisible();
    const toggle = page.locator('[data-slot=timeline-detail-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Comments', exact: true })).toHaveCount(0);
  });

  test('the lane names each by its design; Use it puts the proposal in the video and ⌘Z undoes it', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await openEditor(page);
    await expect(graphics(page)).toHaveCount(3);
    await expect(graphics(page).first()).toContainText('Chat bubble');
    await expect(graphics(page).first()).toContainText('Are you at the market?');
    await expect(graphics(page).first()).toHaveAccessibleName(/Chat bubble.*from 0?0:01 to 0?0:03/);
    await expect(proposed(page)).toHaveCount(1);
    await expect(proposed(page)).toContainText('Price tag');

    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).getByRole('heading', { name: 'Price tag' })).toBeVisible();
    await expect(inspector(page).getByText('Designed graphic · v1')).toBeVisible();
    const row = inspector(page).locator('[data-slot=design-proposal]');
    await expect(
      row.getByText('Proposed: it plays in the viewer and isn’t in your video yet.'),
    ).toBeVisible();
    await expect(row.getByText(/^Plays from 0?0:06 to 0?0:08/)).toBeAttached();
    // Nothing of the kit's: no reason line, no Where on screen, no Size.
    await expect(inspector(page).getByText(/Taalcut’s own design/)).toHaveCount(0);
    await expect(inspector(page).getByRole('button', { name: 'Smaller' })).toHaveCount(0);
    await expect(inspector(page).getByText('Where on screen')).toHaveCount(0);
    await shot(page, 'editor-design-proposed-light');
    await accessible(page, testInfo, 'designed graphic, proposed, light');

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

  test('its words and colours save through graphics.edit, each one change', async ({ page }) => {
    await openEditor(page);
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(variables(page)).toBeVisible();
    const price = variables(page).getByLabel('Price');
    await expect(price).toHaveValue('₹120 a dozen');
    await price.fill('₹99 a dozen');
    await price.press('Enter');
    await expect.poll(() => ran(page, 'graphics.edit')).toEqual(['ui']);
    await expect(price).toHaveValue('₹99 a dozen');

    await showDetailedTimeline(page);
    await graphics(page).nth(1).dblclick();
    await expect(inspector(page).getByRole('heading', { name: 'Chat bubble' })).toBeVisible();
    await variables(page).getByRole('radio', { name: 'Left' }).click();
    await expect.poll(() => ran(page, 'graphics.edit')).toEqual(['ui', 'ui']);
    await variables(page).getByRole('switch').click();
    await expect.poll(() => ran(page, 'graphics.edit')).toEqual(['ui', 'ui', 'ui']);
  });

  test('Change the look… and Move or resize on screen… put the graphic in the docked chat', async ({
    page,
  }) => {
    await openEditor(page);
    await showDetailedTimeline(page);
    await graphics(page).first().dblclick();
    await inspector(page).getByRole('button', { name: 'Change the look…' }).click();
    await expect(chips(page)).toHaveCount(1);
    const box = page.locator('[data-slot=editor-dock] [data-slot=composer]').getByRole('textbox').last();
    await expect(box).toHaveValue(/^Change the look of this graphic: /);
    await showDetailedTimeline(page);
    await graphics(page).first().dblclick();
    await inspector(page).getByRole('button', { name: 'Move or resize on screen…' }).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(box).toHaveValue(/^Move or resize this graphic on screen: /);
  });

  test('from the keyboard: one tab stop, arrows move between graphics, ⌥→ moves one by a beat', async ({
    page,
  }) => {
    await openEditor(page);
    await graphics(page).first().click();
    await page.keyboard.press('ArrowRight');
    await expect(graphics(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    const before = (await graphics(page).nth(1).boundingBox())!.x;
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(async () => (await graphics(page).nth(1).boundingBox())!.x).toBeGreaterThan(before);
    expect(await ran(page, 'graphics.edit')).toEqual(['ui']);
    // The lower controls retime it too.
    await page.locator('[data-tool=more]').click();
    await inspector(page).getByRole('button', { name: 'A beat earlier' }).click();
    await expect.poll(() => ran(page, 'graphics.edit')).toEqual(['ui', 'ui']);
  });

  test('/dev/kit shows the designed cards with their own names, and no kind', async ({ page }) => {
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: FAKE_OPTIONS_KEY,
      value: JSON.stringify({ onboarding: 'done', media: { arranged: true, designs: true } }),
    });
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, { name: 'dev-kit', path: '/dev/kit' });
    const tag = page.locator('figure[data-fixture="motionGraphic · designed price tag, proposed"]');
    await tag.scrollIntoViewIfNeeded();
    await expect(tag.getByRole('article', { name: 'Motion graphic: Price tag' })).toBeVisible();
    await expect(tag.getByRole('button', { name: 'Use it' })).toBeVisible();
    const bubble = page.locator('figure[data-fixture="motionGraphic · designed chat bubble"]');
    await expect(bubble.getByRole('button', { name: 'Edit in video' })).toBeVisible();
    await expect(bubble.locator('[data-slot=design-variables]')).toHaveCount(0);
    await expect(bubble.getByText(/Taalcut’s own design/)).toHaveCount(0);
    await bubble.getByRole('button', { name: 'Edit in video' }).click();
    await expect(page).toHaveURL(/\/projects\/.+\/timeline/);
    await expect(variables(page).getByLabel('Message')).toBeFocused();
  });

  test('dark: axe is clean on the lane, the proposal and its words and colours', async ({
    page,
  }, testInfo) => {
    await openEditor(page, 'dark');
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(variables(page)).toBeVisible();
    await shot(page, 'editor-design-proposed-dark');
    await accessible(page, testInfo, 'designed graphic, proposed, dark');
  });

  test('in the pseudo-locale the lane and the inspector are translated', async ({ page }, testInfo) => {
    await openEditor(page, 'light', 'en-XA');
    await proposed(page).click();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).locator('[data-slot=design-proposal]')).toBeVisible();
    await shot(page, 'editor-design-proposed-pseudo');
    await accessible(page, testInfo, 'designed graphic, proposed, pseudo');
    const phrases = englishPhrases();
    for (const within of ['[data-slot=graphics-lane]', '[data-slot=graphic-inspector]']) {
      const text = await userFacingText(page, within);
      expect(englishShowing(text, phrases), `${within}: English source strings`).toEqual([]);
      expect(untranslated(text), `${within}: strings that skipped the catalogue`).toEqual([]);
    }
  });
});
