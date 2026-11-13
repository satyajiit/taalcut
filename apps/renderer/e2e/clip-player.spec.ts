// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The clip page's player (UX2): the fake's sample clips play real files (e2e/sample-media, served in byte ranges
// as main serves app://media), so these drive a real <video>: play and pause, drag-scrubbing with the mouse, the
// filmstrip from its sprite and what it says until there is one (round 2), the frame under the pointer, the keys (Space, J K L, arrows by frame and by shot), and the way out of waiting for
// models. Clips by id: e2e/clip-samples.ts.
import { expect, test, type Page } from '@playwright/test';
import { SAMPLE } from './clip-samples.ts';
import { FAKE_OPTIONS_KEY, fakeChat, open, watchProblems } from './support.ts';

async function sample(page: Page, id: string): Promise<void> {
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'library-asset', path: `/library/${id}` });
}

const video = (page: Page) => page.locator('[data-slot=clip-video]');
const scrub = (page: Page) => page.getByRole('slider', { name: 'Playhead' });
const timecode = (page: Page) => page.locator('[data-slot=clip-timecode] > span').first();
const playButton = (page: Page) => page.locator('[data-slot=clip-play]');
const videoTime = (page: Page) => video(page).evaluate((element: HTMLVideoElement) => element.currentTime);

