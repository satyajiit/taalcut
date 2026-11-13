// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// EDT1-CMT: comments on the edit. A comment from C on the selected clip, from a clip's right-click menu, from the
// inspector on the whole video and from the viewer at the playhead; each waits as a pin on the bed and in
// Comments, where it is edited and removed; "Send N comments to Taalcut" sends them in one message, each goes to With
// Taalcut and then to Done with its answer. Against the Make fakes' Golden hour market (12 clips) and the fake chat's
// comment script (src/chat/fake-comment-script.ts). Screenshots go to TAALCUT_CMT_SCREENS.
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { axeFor } from './axe.ts';
import { backend } from './backend-driver.ts';
import { openEditorTask, showDetailedTimeline } from './editor-navigation';
import { PROJECT } from './routes.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';
import { expectAccessible, expectPseudoClean } from './ui2b-support.ts';

const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
const SHOTS =
  process.env.TAALCUT_CMT_SCREENS ?? new URL('../e2e-artifacts/screenshots/cmt/', import.meta.url).pathname;

const clips = (page: Page) => page.locator('[data-slot=timeline-clip]');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const panel = (page: Page) => page.locator('[data-slot=comments-panel]');
const composer = (page: Page) => page.locator('[data-slot=comment-composer]');
const pins = (page: Page) => page.locator('[data-slot=comment-pins] button');
const row = (page: Page, text: string) => panel(page).locator('[data-slot=comment-row]', { hasText: text });
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);

async function shoot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  // A dialog that just opened is still fading in.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  );
  await page.screenshot({ path: `${SHOTS.replace(/\/?$/, '/')}${name}.png` });
}

async function write(page: Page, title: string, words: string, submit: 'button' | 'keys' = 'button') {
  await expect(composer(page).getByRole('heading', { name: title })).toBeVisible();
  await composer(page).getByRole('textbox', { name: 'Your comment' }).fill(words);
  if (submit === 'keys') await composer(page).getByRole('textbox').press('ControlOrMeta+Enter');
  else await composer(page).getByRole('button', { name: 'Add comment' }).click();
  await expect(composer(page)).toHaveCount(0);
}

