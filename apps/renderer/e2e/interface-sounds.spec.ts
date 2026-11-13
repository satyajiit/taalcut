// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test, type Page } from '@playwright/test';
import { fakeChat, watchProblems } from './support.ts';

type Played = { src: string; outcome: 'playing' | 'refused' | 'pending' };
type SoundWindow = Window & {
  soundPlays: Played[];
  soundMedia?: HTMLAudioElement;
  taalcutFake: { events: { emit(type: string, payload: unknown): void } };
};

/** Record real, detached interface audio; attached media still uses native browser playback. */
async function recordPlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const plays: { src: string; outcome: string }[] = [];
    (window as unknown as { soundPlays: typeof plays }).soundPlays = plays;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const entry = { src: this.currentSrc || this.src, outcome: 'pending' };
      if (!this.isConnected) plays.push(entry);
      const started = play.call(this);
      started.then(
        () => (entry.outcome = 'playing'),
        () => (entry.outcome = 'refused'),
      );
      return started;
    };
  });
}

const plays = (page: Page) => page.evaluate(() => (window as unknown as SoundWindow).soundPlays);
const names = async (page: Page) =>
  (await plays(page)).map((play) =>
    play.src
      .split('/')
      .pop()
      ?.replace(/-[\w-]{8}\.m4a$/, ''),
  );
const toggle = (page: Page) => page.getByRole('switch', { name: 'Interface sounds' });
async function ready(page: Page) {
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).not.toHaveAttribute('aria-busy', 'true');
}
async function enablePreview(page: Page) {
  await ready(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await ready(page);
  await toggle(page).click();
  await expect.poll(async () => (await plays(page)).map((p) => p.outcome)).toEqual(['playing']);
  await page.waitForTimeout(300);
}
async function exportFinished(page: Page, suffix: string, status = 'ready') {
  await page.evaluate(
    ({ suffix, status }) => {
      (window as unknown as SoundWindow).taalcutFake.events.emit('render.finished', {
        renderId: '01ARZ3NDEKTSV4RRFFQ69G5FA' + suffix,
        projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        status,
        notify: false,
        name: 'Sound test',
      });
    },
    { suffix, status },
  );
}

test('default, reload persistence, and an audible enable preview under CSP', async ({ page }) => {
  const problems = await watchProblems(page);
  await recordPlays(page);
  await page.goto('/settings/general');
  await ready(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/Quiet sounds for sending prompts/)).toBeVisible();
  await toggle(page).click();
  await ready(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await ready(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await plays(page)).toEqual([]);
  await toggle(page).click();
  await expect.poll(async () => (await plays(page)).map((p) => p.outcome)).toEqual(['playing']);
  expect(await names(page)).toEqual(['edit-applied']);
  expect(problems).toEqual([]);
});

test('legacy off migrates before any cue', async ({ page }) => {
  await recordPlays(page);
  await page.addInitScript(() => localStorage.setItem('taalcut.sounds', 'off'));
  await page.goto('/settings/general');
  await ready(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('taalcut.sounds'))).toBeNull();
  expect(await plays(page)).toEqual([]);
});

test('phone batches have completion cues only, and the global switch silences them', async ({ page }) => {
  await recordPlays(page);
  await fakeChat(page, { transfer: 'phone', transferSpeed: 8 });
  await page.goto('/library/phone/wifi');
  await page.locator('[data-action=wifi-connect]').click();
  await expect.poll(() => names(page), { timeout: 20_000 }).toContain('import-done');
  expect(new Set(await names(page))).toEqual(new Set(['import-done']));
  await page.goto('/settings/general');
  await ready(page);
  await toggle(page).click();
  await ready(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await page.goto('/library/phone/wifi');
  await page.locator('[data-action=wifi-connect]').click();
  await page.waitForTimeout(4_000);
  expect(await plays(page)).toEqual([]);
});

// OS focus and visibility gates are covered by sound-runtime.test.ts; headless pages remain focused.
test('real media suppresses completion without replay and failed exports stay silent', async ({ page }) => {
  const problems = await watchProblems(page);
  await recordPlays(page);
  await page.goto('/settings/general');
  await enablePreview(page);
  const src = (await plays(page))[0]!.src;
  await page.evaluate(async (src) => {
    const w = window as unknown as SoundWindow;
    const media = document.createElement('audio');
    media.src = src;
    media.loop = true;
    document.body.append(media);
    w.soundMedia = media;
    // The instrumentation closure keeps this array: reset it without replacing the reference.
    w.soundPlays.length = 0;
    await media.play();
  }, src);
  expect(await page.evaluate(() => (window as unknown as SoundWindow).soundMedia!.paused)).toBe(false);
  await exportFinished(page, '1');
  await page.waitForTimeout(600);
  expect(await plays(page)).toEqual([]);
  await page.evaluate(() => {
    const w = window as unknown as SoundWindow;
    w.soundMedia!.pause();
    w.soundMedia!.remove();
  });
  await page.waitForTimeout(300);
  expect(await plays(page)).toEqual([]);
  await exportFinished(page, '1');
  await page.waitForTimeout(300);
  expect(await plays(page)).toEqual([]);
  await exportFinished(page, '3', 'failed');
  await page.waitForTimeout(300);
  expect(await plays(page)).toEqual([]);
  await exportFinished(page, '4');
  await expect.poll(() => names(page)).toEqual(['complete']);
  await expect.poll(async () => (await plays(page))[0]?.outcome).toBe('playing');
  expect(problems).toEqual([]);
});
