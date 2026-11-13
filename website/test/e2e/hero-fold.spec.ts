// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { RELEASE } from '../../src/content/release';
import { appWindow, h1Lines, reel, toggle, untilReady } from './hero-shared';

/**
 * The home page's first viewport as it is laid out (lane A, WEB2 fix batch): at 1440×900 the h1 in three lines 48 px
 * clear of the reel, the window beside it and the next section's heading in view; the reel's own chrome and strip;
 * Kaatu round the bezel; the window's four rows at 13 px; and on a phone the reel high in the first screen, the
 * download and GitHub buttons above it and the platform row below it. The signature interaction is hero.spec.ts's.
 */

/**
 * Once the pass is ready and the list is back at slot 1: four whole rows, every word 13 px or more, nothing cut short.
 * At 320 px the window is narrower than the 320 design px it lays out at (fit fluid), so it scales by 0.9: 11.7 px
 * words and 40 px thumbnails there.
 */
async function rowsRead(page: Page): Promise<void> {
  const wide = page.viewportSize()!.width >= 360;
  const [floor, thumbFloor] = wide ? [13, 44] : [11.5, 39];
  await untilReady(page);
  const list = appWindow(page).locator('[data-slot="slot-list"]');
  // Once every slot is filled the list goes back to slot 1 (a smooth scroll): measure once it is there.
  await expect.poll(() => list.evaluate((el) => el.scrollTop), { timeout: 4_000 }).toBe(0);
  const shown = await list.evaluate((el) => {
    const view = el.getBoundingClientRect();
    return [...el.querySelectorAll('[data-slot-row]')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= view.top - 1 && b.bottom <= view.bottom + 1;
    }).length;
  });
  expect(shown).toBe(4);
  const edge = await list.evaluate((el) => el.getBoundingClientRect().right);
  for (const row of (await list.locator('[data-slot-row]').all()).slice(0, 4)) {
    const rowBox = (await row.boundingBox())!;
    for (const part of await row.locator('[data-slot="slot-title"], [data-slot="slot-at"], [data-slot="slot-needs"], [data-slot="slot-beats"], [data-slot="ai-pick"], [data-confidence]').all()) {
      const [size, cut, right, top, bottom] = await part.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return [parseFloat(getComputedStyle(el).fontSize), el.scrollWidth > el.clientWidth + 1, b.right, b.top, b.bottom] as const;
      });
      expect(size).toBeGreaterThanOrEqual(floor);
      // Nothing cut short, nothing run past the list's edge or out of its row.
      expect(cut).toBe(false);
      expect(right).toBeLessThanOrEqual(edge);
      expect(top).toBeGreaterThanOrEqual(rowBox.y - 1);
      expect(bottom).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
    }
    const thumb = (await row.locator('[data-flight-to]').boundingBox())!;
    expect(Math.min(thumb.width, thumb.height)).toBeGreaterThanOrEqual(thumbFloor);
  }
}