test.describe('comments on the edit (EDT1-CMT)', () => {
  test('from C, a clip’s menu, the inspector and the viewer; edited and removed; sent together, each answered', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { speed: 0.5, latencyMs: 0 });
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, EDITOR);
    await showDetailedTimeline(page);

    // C on the selected clip.
    await clips(page).nth(1).click();
    await page.keyboard.press('c');
    await write(page, 'Comment on Clip 2', 'Start on the wave, not the sand');
    await expect(pins(page)).toHaveCount(1);
    await expect(pins(page).first()).toHaveAccessibleName('Comment on Clip 2');
    await expect(pins(page).first()).toHaveAccessibleDescription('Start on the wave, not the sand');

    // A clip's right-click menu.
    await clips(page).nth(4).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Comment…' }).click();
    await write(page, 'Comment on Clip 5', 'A beat shorter', 'keys');

    // The inspector, with nothing selected: the whole video.
    await page.keyboard.press('Escape');
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).getByRole('heading', { name: 'This video' })).toBeVisible();
    await inspector(page).getByRole('button', { name: 'Comment…' }).click();
    await write(page, 'Comment on the whole video', 'Warmer colours all through');
    // It waits in the dock: the whole video has no pin of its own.
    await expect(pins(page)).toHaveCount(2);

    // The viewer, at the playhead: the clip under it (the playhead back at the start: clip 1).
    await showDetailedTimeline(page);
    await page.getByRole('slider', { name: 'Playhead' }).press('Home');
    await page.getByRole('button', { name: 'Comment here', exact: true }).click();
    await write(page, 'Comment on Clip 1', 'Open on the market sign');
    await expect(pins(page)).toHaveCount(3);
    expect(await ran(page, 'comments.add')).toEqual(['ui', 'ui', 'ui', 'ui']);

    // The lower Comments panel: four open, in the order they were made.
    await openEditorTask(page, 'comments');
    await expect(panel(page)).toBeVisible();
    await expect(
      panel(page).getByRole('region', { name: 'Open' }).locator('[data-slot=comment-row]'),
    ).toHaveCount(4);
    await expect(panel(page).getByRole('button', { name: 'Send 4 comments to Taalcut' })).toBeEnabled();
    await expectAccessible(
      page,
      testInfo,
      'comments: four open (light)',
      axeFor(page).include('[data-slot=comments-panel]').include('[data-slot=editor-dock]'),
    );
    await shoot(page, 'comments-open-light');

    // Edited in place, and removed.
    // By its id: while it is edited its words are in the field, not the row's text.
    const id = await row(page, 'A beat shorter').getAttribute('data-comment-id');
    const shorter = panel(page).locator(`[data-comment-id="${id}"]`);
    await shorter.getByRole('button', { name: 'Edit' }).click();
    await shorter.getByRole('textbox', { name: 'Your comment' }).fill('Two beats shorter');
    await shorter.getByRole('button', { name: 'Save' }).click();
    await expect(row(page, 'Two beats shorter')).toBeVisible();
    await row(page, 'Warmer colours').getByRole('button', { name: 'Remove' }).click();
    await expect(row(page, 'Warmer colours')).toHaveCount(0);
    expect(await ran(page, 'comments.edit')).toEqual(['ui']);
    expect(await ran(page, 'comments.remove')).toEqual(['ui']);

    // A pin points at its comment, and the comment goes to its clip.
    await showDetailedTimeline(page);
    await pins(page).first().click();
    await expect(row(page, 'Start on the wave')).toHaveAttribute('data-status', 'open');
    await row(page, 'Two beats shorter').getByRole('button', { name: 'Clip 5' }).click();
    await expect(clips(page).nth(4)).toHaveAttribute('aria-selected', 'true');

    // Sent together: one message, the chat shows the work; each goes to With Taalcut, then Done with its answer.
    await panel(page).getByRole('button', { name: 'Send 3 comments to Taalcut' }).click();
    await expect(dock(page)).toBeVisible();
    await expect(dock(page)).toContainText('Please make the changes in my 3 comments.');
    await expect(page.locator('[data-slot=comment-pins] button[data-status=sent]').first()).toBeAttached();
    await expect(dock(page)).toContainText('I answered each of your comments.');
    await expect(pins(page)).toHaveCount(0);
    expect(await ran(page, 'comments.send')).toEqual(['agent']);
    expect(await ran(page, 'comments.reply')).toEqual(['agent', 'agent', 'agent']);

    await openEditorTask(page, 'comments');
    const done = panel(page).getByRole('region', { name: 'Done' }).locator('[data-slot=comment-row]');
    await expect(done).toHaveCount(3);
    for (const words of ['Start on the wave', 'Two beats shorter', 'Open on the market sign']) {
      await expect(row(page, words)).toHaveAttribute('data-status', 'resolved');
      await expect(row(page, words).locator('[data-slot=comment-reply]')).toContainText(`Done: ${words}`);
    }
    await expect(panel(page).getByRole('button', { name: 'Send comments to Taalcut' })).toBeDisabled();
    await shoot(page, 'comments-done-light');
    expect(problems).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`open, done and the viewer’s marker, with axe (${theme})`, async ({ page }, testInfo) => {
      const problems = await watchProblems(page);
      await fakeChat(page, { speed: 0, latencyMs: 0, comments: 'seeded' });
      await preferences(page, { theme, locale: 'en' });
      await open(page, EDITOR);
      await showDetailedTimeline(page);
      await expect(pins(page)).toHaveCount(1);
      // The playhead is on clip 1, which has a comment: the viewer says so.
      const here = page.getByRole('button', { name: '1 comment here' });
      await expect(here).toBeVisible();
      await here.click();
      await expect(panel(page)).toBeVisible();
      await expect(row(page, 'Start on the wave')).toHaveCSS('border-inline-start-style', 'solid');
      await expect(row(page, 'A beat shorter').locator('[data-slot=comment-reply]')).toContainText(
        'Clip 2 is a beat shorter now.',
      );
      await expectAccessible(
        page,
        testInfo,
        `comments (${theme})`,
        axeFor(page).include('[data-slot=comments-panel]').include('[data-slot=editor-dock]'),
      );
      await shoot(page, `comments-${theme}`);
      await showDetailedTimeline(page);
      await expect(pins(page).first()).toBeVisible();
      await expectAccessible(
        page,
        testInfo,
        `pins and the viewer's marker (${theme})`,
        axeFor(page).include('[data-slot=comment-pins]').include('[data-slot=comment-viewer-marker]'),
      );
      await clips(page).nth(2).click();
      await page.keyboard.press('c');
      await expect(composer(page)).toBeVisible();
      await expectAccessible(
        page,
        testInfo,
        `the composer (${theme})`,
        axeFor(page).include('[data-slot=comment-composer]'),
      );
      await shoot(page, `comment-composer-${theme}`);
      expect(problems).toEqual([]);
    });

  test('the pseudo-locale: Comments, the composer, the pins and the marker, translated and unclipped', async ({
    page,
  }) => {
    await fakeChat(page, { speed: 0, latencyMs: 0, comments: 'seeded' });
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await open(page, EDITOR);
    await showDetailedTimeline(page);
    await expect(pins(page)).toHaveCount(1);
    await openEditorTask(page, 'comments');
    await expect(panel(page).locator('[data-slot=comment-row]')).toHaveCount(3);
    await expectPseudoClean(page, 'comments panel (en-XA)');
    await shoot(page, 'comments-en-XA');
    await showDetailedTimeline(page);
    await clips(page).nth(2).click();
    await page.keyboard.press('c');
    await expect(composer(page)).toBeVisible();
    await expectPseudoClean(page, 'comment composer (en-XA)');
    await shoot(page, 'comment-composer-en-XA');
  });
});
