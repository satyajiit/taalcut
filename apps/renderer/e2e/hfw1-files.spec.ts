// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// HFW1-UI: designing in the docked chat, and the files behind a design. On the fake's Golden hour market with
// `media: { arranged, designs }`: "a newspaper-style headline at 0:04" writes the design's files and proposes it at
// that time (the agent's two steps), and the chat shows its card with Use it, and the changes card; "make the chat
// bubbles look like the reel’s" gives each bubble the new version, one design row each with View files, which opens
// the dock's Files tab on that design. The Files tab is read only: the files by folder (one tab stop, arrows and
// Return), the chosen file's code, the checks it passed, and its versions, where Restore makes an older one current
// (one workspace.restore) and ⌘Z puts it back. Axe is clean in light, dark and the pseudo-locale. Made-up designs.
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

const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const panel = (page: Page) => page.locator('[data-slot=files-panel]');
const proposed = (page: Page) => page.locator('[data-slot=timeline-graphic][data-proposed]');
const changes = (page: Page) => dock(page).locator('[data-card-type=editChanges]');
const fileList = (page: Page) => panel(page).locator('[data-slot=design-file-list]');
const versions = (page: Page) => panel(page).locator('[data-slot=design-revisions]');
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
  await expect(page.locator('[data-slot=graphics-lane]')).toBeVisible();
}

async function ask(page: Page, text: string) {
  const box = dock(page).locator('[data-slot=composer]').getByRole('textbox').last();
  await box.fill(text);
  await box.press('Enter');
}

async function openFiles(page: Page) {
  await openEditorTask(page, 'files');
  await expect(panel(page)).toBeVisible();
}

async function shot(page: Page, name: string) {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: `${SCREENS}/${name}.png` });
}

async function accessible(page: Page, testInfo: TestInfo, label: string) {
  await expectAccessible(
    page,
    testInfo,
    label,
    axeFor(page).include('[data-slot=files-panel]').include('[data-slot=editor-dock]'),
  );
}

test.describe('designing in the docked chat (HFW1-UI)', () => {
  test('“a newspaper-style headline at 0:04”: its card with Use it, the changes card, one ⌘Z', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await openEditor(page);
    await ask(page, 'a newspaper-style headline at 0:04');
    const card = dock(page).getByRole('article', { name: 'Motion graphic: Newspaper headline' });
    await expect(card).toBeVisible();
    await expect(changes(page)).toBeVisible();
    await expect(proposed(page)).toHaveCount(2);
    expect(await ran(page, 'workspace.writeFiles')).toEqual(['agent']);
    expect(await ran(page, 'graphics.placeComposition')).toEqual(['agent']);
    await expect(card.getByText(/^Plays from 0?0:04 to /)).toBeAttached();
    await shot(page, 'chat-design-proposal-light');
    await accessible(page, testInfo, 'docked chat, designed graphic, light');

    await card.getByRole('button', { name: 'Use it' }).click();
    await expect(proposed(page)).toHaveCount(1);
    expect(await ran(page, 'graphics.useProposal')).toEqual(['ui']);
    expect(problems).toEqual([]);
  });

  test('“make the chat bubbles look like the reel’s”: a design row each; View files opens their files', async ({
    page,
  }) => {
    await openEditor(page);
    await ask(page, 'make the chat bubbles look like the reel’s');
    await expect(changes(page)).toBeVisible();
    await expect(changes(page).getByText('new design v1 → v2')).toHaveCount(2);
    expect(await ran(page, 'graphics.setComposition')).toEqual(['agent']);
    await expect(page.locator('[data-slot=graphics-lane]')).toContainText('Chat bubble');

    await changes(page)
      .getByRole('button', { name: /^View files: Chat bubble/ })
      .first()
      .click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Chat bubble' })).toBeVisible();
    await expect(panel(page).getByText(/^Design v2 · /)).toBeVisible();
  });
});

test.describe('the files viewer (HFW1-UI)', () => {
  test('the files by folder, their code, the checks; from the keyboard, one tab stop', async ({ page }) => {
    await openEditor(page);
    await openFiles(page);
    await expect(panel(page).getByRole('heading', { name: 'Chat bubble' })).toBeVisible();
    const code = panel(page).locator('[data-slot=design-code-text]');
    await expect(code).toHaveAccessibleName(/^The code of index\.html, read only/);
    await expect(code).toContainText('data-composition-id="chat-bubble"');
    await expect(panel(page).locator('[data-slot=design-checks]')).toContainText(/passed every check/);

    // One tab stop for the files: arrows move, Return opens.
    await fileList(page).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(code).not.toHaveAccessibleName(/index\.html/);
    await page.keyboard.press('Tab');
    await expect(fileList(page)).not.toBeFocused();
    await expect(fileList(page).getByRole('option').first()).not.toBeFocused();

    // Another design on the video.
    await panel(page).getByLabel('Design').selectOption({ label: 'Price tag · v1' });
    await expect(panel(page).getByRole('heading', { name: 'Price tag' })).toBeVisible();
  });

  test('Restore makes an older version current, and ⌘Z puts it back', async ({ page }) => {
    const problems = await watchProblems(page);
    await openEditor(page);
    await openFiles(page);
    const now = (n: number) => versions(page).locator(`[data-revision="${n}"]`);
    await expect(now(2)).toContainText('Now');
    await versions(page).focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { name: 'The files at version 1' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Restore version 1' }).click();
    await expect(panel(page).getByRole('status')).toContainText('Version 1 is the current one again.');
    expect(await ran(page, 'workspace.restore')).toEqual(['ui']);
    await expect(now(1)).toContainText('Now');

    await page.getByRole('group', { name: 'Video preview' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(now(2)).toContainText('Now');
    await expect(now(1)).not.toContainText('Now');
    expect(problems).toEqual([]);
  });

  for (const [theme, locale] of [
    ['light', 'en'],
    ['dark', 'en'],
    ['light', 'en-XA'],
  ] as const)
    test(`axe is clean on the Files tab (${theme}, ${locale})`, async ({ page }, testInfo) => {
      await openEditor(page, theme, locale);
      await openEditorTask(page, 'files');
      await expect(panel(page).locator('[data-slot=design-code-text]')).toBeVisible();
      await expect(versions(page)).toBeVisible();
      await accessible(page, testInfo, `files viewer ${theme} ${locale}`);
      await shot(page, `files-viewer-${locale === 'en' ? theme : 'pseudo'}`);
      if (locale === 'en-XA') {
        const text = await userFacingText(page, '[data-slot=files-panel]');
        expect(englishShowing(text, englishPhrases()), 'English source strings').toEqual([]);
        expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
      }
    });
});