async function loaded(page: Page): Promise<void> {
  // The first frame decodes in under a second alone; under a full run's load it once took over 5 s (round 2's third
  // full run, two tests): this waits for the video to have a frame, not for the machine to be quiet.
  await expect
    .poll(() => video(page).evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(playButton(page)).toBeEnabled();
}

test.describe('the clip page’s player', () => {
  test('a vertical clip plays at its own shape from its copy, in byte ranges', async ({ page }) => {
    const problems = await watchProblems(page);
    const ranges: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/fake-media/portrait.mp4')) ranges.push(request.headers()['range'] ?? '');
    });
    await sample(page, SAMPLE.portrait);
    await expect(page.locator('[data-slot=clip-viewer]')).toHaveAttribute('data-shape', 'tall');
    await loaded(page);
    expect(ranges.some((range) => range.startsWith('bytes='))).toBe(true);
    const frame = await page.locator('[data-slot=clip-frame]').boundingBox();
    expect(frame && frame.height > frame.width * 1.6).toBe(true);

    await playButton(page).click();
    await expect(playButton(page)).toHaveAccessibleName('Pause');
    await expect.poll(() => videoTime(page)).toBeGreaterThan(0.4);
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAccessibleName('Play');
    const at = await videoTime(page);
    await expect(timecode(page)).toHaveText(new RegExp(`^00:0${Math.floor(at)}\\.`));
    expect(problems).toEqual([]);
  });

  test('dragging on the scrubber scrubs: the video follows the pointer and stops where it is let go', async ({
    page,
  }) => {
    await sample(page, SAMPLE.portrait);
    await loaded(page);
    const box = await scrub(page).boundingBox();
    if (!box) throw new Error('the scrubber is on screen');
    const y = box.y + 28;
    await page.mouse.move(box.x + box.width * 0.1, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1)
      await page.mouse.move(box.x + box.width * (0.1 + step * 0.05), y);
    // Mid-drag, the video is already there (6.1 s × 0.5).
    await expect.poll(() => videoTime(page)).toBeCloseTo(3.05, 0);
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => videoTime(page)).toBeCloseTo(4.575, 1);
    await expect(timecode(page)).toHaveText(/^00:04\.5\d$/);
    await expect(scrub(page)).toHaveAttribute('aria-valuetext', /^00:04\.5\d of 00:06\.10, shot 3 of 4$/);
    await expect(page.getByRole('heading', { name: 'Shot 3 of 4' })).toBeVisible();
    await expect(page.locator('[data-slot=clip-speech-lane] [data-current]')).toHaveText(
      'Taking this one slow, right to the end.',
    );
  });

  test('hovering the scrubber shows the frame and the time under the pointer', async ({ page }) => {
    await sample(page, SAMPLE.portrait);
    await loaded(page);
    const box = await scrub(page).boundingBox();
    if (!box) throw new Error('the scrubber is on screen');
    await page.mouse.move(box.x + box.width * 0.25, box.y + 28);
    const hover = page.locator('[data-slot=clip-scrub-hover]');
    await expect(hover).toHaveAttribute('data-shown', 'true');
    await expect(hover).toContainText(/^00:01\.5\d$/);
    // The sprite frame nearest that moment (round 2: from the filmstrip, never sampled from the video).
    await expect(hover.locator('[data-frame] > [data-ready]')).toBeVisible();
    await page.mouse.move(box.x + box.width * 0.5, box.y - 120);
    await expect(hover).not.toHaveAttribute('data-shown', 'true');
  });

  test('the filmstrip is the clip’s own frames, drawn from the sprite made at import, with each shot’s kind', async ({
    page,
  }) => {
    const sprites: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('-strip.jpg')) sprites.push(new URL(request.url()).pathname);
    });
    await sample(page, SAMPLE.portrait);
    await loaded(page);
    const strip = page.locator('[data-slot=clip-filmstrip]');
    await expect(strip).toHaveAttribute('data-state', 'drawn');
    await expect(strip.locator('[data-ready]')).toBeVisible();
    expect(await strip.locator('[data-frame]').count()).toBeGreaterThan(8);
    // One sprite, one request; the only <video> is the viewer's (nothing decodes the clip to draw the strip).
    expect([...new Set(sprites)]).toEqual(['/fake-media/portrait-strip.jpg']);
    await expect(page.locator('video')).toHaveCount(1);
    await expect(page.locator('[data-slot=clip-shot]')).toHaveText(['Wide', 'Wide', 'Close-up', 'Detail']);
    await expect(page.locator('[data-slot=clip-sound-lane]')).toBeVisible();
    await expect(page.locator('[data-slot=clip-text-lane]')).toContainText('GOA · DAY 3');
  });

  test('keys: a frame, a shot, a second, the ends; Space plays wherever the focus is', async ({ page }) => {
    await sample(page, SAMPLE.portrait);
    await loaded(page);
    const slider = scrub(page);
    await slider.focus();
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuenow', '6100');
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuenow', '0');
    // One frame on at 30 fps lands in the middle of the second frame.
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', '50');
    await page.keyboard.press('PageUp');
    await expect(slider).toHaveAttribute('aria-valuenow', '1050');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /shot 2 of 4/);
    await page.keyboard.press('Shift+ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', /shot 3 of 4/);
    await expect.poll(() => videoTime(page)).toBeCloseTo(3.2, 1);

    await page.locator('[data-slot=clip-summary]').click();
    await page.keyboard.press('Space');
    await expect(playButton(page)).toHaveAccessibleName('Pause');
    await page.keyboard.press('k');
    await expect(playButton(page)).toHaveAccessibleName('Play');
    // The shots are one tab stop: the one at the playhead.
    await expect(page.locator('[data-slot=clip-shot][tabindex="0"]')).toHaveCount(1);
  });

  test('J K L shuttle: L plays and doubles, J plays backwards, K stops', async ({ page }) => {
    await sample(page, SAMPLE.portrait);
    await loaded(page);
    await page.locator('[data-slot=clip-summary]').click();
    await page.keyboard.press('l');
    await expect(playButton(page)).toHaveAccessibleName('Pause');
    await page.keyboard.press('l');
    await expect(page.locator('[data-slot=clip-shuttle]')).toHaveText('2×');
    await expect
      .poll(() => video(page).evaluate((element: HTMLVideoElement) => element.playbackRate))
      .toBe(2);
    await expect.poll(() => videoTime(page)).toBeGreaterThan(1.5);
    await page.keyboard.press('k');
    const stopped = await videoTime(page);
    await page.keyboard.press('j');
    await expect(page.locator('[data-slot=clip-shuttle]')).toHaveText('Backwards 1×');
    await expect.poll(() => videoTime(page)).toBeLessThan(stopped - 0.2);
    await page.keyboard.press('k');
    await expect(page.locator('[data-slot=clip-shuttle]')).toHaveCount(0);
    await expect(playButton(page)).toHaveAccessibleName('Play');
  });

  test('loop the shot, mute, and an original that is its own copy plays from the original', async ({
    page,
  }) => {
    await sample(page, SAMPLE.ownProxy);
    await loaded(page);
    await expect(video(page)).toHaveAttribute('src', '/fake-media/rotated.mp4');
    const loop = page.getByRole('button', { name: 'Loop this shot' });
    await loop.click();
    await expect(loop).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Mute' }).click();
    await expect(page.getByRole('button', { name: 'Turn the sound on' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await video(page).evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
    await playButton(page).click();
    // The first shot ends at 2.2 s: looping, the video comes back to its start instead of going on.
    await page.waitForTimeout(3000);
    expect(await videoTime(page)).toBeLessThan(2.25);
  });

  test('while the copy to play is made, the best frames show and the viewer says why it can’t play', async ({
    page,
  }) => {
    await sample(page, SAMPLE.preparing);
    await expect(page.locator('[data-slot=clip-viewer-message]')).toHaveText(
      'Taalcut is making a copy of this clip to play. Its best frames show meanwhile.',
    );
    await expect(video(page)).toHaveCount(0);
    await expect(playButton(page)).toBeDisabled();
    const strip = page.locator('[data-slot=clip-filmstrip]');
    await expect(strip).toHaveAttribute('data-state', 'afterCopy');
    await expect(strip).toHaveText('The frames come once the copy to play is made.');
    await expect(page.locator('[data-slot=clip-scrubber]')).toContainText(
      'Taalcut hasn’t split this clip into shots yet.',
    );
  });

  test('while the filmstrip is made the clip plays, and the strip and the hover say so without a stand-in', async ({
    page,
  }) => {
    await sample(page, SAMPLE.makingFilmstrip);
    await loaded(page);
    const strip = page.locator('[data-slot=clip-filmstrip]');
    await expect(strip).toHaveAttribute('data-state', 'making');
    await expect(strip).toHaveText('Laying out this clip’s frames…');
    await expect(strip.locator('[data-frame]')).toHaveCount(0);
    const box = await scrub(page).boundingBox();
    if (!box) throw new Error('the scrubber is on screen');
    await page.mouse.move(box.x + box.width * 0.5, box.y + 28);
    const hover = page.locator('[data-slot=clip-scrub-hover]');
    await expect(hover).toHaveAttribute('data-shown', 'true');
    await expect(hover.locator('[data-frame]')).toHaveCount(0);
    await expect(hover).toContainText(/^00:0\d\.\d\d$/);
  });

  test('a filmstrip that couldn’t be made says why', async ({ page }) => {
    await sample(page, SAMPLE.filmstripFailed);
    await loaded(page);
    const strip = page.locator('[data-slot=clip-filmstrip]');
    await expect(strip).toHaveAttribute('data-state', 'failed');
    await expect(strip).toHaveText(
      'Taalcut couldn’t lay out the frames. Part of this clip couldn’t be decoded. It may be damaged.',
    );
  });
});

test.describe('a clip waiting for models', () => {
  /** The indexing models aren't on this Mac (the PO's library), or one of them won't download. */
  const withoutModels = (page: Page, models: 'missing' | 'broken') =>
    page.addInitScript(
      ({ key, models }) =>
        window.localStorage.setItem(key, JSON.stringify({ indexingTickMs: 0, models, downloadTickMs: 150 })),
      { key: FAKE_OPTIONS_KEY, models },
    );

  test('says which models, what starts after them, and downloads them with progress', async ({ page }) => {
    await withoutModels(page, 'missing');
    await open(page, { name: 'library-asset', path: `/library/${SAMPLE.waitingForModels}` });
    const card = page.locator('[data-slot=clip-models-card]');
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(
      'Waiting for the speech and search models',
    );
    await expect(card).toContainText('7 steps start by themselves once they’re on this Mac.');
    // The groups say what waits for a model (LIB1-PROG), not a count of steps as if it were working.
    const status = page.locator('[data-slot=clip-status]');
    await expect(status.locator('[data-slot=clip-groups] [data-state=model]')).not.toHaveCount(0);
    // The clip still plays: its copy was made before the models were needed.
    await loaded(page);

    await status.getByRole('button', { name: 'Show the steps' }).click();
    await expect(status.locator('[data-slot=stage-reason]', { hasText: 'waits for its model' })).toHaveCount(
      5,
    );

    const models = card.getByRole('list', { name: 'Models this clip needs' }).getByRole('listitem');
    await expect(models).toHaveCount(2);
    await card.locator('[data-action=download-clip-models]').click();
    // Its rows are a few parts of a bigger download: a line says what the whole download is doing, so a row moving at
    // its share of the speed doesn't read as the download being slow.
    const whole = card.locator('[data-slot=clip-models-whole]');
    await expect(whole.locator('[data-slot=downloads-line]')).toContainText(
      /Everything this (Mac|computer) needs/,
    );
    await expect(whole).toContainText(/\d+ more parts? (is|are) on (its|their) way with these\./);
    await expect(whole.getByRole('link', { name: 'See every part' })).toHaveAttribute(
      'href',
      '/settings/models',
    );
    await expect(card.getByRole('progressbar').first()).toBeVisible();
    await expect(card).toContainText('The models are on this Mac. The steps start by themselves.', {
      timeout: 15_000,
    });
  });

  test('a model that doesn’t download says so, with Try again as the one fix', async ({ page }) => {
    await withoutModels(page, 'broken');
    await open(page, { name: 'library-asset', path: `/library/${SAMPLE.waitingForModels}` });
    const card = page.locator('[data-slot=clip-models-card]');
    await card.locator('[data-action=download-clip-models]').click();
    await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 15_000 });
    await expect(card.locator('[data-action=download-clip-models]')).toHaveCount(0);
    await expect(card.locator('li[data-state=failed]')).toContainText('Didn’t download');
  });
});