test.describe('the first viewport', () => {
  test('at 1440×900: the h1 in three lines, 48 px clear of the reel, the window beside it, the next section starting in view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const h1 = page.locator('section[data-hero] h1');
    await expect(h1).toHaveText('Every reel you save becomes one you can make.');
    const font = await h1.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(font).toBeGreaterThanOrEqual(76);
    expect(font).toBeLessThanOrEqual(80);
    const lines = await h1Lines(page);
    expect(lines.count).toBe(3);
    const form = (await page.locator('section[data-hero] [data-slot="get-taalcut"]').boundingBox())!;
    const platforms = (await page.locator('section[data-hero]').getByRole('list', { name: 'Platforms' }).boundingBox())!;
    const frame = (await page.locator('[data-slot="hero-reel"] [data-slot="reel-frame"]').boundingBox())!;
    const win = (await appWindow(page).boundingBox())!;
    // Left to right: the words, at least 48 px of air, the reel, the window; all of them inside the first viewport.
    expect(frame.x - lines.right).toBeGreaterThanOrEqual(48);
    expect(Math.max(form.x + form.width, platforms.x + platforms.width)).toBeLessThanOrEqual(frame.x);
    expect(frame.x + frame.width).toBeLessThanOrEqual(win.x);
    for (const box of [form, platforms, frame, win]) expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(frame.height).toBeGreaterThan(480);
    expect(win.width).toBeGreaterThan(frame.width);
    // No empty band: the next section's heading and its window's title bar start above the fold.
    const next = page.locator('section[data-hero] + section');
    const heading = (await next.locator('h2').first().boundingBox())!;
    const bar = (await next.locator('[data-slot="app-window-bar"]').first().boundingBox())!;
    expect(heading.y).toBeLessThan(900);
    expect(bar.y + bar.height).toBeLessThan(900);
  });

  test('Download for Mac has the screen’s one marigold fill, GitHub sits beside it, and the platform row names each OS beside its icon', async ({ page }) => {
    await page.goto('/');
    const get = page.locator('section[data-hero] [data-slot="get-taalcut"]');
    const download = get.getByRole('link', { name: 'Download for Mac' });
    await expect(download).toHaveAttribute('href', RELEASE.download);
    await expect(get.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/satyajiit/taalcut');
    await expect(get).toContainText(`${RELEASE.name} · Free · Apple silicon, macOS 14 or later`);
    await expect(get.getByRole('link', { name: 'What it needs and what to expect' })).toHaveAttribute('href', '/download/');
    // One marigold fill in the first viewport: the download's.
    const fills = await page.locator('section[data-hero] a, section[data-hero] button').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    const marigold = await download.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fills.filter((c) => c === marigold)).toHaveLength(1);
    await expect(page.locator('section[data-hero] form, section[data-hero] input')).toHaveCount(0);
    const row = page.locator('section[data-hero]').getByRole('list', { name: 'Platforms' });
    await expect(row.getByRole('listitem')).toHaveText(['macOS Apple silicon', 'Ubuntu not yet', 'Windows after 1.0']);
    for (const id of ['apple', 'ubuntu', 'windows']) await expect(row.locator(`[data-slot="brand-icon"][data-brand="${id}"]`)).toBeVisible();
    await expect(page.locator('section[data-hero]')).toHaveAttribute('data-hero', '');
  });

  test('the reel: its 13-slot violet strip grouped Hook, Build, Peak, Build, Outro with its music beats, the tabs clear of it, Use template', async ({ page }) => {
    await page.goto('/');
    const onReel = page.locator('[data-slot="hero-reel"] [data-slot="template-bar"]');
    await expect(onReel.locator('[data-slot="segment"]')).toHaveCount(reel.slots.length);
    await expect(onReel.locator('[data-part]')).toHaveText(['Hook', 'Build', 'Peak', 'Build', 'Outro']);
    await expect(onReel.locator('[data-slot="beat-tick"]')).toHaveCount(reel.beats.length);
    await expect(onReel.getByRole('img')).toHaveAttribute('aria-label', /Template: 13 slots .*22 music beats/);
    // Every part's name is whole: never cut to "H…".
    for (const part of await onReel.locator('[data-part]').all()) {
      expect(await part.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    // Each slot is an opaque violet chip with its number on it (the number reads whatever the footage).
    for (const segment of await onReel.locator('[data-slot="segment"]').all()) {
      expect(await segment.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
    }
    // The Saved reel / Your version tabs sit below the strip's beat ticks, never on them.
    const ticks = await onReel.locator('[data-slot="beat-tick"]').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().bottom)));
    const tabs = (await page.getByRole('group', { name: 'Show on the reel' }).boundingBox())!;
    expect(tabs.y).toBeGreaterThanOrEqual(ticks);
    await expect(page.getByRole('button', { name: 'Use template' })).toBeVisible();
  });

  test('the reel wears Reels’ own chrome: a top scrim, the right rail, Original audio, all decoration', async ({ page }) => {
    await page.goto('/');
    const onReel = page.locator('[data-slot="hero-reel"]');
    await expect(onReel.locator('[data-slot="reel-scrim"]')).toHaveAttribute('aria-hidden', 'true');
    const rail = onReel.locator('[data-slot="reel-rail"]');
    await expect(rail).toHaveAttribute('aria-hidden', 'true');
    await expect(rail.locator('svg')).toHaveCount(4);
    const audio = onReel.locator('[data-slot="reel-audio"]');
    await expect(audio).toHaveAttribute('aria-hidden', 'true');
    await expect(audio).toContainText(`Original audio · ${reel.title}`);
    // The Pause stays a 24 px target or more, and nothing of the chrome sits on it.
    const control = (await onReel.locator('[data-slot="reel-control"]').boundingBox())!;
    expect(Math.min(control.width, control.height)).toBeGreaterThanOrEqual(24);
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-slot="reel-control"]') !== null, [control.x + control.width / 2, control.y + control.height / 2]);
    expect(hit).toBe(true);
  });

  test('Kaatu peeks round the reel’s left bezel, in front of it, 110 px or more', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const kaatu = page.locator('[data-slot="hero-reel"] [data-slot="kaatu"]');
    await expect(kaatu).toHaveAttribute('aria-hidden', 'true');
    await expect(kaatu).toHaveAttribute('data-pose', 'peek-left');
    const box = (await page.locator('[data-slot="hero-reel"] [data-slot="kaatu-poke"]').boundingBox())!;
    const frame = (await page.locator('[data-slot="hero-reel"] [data-slot="reel-frame"]').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(110);
    // Over the edge: part of it on the frame, part outside, and it is what the pointer meets there.
    expect(box.x).toBeLessThan(frame.x);
    expect(box.x + box.width).toBeGreaterThan(frame.x + 24);
    const front = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-slot="kaatu-poke"]') !== null, [frame.x + 8, box.y + box.height / 2]);
    expect(front).toBe(true);
  });

  test('the window is the app on its Make page, titled after the reel, the roll a line and four slot rows at a time', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(appWindow(page)).toHaveAttribute('aria-label', `A demonstration of the Taalcut app: ${reel.project ?? reel.title}`);
    await expect(appWindow(page).locator('[data-area="make"]')).toHaveAttribute('data-current', 'true');
    await expect(appWindow(page).getByText('Remix a reel')).toBeVisible();
    await expect(appWindow(page).locator('[data-slot="roll-line"]')).toContainText('Camera roll·1,284 clips');
    await expect(appWindow(page).locator('[data-slot="roll-grid"]')).toHaveCount(0);
    await rowsRead(page);
    const list = appWindow(page).locator('[data-slot="slot-list"]');
    // Every row is its own: its part, its music beats, its timecode and its line come from the reel's slots.
    const rows = await list.locator('[data-slot-row]').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(new Set(rows).size).toBe(reel.slots.length);
    await expect(list.locator('[data-slot-row]').first()).toContainText('Slot 1 · HookBeats 1–11');
    await expect(list.locator('[data-slot-row]').first().locator('[data-slot="slot-at"]')).toHaveText('0:00.0');
    const lines = await list.locator('[data-slot="slot-needs"]').allTextContents();
    expect(lines).toEqual(reel.slots.map((s) => s.needs));
  });
});

