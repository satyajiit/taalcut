// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The clip page (UX1, revamped in UX2): the clip at its shape over its transport and scrubber, the inspector beside
// it (what Taalcut saw, how far it got, the shot at the playhead, the facts in groups, what's said); the shot chips,
// the transcript and the keys move one playhead; every state says what is wrong and offers the fix the library has.
// Clips are the fake library's (src/backend/fake/library), by id; the player's own checks are clip-player.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { SAMPLE } from './clip-samples.ts';
import { CLIP } from './routes.ts';
import { FAKE_OPTIONS_KEY, fakeChat, open, preferences, watchProblems } from './support.ts';

/** The fake library's clips for each state (IMG_5264.MOV, the routes' CLIP, is the ordinary one). */
const CLIPS = {
  landscape: '01K7C5M6Q8100000000000019G',
  searchable: '01K7C5M6Q810000000000004RG',
  justAdded: '01K7C5M6Q810000000000004RK',
  failed: '01K7C5M6Q810000000000000KR',
  driveAway: '01K7C5M6Q81000000000000002',
  goneFromFolder: '01K7C5M6Q810000000000001YM',
  goneFromLibrary: '01K7C5M6Q810000000000001HK',
  tinySilent: '01K7C5M6Q81000000000002QWH',
  flaky: '01K7C5M6Q81000000000002QWJ',
  notInLibrary: '01K7C5M6Q8R9S0T1V2W3X4Y5Z6',
} as const;

async function clip(page: Page, id: string): Promise<void> {
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'library-asset', path: `/library/${id}` });
}

const playhead = (page: Page) => page.getByRole('slider', { name: 'Playhead' });
const shots = (page: Page) => page.locator('[data-slot=clip-shot]');
const facts = (page: Page) => page.locator('[data-slot=clip-facts]');
const scrubber = (page: Page) => page.locator('[data-slot=clip-scrubber]');
const lines = (page: Page) => page.locator('[data-slot=clip-line]');
const status = (page: Page) => page.locator('[data-slot=clip-status]');
const timecode = (page: Page) => page.locator('[data-slot=clip-timecode]');

