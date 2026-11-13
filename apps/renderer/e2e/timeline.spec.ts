// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-M7 "Done when": the editor opens a project's cut, every edit is a timeline command on the bus (⌘Z
// undoes it), a clip or a stretch of time goes to the chat as a chip, and the agent edits the clip a chip
// points at. Against the Make fakes (src/backend/fake/make): Golden hour market, three videos of 12 clips.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { PROJECT } from './routes.ts';
import { fakeChat, open, watchProblems } from './support.ts';

const EDITOR = { name: 'project-timeline', path: `/projects/${PROJECT}/timeline` };
/** Product teaser (no cut yet) and a project that was never there (backend/fake/make/ids.ts). */
const TEASER = '01K7C5M6Q8M000000000000004';
const MISSING = '01K7C5M6Q8M0000000000000ZZ';
/** Golden hour market's first video. */
const GOLDEN_VIDEO = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB';

const clips = (page: Page) => page.getByRole('listbox', { name: 'Clips' }).getByRole('option');
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const dock = (page: Page) => page.locator('[data-slot=editor-dock]');
const widthOf = (clip: Locator) => clip.evaluate((el) => el.getBoundingClientRect().width);
const order = (page: Page) =>
  page
    .locator('[data-slot=timeline-clip]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-clip-id')));
const ran = async (page: Page, name: string) =>
  (await backend.dispatched(page)).filter((d) => d.name === name).map((d) => d.source);

test.beforeEach(async ({ page }) => {
  // The fake chat plays its scripts at once; renders hold still.
  await fakeChat(page, { speed: 0, latencyMs: 0 });
});

