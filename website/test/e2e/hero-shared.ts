// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, type Page } from '@playwright/test';
import { DEFAULT_REEL_ID, reelById } from '../../src/content/reels';

/** What the hero's specs share (hero.spec.ts, hero-fold.spec.ts): the default reel and the stage's parts. */
export const reel = reelById(DEFAULT_REEL_ID);
export const stage = (page: Page) => page.locator('[data-stage]');
/** The hero's own window: the home has an app window in most sections now, so look only inside the hero. */
export const appWindow = (page: Page) => page.locator('section[data-hero]').getByRole('group', { name: /^A demonstration of the Taalcut app/ });
export const approve = (page: Page) => appWindow(page).locator('[data-slot="approve"]');
export const toggle = (page: Page, name: 'Saved reel' | 'Your version') =>
  page.getByRole('group', { name: 'Show on the reel' }).getByRole('button', { name, exact: true });

export async function untilReady(page: Page): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-phase', 'ready', { timeout: 15_000 });
}

/** The h1's lines: one per distinct line top of its text, and where its longest line ends. */
export async function h1Lines(page: Page) {
  return page.locator('section[data-hero] h1').evaluate((h1) => {
    // The text's own boxes (a range over the h1 would add each span's box too).
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter((r) => r.width > 1));
    }
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
    return { count: tops.length, right: Math.max(...rects.map((r) => r.right)) };
  });
}
