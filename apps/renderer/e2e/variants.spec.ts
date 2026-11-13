// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-V3 and P3-V16 "Done when": the variants of one request side by side, in the editor (`?compare=<castId>`) and
// as the chat's card, each labelled with what differs in words; Play the hooks plays every preview from one clock
// and one Stop stops them all; Export all sends one render.exportBatch with every video; reduced motion shows
// posters and plays nothing; the keyboard reaches everything; axe is clean in light and dark; en-XA shows no
// English. Against the Make fakes: Golden hour market, three videos cut from one cast.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { axeFor } from './axe.ts';
import { backend } from './backend-driver.ts';
import { open, preferences, watchProblems } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, fakeState } from './ui2b-support.ts';

const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA';
const CAST = '01K7C5M6Q8R9S0T1V2W3X4Y5ZE';
const TIMELINES = ['01K7C5M6Q8R9S0T1V2W3X4Y5ZB', '01K7C5M6Q8N000000000000002', '01K7C5M6Q8N000000000000003'];
const COMPARE = { name: 'compare', path: `/projects/${PROJECT}/timeline?compare=${CAST}` };
const EDITOR = { name: 'editor', path: `/projects/${PROJECT}/timeline` };
const KIT = { name: 'dev-kit', path: '/dev/kit' };

const view = (page: Page) => page.locator('[data-slot=compare-view]');
const tiles = (page: Page) => view(page).locator('[data-slot=variant-tile]');
const attribute = (page: Page, name: string) =>
  tiles(page).evaluateAll((els, key) => els.map((el) => el.getAttribute(key)), name);
const fixture = (page: Page, name: string) => page.locator(`[data-fixture="${name}"]`);

/** Axe on this area's cards in /dev/kit only (the kit shows every area's cards; theirs are checked by their specs). */
async function expectCardsAccessible(page: Page, testInfo: TestInfo, label: string) {
  const builder = axeFor(page)
    .include('[data-fixture^="variantsCompare"]')
    .include('[data-fixture^="renderBatch"]');
  await expectAccessible(page, testInfo, label, builder);
}

test.beforeEach(async ({ page }) => {
  await fakes(page, { onboarding: 'done', speed: 0, latencyMs: 0 });
});

