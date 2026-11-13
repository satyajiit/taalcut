// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { FILM_SECTION } from '../../src/content/home';

test.describe('the launch film', () => {
  test('loads nothing from YouTube until the press, then frames the privacy-enhanced player', async ({ page }) => {
    const youtube: string[] = [];
    // the test never reaches YouTube: every request to it is counted and refused
    await page.route(/youtube/, (route) => {
      youtube.push(route.request().url());
      return route.abort();
    });
    await page.goto('/');
    const section = page.locator(`section#${FILM_SECTION.id}`);
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('img')).toHaveCount(0);
    await expect(section.locator('iframe')).toHaveCount(0);
    expect(youtube).toEqual([]);
    await section.getByRole('button', { name: new RegExp(FILM_SECTION.play) }).click();
    await expect(section.locator('iframe')).toHaveAttribute('src', new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${FILM_SECTION.youtubeId}\\?`));
    await expect(section.getByRole('link', { name: FILM_SECTION.watch })).toHaveAttribute('href', `https://www.youtube.com/watch?v=${FILM_SECTION.youtubeId}`);
  });
});