test.describe('timeline editor (P2-M7)', () => {
  test('opens the first video: twelve clips, the AI’s picks and your swap, the beat', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Golden hour market');
    await expect(clips(page)).toHaveCount(12);
    await expect(page.locator('[data-slot=timeline-clip][data-chosen-by=you]')).toHaveCount(1);
    await expect(page.locator('[data-slot=timeline-clip][data-chosen-by=ai]')).toHaveCount(11);
    await expect(page.getByRole('button', { name: 'Video 1 of 3' })).toBeVisible();
    await expect(page.locator('[data-slot=beat-lane] span').first()).toBeAttached();
    await expect(page.locator('[data-slot=timecode]')).toHaveText(/^00:00\s*\/\s*00:\d\d$/);
    await expect(inspector(page)).toHaveCount(0);
    // The screen's one marigold fill.
    await expect(page.locator('[data-slot=export]')).toBeEnabled();
    expect(problems).toEqual([]);
  });

  test('from the keyboard: arrows select, ] lengthens by a beat, ⌘→ moves, ⌘Z undoes', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await clips(page).nth(1).click();
    await expect(clips(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/clip=/);
    await page.keyboard.press('ArrowRight');
    const third = clips(page).nth(2);
    await expect(third).toBeFocused();
    await expect(third).toHaveAttribute('aria-selected', 'true');
    await expect(dock(page).locator('[data-slot=composer] [data-slot=selection-chip]')).toContainText(
      'Clip 3',
    );

    const before = await widthOf(third);
    // ⌘[ and ⌘] belong to the window (Back and Forward): never a trim.
    await page.keyboard.press('Meta+BracketRight');
    await page.keyboard.press('Control+BracketRight');
    expect(await ran(page, 'timeline.trimClip')).toEqual([]);
    expect(await widthOf(third)).toBeCloseTo(before, 0);
    await third.focus();
    await page.keyboard.press(']');
    await expect.poll(() => widthOf(third)).toBeGreaterThan(before + 4);
    expect(await ran(page, 'timeline.trimClip')).toEqual(['ui']);
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => widthOf(third), { timeout: 500 }).toBeCloseTo(before, 0);
    }).toPass();

    const start = await order(page);
    await clips(page).nth(2).focus();
    await page.keyboard.press('Meta+ArrowRight');
    await expect
      .poll(() => order(page))
      .toEqual([...start.slice(0, 2), start[3], start[2], ...start.slice(4)]);
    expect(await ran(page, 'timeline.moveClip')).toEqual(['ui']);
  });

  test('the edit tools stay on screen at 1280×800: a beat longer, Undo and Redo; a picked clip moves the playhead', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const tools = page.getByRole('group', { name: 'Edit' });
    await expect(tools).toBeInViewport();
    const longer = tools.getByRole('button', { name: 'A beat longer' });
    const undo = tools.getByRole('button', { name: 'Undo' });
    const redo = tools.getByRole('button', { name: 'Redo' });
    // The trims are the selected clip's: off with none.
    await expect(longer).toBeDisabled();
    await expect(tools.getByRole('button', { name: 'A beat shorter' })).toBeDisabled();

    // Picking a clip puts the playhead on its first frame.
    const fifth = clips(page).nth(4);
    await fifth.click();
    const knob = page.getByRole('slider', { name: 'Playhead' });
    await expect
      .poll(async () => {
        const [clip, head] = [await fifth.boundingBox(), await knob.boundingBox()];
        return clip && head ? Math.abs(head.x + head.width / 2 - clip.x) : Infinity;
      })
      .toBeLessThan(4);
    await expect(page.locator('[data-slot=timecode] span').first()).not.toHaveText('00:00');

    const before = await widthOf(fifth);
    await expect(longer).toBeEnabled();
    await longer.click();
    await expect.poll(() => widthOf(fifth)).toBeGreaterThan(before + 4);
    expect(await ran(page, 'timeline.trimClip')).toEqual(['ui']);
    // Undo names what it would undo, in its tooltip.
    await expect(undo).toBeEnabled();
    await undo.hover();
    await expect(page.locator('[data-slot=tooltip-content]').first()).toContainText('Undo “');
    await undo.click();
    await expect.poll(() => widthOf(fifth)).toBeCloseTo(before, 0);
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect.poll(() => widthOf(fifth)).toBeGreaterThan(before + 4);
    // Kaatu never sits over footage.
    await expect(page.locator('[data-slot=timeline-editor] [data-slot=mascot]')).toHaveCount(0);
  });

  test('a swap from the inspector makes the clip yours', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await clips(page).nth(2).click();
    await page.locator('[data-tool=replace]').click();
    const others = inspector(page).getByRole('group', { name: 'Other shots for clip 3' });
    await others.locator('[data-alternate="0"]').click();
    await expect(page.locator('[data-slot=timeline-clip]').nth(2)).toHaveAttribute('data-chosen-by', 'you');
    expect(await ran(page, 'timeline.swapClip')).toEqual(['ui']);
    await page.locator('[data-tool=more]').click();
    await inspector(page).getByText('Source details', { exact: true }).click();
    await expect(inspector(page)).toContainText('You changed this');
  });

  test('a stretch of the ruler goes to the docked chat as a chip', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const ruler = page.locator('[data-slot=timeline-ruler]');
    const box = (await ruler.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.locator('[data-tool=more]').click();
    await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText(/^From 00:\d\d to 00:\d\d$/);
    await expect(page.locator('[data-slot=timeline-range]')).toContainText('beats');
    await inspector(page).getByRole('button', { name: 'Add to chat' }).click();
    await expect(dock(page).getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
    await expect(dock(page).locator('[data-slot=selection-chip][data-kind=range]')).toBeVisible();
  });

  test('the agent trims the clip a chip points at, and the chip opens it again', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const third = clips(page).nth(2);
    await third.click();
    const before = await widthOf(third);
    await page.keyboard.press('ControlOrMeta+Shift+a');
    const tray = dock(page).locator('[data-slot=composer] [data-slot=selection-chip][data-kind=clip]');
    await expect(tray).toContainText('Clip 3');

    const box = dock(page).getByRole('textbox', { name: 'Message Taalcut' });
    await box.fill('Make this shot shorter');
    await box.press('Enter');
    await expect.poll(() => widthOf(third)).toBeLessThan(before - 4);
    expect(await ran(page, 'timeline.trimClip')).toEqual(['agent']);
    await expect(dock(page)).toContainText('clip 3 is a beat shorter');
    // The chip went with the message, and stays on it; the tray shows the clip still selected (EDT1).
    await expect(tray).toHaveCount(1);
    const sent = dock(page).locator('article [data-slot=selection-chip][data-kind=clip]');
    await expect(sent).toContainText('Clip 3');

    await page.getByRole('group', { name: 'Video preview' }).click();
    await page.keyboard.press('Escape');
    await expect(third).toHaveAttribute('aria-selected', 'false');
    await sent.getByRole('button').first().click();
    await expect(third).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/clip=/);
  });

  test('words on screen are edited in place', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const words = page.locator('[data-slot=timeline-text]').first();
    await words.dblclick();
    const field = page.locator('[data-slot=text-edit]');
    await expect(field).toBeFocused();
    await field.fill('MARKET AT DUSK');
    await field.press('Enter');
    await expect(page.locator('[data-slot=timeline-text]').first()).toHaveText('MARKET AT DUSK');
    expect(await ran(page, 'timeline.editText')).toEqual(['ui']);
  });

  test('Space plays and pauses; the playhead’s timecode moves', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    const now = page.locator('[data-slot=timecode] span').first();
    await page.getByRole('group', { name: 'Video preview' }).click();
    await page.keyboard.press('Space');
    // Exact names: "Split at the playhead" (EDT1-OPS) also has "play" in it.
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(now).not.toHaveText('00:00', { timeout: 3000 });
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const handle = page.getByRole('slider', { name: 'Playhead' });
    await handle.focus();
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '15');
  });

  test('the other videos, a project with no cut yet, and one that isn’t there', async ({ page }) => {
    await open(page, EDITOR);
    await page.locator('[data-slot=timeline-detail-toggle]').click();
    await page.getByRole('button', { name: 'Video 1 of 3' }).click();
    await page.getByRole('menuitemradio', { name: /Video 2/ }).click();
    await expect(page.getByRole('button', { name: 'Video 2 of 3' })).toBeVisible();
    await expect(page).toHaveURL(/timeline=/);

    await page.goto(`/projects/${TEASER}/timeline`);
    await expect(page.getByText('Nothing on the timeline yet')).toBeVisible();
    await page.goto(`/projects/${MISSING}/timeline`);
    await expect(page.getByRole('heading', { name: 'This project isn’t here any more' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Make' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test('the reads run side by side: at 2.5 s a read, the named video opens in about one read', async ({
    page,
  }) => {
    // Every Make read waits 2.5 s. One after another (project and list, then the watch) is 5 s or more.
    await page.addInitScript(() =>
      window.localStorage.setItem(
        'taalcut.fake',
        JSON.stringify({ speed: 0, latencyMs: 0, libraryLatencyMs: 2500 }),
      ),
    );
    await page.goto(`${EDITOR.path}?timeline=${GOLDEN_VIDEO}`);
    await expect(page.locator('[data-slot=editor-bones]')).toBeVisible();
    await expect(page.locator('[data-slot=timeline-editor]')).toBeVisible({ timeout: 10_000 });
    const since = await page.evaluate(() => performance.now());
    expect(since).toBeLessThan(4600);
    await expect(page.locator('[data-slot=scene-strip]').getByRole('button')).toHaveCount(12);
  });
});