test.describe('variants compare (P3-V3)', () => {
  test('labels every video and says what differs, with the AI mark and its length', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, COMPARE);
    await expect(page.getByRole('heading', { name: 'Compare side by side' })).toBeVisible();
    await expect(tiles(page)).toHaveCount(3);
    expect(await attribute(page, 'data-timeline')).toEqual(TIMELINES);
    await expect(tiles(page).nth(0)).toContainText('Original');
    await expect(tiles(page).nth(0)).toContainText('The video these were made from');
    for (const [index, label] of [
      [1, 'Variant 1'],
      [2, 'Variant 2'],
    ] as const) {
      const tile = tiles(page).nth(index);
      await expect(tile).toContainText(label);
      await expect(tile.getByRole('img', { name: 'Made by the AI' })).toBeVisible();
      await expect(tile).toContainText(/different shots|New hook/);
      await expect(tile).toContainText(/\d+s/);
    }
    await expect(tiles(page).nth(0).getByRole('img', { name: 'Made by the AI' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('Play the hooks plays every preview from one clock, loops them together, and one Stop stops all', async ({
    page,
  }) => {
    await open(page, COMPARE);
    await expect(tiles(page)).toHaveCount(3);
    expect(await attribute(page, 'data-playing')).toEqual(['false', 'false', 'false']);
    await page.getByRole('button', { name: 'Play the hooks' }).click();
    expect(await attribute(page, 'data-playing')).toEqual(['true', 'true', 'true']);
    const [first] = await attribute(page, 'data-epoch');
    expect(new Set(await attribute(page, 'data-epoch')).size).toBe(1);
    await expect(page.getByText('The first 3s of each, again and again')).toBeVisible();
    // Three seconds on, every preview starts again at the same moment.
    await expect
      .poll(async () => attribute(page, 'data-epoch'), { timeout: 5000 })
      .toEqual(Array(3).fill(String(Number(first) + 1)));
    await page.getByRole('button', { name: 'Stop' }).click();
    expect(await attribute(page, 'data-playing')).toEqual(['false', 'false', 'false']);

    await page.getByRole('button', { name: 'Play all' }).click();
    expect(await attribute(page, 'data-playing')).toEqual(['true', 'false', 'false']);
    await expect(page.getByText('Original, 1 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    expect(await attribute(page, 'data-playing')).toEqual(['false', 'false', 'false']);
  });

  test('Export all sends one render.exportBatch with every video; the tiles follow their renders', async ({
    page,
  }) => {
    await open(page, COMPARE);
    await page.getByRole('button', { name: 'Export all' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Exporting 3 videos. Find them in Exports.' }),
    ).toBeVisible();
    const sent = (await backend.dispatched(page)).filter((d) => d.name === 'render.exportBatch');
    expect(sent).toEqual([{ name: 'render.exportBatch', source: 'ui' }]);
    const requests = await fakeState<{ items: { timelineId: string }[]; mode: string }[]>(
      page,
      'make.p3.batch.requests',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.mode).toBe('export');
    expect(requests[0]!.items.map((item) => item.timelineId)).toEqual(TIMELINES);
    // Each tile shows its newest render: the batch's, waiting or rendering.
    for (const index of [0, 1, 2])
      await expect(tiles(page).nth(index).locator('[data-slot=variant-render]')).toBeVisible();
  });

  test('from the video switcher, and back to the editor', async ({ page }) => {
    await open(page, EDITOR);
    await page.getByRole('button', { name: 'Video 1 of 3' }).click();
    await page.getByRole('menuitem', { name: 'Compare side by side' }).click();
    await expect(page).toHaveURL(new RegExp(`compare=${CAST}`));
    await expect(tiles(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Back to the editor' }).click();
    await expect(page).not.toHaveURL(/compare=/);
    await expect(view(page)).toHaveCount(0);
  });

  test('from the keyboard: Back, the transport, Export all, then each tile’s Open and Export', async ({
    page,
  }) => {
    await open(page, COMPARE);
    const back = page.getByRole('button', { name: 'Back to the editor' });
    await back.focus();
    await page.keyboard.press('Tab');
    const hooks = page.getByRole('button', { name: 'Play the hooks' });
    await expect(hooks).toBeFocused();
    await page.keyboard.press('Enter');
    // The button that started playback is the Stop, so focus stays put.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();
    expect(await attribute(page, 'data-playing')).toEqual(['true', 'true', 'true']);
    await page.keyboard.press('Space');
    expect(await attribute(page, 'data-playing')).toEqual(['false', 'false', 'false']);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Play all' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Export all' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Open Original in the editor' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Export Original' })).toBeFocused();
  });

  test('under reduced motion: posters only, nothing plays', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, COMPARE);
    await expect(tiles(page)).toHaveCount(3);
    await expect(view(page).locator('[data-slot=shot-thumb]')).toHaveCount(3);
    await expect(view(page).locator('[data-slot=preview-player]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Play the hooks' })).toHaveCount(0);
    await expect(page.getByText('Posters only while reduced motion is on.')).toBeVisible();
    expect(await attribute(page, 'data-playing')).toEqual(['false', 'false', 'false']);
  });

  for (const theme of ['light', 'dark'] as const)
    test(`axe is clean in the compare view and on the cards (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, COMPARE);
      await expect(tiles(page)).toHaveCount(3);
      await expectAccessible(page, testInfo, `compare view (${theme})`);
      await page.getByRole('button', { name: 'Play the hooks' }).click();
      await expectAccessible(page, testInfo, `compare view, playing (${theme})`);

      await open(page, KIT);
      for (const state of ['making', 'ready', 'short', 'deleted', 'changed'])
        await expect(
          fixture(page, `variantsCompare · ${state}`).locator('[data-card-type=variantsCompare]'),
        ).toBeVisible();
      for (const state of ['waiting', 'running', 'attention', 'stopped', 'done'])
        await expect(
          fixture(page, `renderBatch · ${state}`).locator('[data-card-type=renderBatch]'),
        ).toBeVisible();
      await fixture(page, 'variantsCompare · ready').scrollIntoViewIfNeeded();
      await expectCardsAccessible(page, testInfo, `variants and batch cards (${theme})`);
    });

  test('the chat card says what differs, deleted and changed in place, and opens the compare view', async ({
    page,
  }) => {
    await open(page, KIT);
    const ready = fixture(page, 'variantsCompare · ready');
    await expect(ready.locator('[data-slot=variant-tile]')).toHaveCount(3);
    await expect(ready).toContainText('New hook · Bold captions');
    await expect(ready).toContainText('40% different shots');
    await expect(fixture(page, 'variantsCompare · short')).toContainText(
      'Made 2 of 4: your library ran out of different hooks',
    );
    await expect(fixture(page, 'variantsCompare · deleted').locator('[data-state=deleted]')).toContainText(
      'This video was deleted.',
    );
    await expect(
      fixture(page, 'variantsCompare · changed').getByText('You changed this').first(),
    ).toBeVisible();
    await expect(fixture(page, 'variantsCompare · making').locator('[data-state=making]')).toHaveCount(2);
    await ready.getByRole('button', { name: 'Compare side by side' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT}/timeline.*compare=${CAST}`));
    await expect(tiles(page)).toHaveCount(3);
  });

  test('en-XA: nothing English, nothing clipped', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    // The app's usual window, sidebar open: the compare view's own words are what this checks (the window bar at
    // 1024 px is main's GitHub links' and the editor's to share; pseudo-locale.spec checks every route there).
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, COMPARE);
    await expect(tiles(page)).toHaveCount(3);
    await page.locator('[data-slot=play-hooks]').click();
    await expectPseudoClean(page, 'compare view');
  });
});