test.describe('on a phone, 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the reel’s strip and footage start by y = 520, with at least 40 % of the reel in the first screen; the buttons above it', async ({ page }) => {
    await page.goto('/');
    const frame = (await page.locator('[data-slot="hero-reel"] [data-slot="reel-frame"]').boundingBox())!;
    const strip = (await page.locator('[data-slot="hero-reel"] [data-slot="template-bar"]').boundingBox())!;
    const form = (await page.locator('section[data-hero] [data-slot="get-taalcut"]').boundingBox())!;
    expect(frame.y).toBeLessThanOrEqual(520);
    expect(strip.y).toBeLessThanOrEqual(532);
    expect((844 - frame.y) / frame.height).toBeGreaterThanOrEqual(0.4);
    expect(form.y + form.height).toBeLessThanOrEqual(frame.y);
    // The line under the h1 is two lines here.
    const lead = page.locator('section[data-hero] h1 + div p').first();
    const lines = await lead.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBe(2);
    // Kaatu shows in the first screen, round the reel's left edge.
    const kaatu = (await page.locator('[data-slot="hero-reel"] [data-slot="kaatu-poke"]').boundingBox())!;
    expect(kaatu.y + kaatu.height).toBeLessThanOrEqual(844);
    expect(kaatu.x).toBeLessThan(frame.x);
  });
});

for (const width of [390, 320]) {
  test.describe(`on a phone, ${width} px wide`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('one column: the h1, the buttons, the reel at about 78vw, the platforms, then the window; nothing sideways', async ({ page }) => {
      await page.goto('/');
      const order = [
        page.locator('section[data-hero] h1'),
        page.locator('section[data-hero] [data-slot="get-taalcut"]'),
        page.locator('[data-slot="hero-reel"] [data-slot="reel-frame"]'),
        page.locator('section[data-hero]').getByRole('list', { name: 'Platforms' }),
        appWindow(page),
      ];
      const boxes = await Promise.all(order.map(async (l) => (await l.boundingBox())!));
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y, `item ${i}`).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
      const frame = boxes[2]!;
      expect(frame.width).toBeGreaterThanOrEqual(width * 0.74);
      expect(frame.width).toBeLessThanOrEqual(width * 0.82);
      for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // The reel's words stay readable.
      expect(await toggle(page, 'Saved reel').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    });

    test('the window’s rows stay whole: four at a time, 13 px, nothing cut', async ({ page }) => {
      await page.goto('/');
      await appWindow(page).scrollIntoViewIfNeeded();
      await rowsRead(page);
    });
  });
}

for (const width of [1440, 390, 320]) {
  test(`the pass never moves the page under the hero, at ${width} px`, async ({ page }) => {
    // Every status the window shows mid-pass keeps the window's height: a line that wrapped once grew the window by
    // 4 px and moved every section under the hero while the visitor read them.
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const hero = page.locator('section[data-hero]');
    const heights = new Set<number>();
    for (let i = 0; i < 60; i++) {
      heights.add(Math.round((await hero.boundingBox())!.height));
      if (i > 10 && (await appWindow(page).locator('[data-slot="approve"]').getAttribute('aria-disabled')) !== 'true') break;
      await page.waitForTimeout(150);
    }
    expect([...heights]).toHaveLength(1);
  });
}