test.describe('the clip page', () => {
  test('a clip: the picture at its shape, the facts, its timeline and what is said', async ({ page }) => {
    const problems = await watchProblems(page);
    await clip(page, CLIP);
    await expect(page.locator('h1')).toContainText('IMG_5264.MOV');
    await expect(page.locator('[data-slot=clip-viewer]')).toHaveAttribute('data-shape', 'tall');
    await expect(facts(page).getByRole('heading', { level: 3 })).toHaveText([
      'Picture',
      'Sound',
      'When and where',
      'File',
    ]);
    await expect(facts(page)).toContainText('29.97 frames a second');
    await expect(facts(page)).toContainText('Spanish speech');
    await expect(facts(page)).toContainText('Apple iPhone 16 Pro');
    await expect(timecode(page)).toHaveText(/^00:00\.00\s*\/\s*00:29\.42$/);
    await expect(shots(page)).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'What’s said' })).toBeVisible();
    await expect(status(page)).toHaveAttribute('data-phase', 'complete');
    await expect(page.getByRole('button', { name: 'Make a video with this clip' })).toBeEnabled();
    // The fake's generated clips have no copy to play: the viewer says so and offers the fix.
    await expect(page.locator('[data-slot=clip-viewer-message]')).toContainText(
      'There’s no copy of this clip to play',
    );
    // No back button of the page's own: the shell's back and forward are the way out.
    await expect(page.locator('main').getByRole('link', { name: /back/i })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('loading: the page’s bones, captured from its layout, until the clip arrives', async ({ page }) => {
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: FAKE_OPTIONS_KEY,
      value: JSON.stringify({ indexingTickMs: 0, libraryLatencyMs: 1500 }),
    });
    await page.goto(`/library/${CLIP}`);
    const bones = page.locator('[data-boneyard][aria-busy="true"] .tc-bone');
    await expect(bones.first()).toBeVisible();
    expect(await bones.count()).toBeGreaterThan(20);
    await expect(page.locator('[data-slot=clip-viewer]')).toBeVisible();
    await expect(bones).toHaveCount(0);
  });

  test('the shot chips and the transcript move the playhead; the shot and the line follow', async ({
    page,
  }) => {
    await clip(page, CLIP);
    await shots(page).nth(2).click();
    await expect(shots(page).nth(2)).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { name: 'Shot 3 of 5' })).toBeVisible();
    await expect(timecode(page)).toContainText('00:11.04');

    await lines(page).nth(3).click();
    await expect(lines(page).nth(3)).toHaveAttribute('aria-current', 'true');
    await expect(timecode(page)).toContainText('00:22.18');
    await expect(page.getByRole('heading', { name: 'Shot 4 of 5' })).toBeVisible();
    await expect(playhead(page)).toHaveAttribute('aria-valuetext', /shot 4 of 5/);
    // The player stays in view while the column beside it scrolls to the line.
    await expect(page.locator('[data-slot=clip-viewer]')).toBeInViewport();

    await page.getByRole('button', { name: 'Previous shot' }).click();
    await expect(timecode(page)).toContainText('00:15.08');
    await page.getByRole('button', { name: 'Next shot' }).click();
    await expect(timecode(page)).toContainText('00:23.02');
  });

  test('keyboard: the playhead steps by frame, second and shot; the shots and the lines are one tab stop each', async ({
    page,
  }) => {
    await clip(page, CLIP);
    const slider = playhead(page);
    await slider.focus();
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', (await slider.getAttribute('aria-valuemax')) ?? '');
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    // One frame at 29.97 fps, landing mid-frame.
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await page.keyboard.press('PageUp');
    await expect(slider).toHaveAttribute('aria-valuenow', '1050');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /shot 2 of 5/);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '11044');
    await expect(slider).toHaveAttribute('aria-valuetext', /shot 3 of 5/);

    await expect(page.locator('[data-slot=clip-shot][tabindex="0"]')).toHaveCount(1);
    await shots(page).nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(shots(page).nth(2)).toBeFocused();
    await expect(shots(page).nth(2)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('End');
    await expect(shots(page).nth(4)).toBeFocused();

    await lines(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(lines(page).nth(1)).toBeFocused();
    await expect(lines(page).nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(timecode(page)).toContainText(/00:07\.5\d/);
  });

  test('still being looked at: search finds it already, the step running and what is left', async ({
    page,
  }) => {
    await clip(page, CLIPS.searchable);
    // What it is good for first (LIB1-PROG), then what runs now, then the groups; the steps one by one are folded.
    await expect(status(page).getByRole('heading', { level: 2 })).toHaveText(
      /You can (play and )?search this clip now/,
    );
    await expect(status(page).locator('[data-slot=clip-now]')).toContainText('Taalcut is describing it.');
    await expect(status(page).locator('[data-slot=clip-groups] [data-group=describe]')).toHaveAttribute(
      'data-state',
      'now',
    );
    await expect(status(page).locator('[data-slot=clip-groups] [data-group=search]')).toHaveAttribute(
      'data-state',
      'done',
    );
    await expect(status(page).getByRole('button', { name: 'Show the steps' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('just added: each part not made yet says so', async ({ page }) => {
    await clip(page, CLIPS.justAdded);
    await expect(status(page).getByRole('heading', { level: 2 })).toHaveText(
      'Taalcut is still looking at this clip',
    );
    await expect(scrubber(page)).toContainText('Taalcut hasn’t split this clip into shots yet.');
    await expect(page.locator('[data-slot=clip-transcript]')).toContainText(
      'Taalcut hasn’t listened to this clip yet.',
    );
    await expect(page.locator('[data-slot=clip-notices]')).toContainText('Your iPhone sent a smaller copy');
  });

  test('a step failed: where it stopped, and Analyse again starts the clip over', async ({ page }) => {
    await clip(page, CLIPS.failed);
    await expect(status(page)).toHaveAttribute('data-phase', 'failed');
    await expect(status(page)).toContainText('Stopped at: Finding shots');
    await expect(scrubber(page)).toContainText('Taalcut couldn’t split this clip into shots.');
    await expect(page.getByRole('button', { name: 'Make a video with this clip' })).toBeDisabled();
    await status(page).getByRole('button', { name: 'Analyse again' }).click();
    await expect(status(page)).toHaveAttribute('data-phase', 'running');
    await expect(status(page).locator('[data-slot=clip-now]')).toContainText(
      'Taalcut is getting it ready to play.',
    );
  });

  test('the original away: a drive to connect, a folder to look in again, or an import to redo', async ({
    page,
  }) => {
    await clip(page, CLIPS.driveAway);
    await expect(page.locator('[data-slot=clip-notices]')).toContainText(
      'The original is on Samsung T7, which isn’t connected.',
    );

    await clip(page, CLIPS.goneFromLibrary);
    await expect(page.locator('[data-slot=clip-notices]')).toContainText(
      'Import it again from iPhone 16 Pro, or remove this clip.',
    );
    await expect(page.getByRole('button', { name: 'Look again' })).toHaveCount(0);

    await clip(page, CLIPS.goneFromFolder);
    const notices = page.locator('[data-slot=clip-notices]');
    await expect(notices).toContainText('Taalcut can’t find the original in Desktop clips any more.');
    await expect(page.getByRole('button', { name: 'Make a video with this clip' })).toBeDisabled();
    await page.getByRole('button', { name: 'Look again' }).click();
    await expect(notices).toContainText('Taalcut is looking through Desktop clips.');
    // The fake's look-through finds the file where it was: the clip is whole again.
    await expect(notices).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Make a video with this clip' })).toBeEnabled();
  });

  test('a short clip with no shots and no sound says so in each place', async ({ page }) => {
    await clip(page, CLIPS.tinySilent);
    await expect(scrubber(page)).toContainText('No shots were found in this clip');
    await expect(shots(page)).toHaveCount(0);
    await expect(facts(page)).toContainText('No sound');
    await expect(page.locator('[data-slot=clip-transcript]')).toContainText('This clip has no sound.');
    await expect(status(page)).toHaveAttribute('data-phase', 'complete');
  });

  test('a clip not in the library: one sentence and the way to the library', async ({ page }) => {
    await clip(page, CLIPS.notInLibrary);
    await expect(
      page.getByRole('heading', { name: 'This clip isn’t in your library any more' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Go to Library' }).click();
    await expect(page).toHaveURL(/\/library$/);
  });

  test('a read that fails: the cause, and Try again loads the clip', async ({ page }) => {
    await clip(page, CLIPS.flaky);
    const error = page.locator('[data-slot=clip-error]');
    await expect(error.getByRole('heading')).toHaveText('Taalcut couldn’t open this clip');
    await expect(error).toContainText('This took too long');
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('[data-slot=clip-viewer]')).toBeVisible();
    await expect(page.locator('h1')).toContainText('IMG_5264.MOV');
  });

  test('another clip in the same window shows that clip, never the last one', async ({ page }) => {
    await clip(page, CLIP);
    await page.evaluate((id) => {
      window.history.pushState({}, '', `/library/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, CLIPS.landscape);
    await expect(page.locator('h1')).toContainText('PXL_20260624_101328.mp4');
    await expect(page.locator('[data-slot=clip-viewer]')).toHaveAttribute('data-shape', 'wide');
    await expect(timecode(page)).toContainText('00:00.00');
  });

  test('More: analyse again; remove, with Undo in the toast', async ({ page }) => {
    await clip(page, CLIP);
    await page.getByRole('button', { name: 'More for this clip' }).click();
    await page.getByRole('menuitem', { name: 'Analyse again' }).click();
    await expect(status(page)).toHaveAttribute('data-phase', 'running');

    await page.getByRole('button', { name: 'More for this clip' }).click();
    await expect(page.getByRole('menuitem', { name: 'Analyse again' })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Remove from library' }).click();
    await expect(page).toHaveURL(/\/library$/);
    const toast = page.getByText('Removed IMG_5264.MOV from your library', { exact: true });
    await expect(toast).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.goBack();
    await expect(page.locator('h1')).toContainText('IMG_5264.MOV');
    await expect(page.locator('[data-slot=clip-notices]')).toHaveCount(0);
  });

  test('Show in Finder asks main to show the original', async ({ page }) => {
    await clip(page, SAMPLE.portrait);
    const show = facts(page).getByRole('button', { name: 'Show in Finder' });
    await show.click();
    await expect(show).not.toHaveAttribute('data-state', 'error');
    // The original away: nothing to show, so no button.
    await clip(page, CLIPS.driveAway);
    await expect(facts(page).getByRole('button', { name: 'Show in Finder' })).toHaveCount(0);
  });

  test('Make a video opens a new chat with the clip named in the composer', async ({ page }) => {
    await clip(page, CLIP);
    await page.getByRole('button', { name: 'Make a video with this clip' }).click();
    await expect(page).toHaveURL(/\/chat\/[0-9A-Z]{26}$/);
    await expect(page.getByRole('textbox', { name: 'Message Taalcut' })).toHaveValue(
      'Make a short video with my clip “IMG_5264.MOV”',
    );
  });
});

test.describe('the clip page, checked', () => {
  // One test per clip and theme: an axe pass on this page takes 3–4 s under a full run's load, so seven in one test
  // came within reach of the 30 s limit (24.8 s and 26.9 s re-run with two workers).
  const checked = {
    'a clip': CLIP,
    'a clip that plays': SAMPLE.portrait,
    'waiting for models': SAMPLE.waitingForModels,
    'a failed step': CLIPS.failed,
    'gone from its folder': CLIPS.goneFromFolder,
    'tiny and silent': CLIPS.tinySilent,
  } as const;
  // Round 2: the filmstrip's line while it is after the copy, being made, and failed.
  const strips = {
    'the filmstrip after the copy': SAMPLE.preparing,
    'the filmstrip being made': SAMPLE.makingFilmstrip,
    'the filmstrip failed': SAMPLE.filmstripFailed,
  } as const;
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, id] of Object.entries(checked))
      test(`axe, ${theme}: ${name}`, async ({ page }, testInfo) => {
        await preferences(page, { theme });
        await clip(page, id);
        await expectAccessible(page, testInfo, `clip ${id} (${theme})`);
      });
    for (const [name, id] of Object.entries(strips))
      test(`axe, ${theme}: ${name}`, async ({ page }, testInfo) => {
        await preferences(page, { theme });
        await clip(page, id);
        await expect(page.locator('[data-slot=clip-filmstrip-state]')).toBeVisible();
        await expectAccessible(page, testInfo, `clip ${id}, its filmstrip's state (${theme})`);
      });
    test(`axe, ${theme}: the steps open and a line chosen`, async ({ page }, testInfo) => {
      await preferences(page, { theme });
      await clip(page, CLIP);
      await page.getByRole('button', { name: 'Show the steps' }).click();
      await lines(page).nth(2).click();
      await expectAccessible(page, testInfo, `clip, steps open, a line chosen (${theme})`);
    });
  }

  test.describe('pseudo-locale (en-XA) at the smallest window', () => {
    test.use({ viewport: { width: 1024, height: 720 } });
    for (const id of [
      CLIP,
      SAMPLE.portrait,
      SAMPLE.waitingForModels,
      SAMPLE.preparing,
      SAMPLE.makingFilmstrip,
      SAMPLE.filmstripFailed,
      CLIPS.searchable,
      CLIPS.failed,
      CLIPS.goneFromFolder,
      CLIPS.tinySilent,
    ])
      test(`clip ${id}: everything translated, nothing clipped`, async ({ page }) => {
        await preferences(page, { locale: 'en-XA', theme: 'light' });
        await clip(page, id);
        // The sidebar's recent chats carry their names in a title attribute the check reads as UI text: the shell's
        // (requests-clip-to-nav.md), not this page's.
        const text = (await userFacingText(page)).filter((found) => !found.where.endsWith('a > span @title'));
        expect(englishShowing(text, englishPhrases()), 'English source strings on screen').toEqual([]);
        expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
        expect(await clippedText(page), 'text that does not fit').toEqual([]);
      });
  });
});
