// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { SITE } from '../../src/content/site';

/**
 * The Product Hunt badge (components/ui/product-hunt-badge.tsx): in the home hero from 640 px and in every footer,
 * one link to the launch, its artwork served from this site. Nothing reaches Product Hunt until the visitor follows it.
 */

test.describe('the Product Hunt badge', () => {
  test('links the hero and the footer to the launch, and the page never calls Product Hunt', async ({ page }) => {
    const thirdParty: string[] = [];
    page.on('request', (r) => {
      if (/producthunt\.com/.test(new URL(r.url()).hostname)) thirdParty.push(r.url());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.locator('section[data-hero] [data-slot="product-hunt-badge"]');
    const footer = page.locator('footer [data-slot="product-hunt-badge"]');
    for (const badge of [hero, footer]) {
      await expect(badge).toHaveAttribute('href', SITE.productHunt.url);
      await expect(badge).toHaveAttribute('target', '_blank');
      await expect(badge).toHaveAccessibleName(SITE.productHunt.label);
      // One artwork per theme, and the one showing has loaded from this site.
      const img = badge.locator('img:visible');
      await expect(img).toHaveCount(1);
      expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      expect(new URL(await img.evaluate((el: HTMLImageElement) => el.currentSrc)).pathname).toMatch(/^\/badges\/product-hunt-(light|dark)\.svg$/);
    }
    // The hero's badge sits in the first viewport at 1440×900.
    const box = (await hero.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(thirdParty).toEqual([]);
  });

  test('leaves the hero to the reel on a phone and keeps the footer badge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('section[data-hero] [data-slot="product-hunt-badge"]')).toBeHidden();
    await expect(page.locator('footer [data-slot="product-hunt-badge"]')).toHaveCount(1);
  });
});
