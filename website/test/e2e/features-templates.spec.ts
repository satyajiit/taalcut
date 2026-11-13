// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';

/**
 * Reels become templates (/features/templates/): the saved reel, its template and your version; the camera rolls that
 * fill it, by keyboard, pointer and touch; the slots' words at every width; reduced motion; and the starters' shelf.
 * The page's server HTML and its place among the features are in features.spec.ts.
 */

const showcase = (page: Page, slug: string) => page.locator(`[data-showcase="${slug}"]`);

test.describe('by keyboard', () => {
  test('templates: the same template fills again from another roll, and waits for the next', async ({
    page,
  }) => {
    await page.goto('/features/templates/');
    const plate = showcase(page, 'templates');
    const version = plate.locator('[data-slot="version-frame"]');
    await plate.getByRole('radio', { name: 'Vietnam trip' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('radio', { name: 'A flight out' })).toHaveAttribute('aria-checked', 'true');
    await expect(plate.locator('[data-filled]')).toHaveCount(9, { timeout: 6_000 });
    await expect(plate.getByRole('status')).toHaveText(
      'A flight out: its own 9 clips, so it plays as the reel.',
    );
    await expect(plate.locator('[data-filled] [data-frame="footage"]')).toHaveCount(9);
    await expect(plate.locator('[data-confidence], [data-slot="confidence"]')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('radio', { name: 'Vietnam, on repeat' })).toHaveAttribute('aria-checked', 'true');
    await expect(plate.locator('[data-filled]')).toHaveCount(9, { timeout: 6_000 });
    await expect(plate.getByRole('status')).toHaveText('Vietnam, on repeat: 9 slots filled, 2 picks less sure.');
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('radio', { name: 'Your next trip' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(plate.locator('[data-filled]')).toHaveCount(0);
    await expect(version).toHaveAttribute('data-state', 'waiting');
    await expect(plate).toContainText('Waiting for your clips');
    await page.keyboard.press('ArrowRight');
    await expect(plate.getByRole('radio', { name: 'Vietnam trip' })).toHaveAttribute('aria-checked', 'true');
    await expect(plate.locator('[data-filled]')).toHaveCount(9, { timeout: 6_000 });
    await expect(plate.locator('[data-slot="confidence"][data-level="medium"]')).toHaveCount(2);
    await expect(plate.getByRole('status')).toHaveText('Vietnam trip: 9 slots filled, 2 picks less sure.');
    await expect(version).not.toHaveAttribute('data-state', 'waiting');
    // Your version has its own Pause and Play.
    await expect(plate.getByRole('button', { name: /^(Pause|Play) your version$/ })).toBeVisible();

    const shelf = showcase(page, 'templates-starters');
    await expect(shelf.locator('[data-starter]')).toHaveCount(8);
    await shelf.getByRole('radio', { name: 'English' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(shelf.getByRole('radio', { name: 'Hindi' })).toHaveAttribute('aria-checked', 'true');
    await expect(shelf.locator('[data-starter]')).toHaveCount(8);
    await expect(shelf).toContainText('Festival vlog');
    await expect(shelf).not.toContainText('Podcast moment');
  });
});

test.describe('the template’s slots', () => {
  for (const width of [1440, 1024, 390]) {
    test(`at ${width} px, no slot or highlight cuts its words, and every need fits its slot`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/features/templates/', '/features/']) {
        await page.goto(path);
        const plate = page.locator('[data-showcase="templates"], [data-showcase="templates-fragment"]');
        for (const trip of ['A flight out', 'Vietnam, on repeat', 'Vietnam trip']) {
          await plate.getByRole('radio', { name: trip }).click();
          await expect(plate.locator('[data-filled]')).toHaveCount(9, { timeout: 6_000 });
          const cut = await plate
            .locator('[data-slot="template-frame"] *, [role="radiogroup"] *')
            .evaluateAll((els) =>
              els
                .filter((el) => {
                  const style = getComputedStyle(el);
                  const clamped = style.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
                  const truncated = style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
                  return clamped || truncated;
                })
                .map((el) => el.textContent),
            );
          expect(cut, `${path} ${trip}`).toEqual([]);
          // Each slot's words stay inside the slot's own box.
          const spill = await plate.locator('[data-slot-n]').evaluateAll((els) =>
            els.flatMap((el) => {
              const box = el.getBoundingClientRect();
              const words = [...el.querySelectorAll('span')].filter(
                (s) => s.children.length === 0 && s.textContent && !s.closest('.sr-only'),
              );
              return words.some((w) => {
                const b = w.getBoundingClientRect();
                return (
                  b.width > 0 && (b.top < box.top - 1 || b.bottom > box.bottom + 1 || b.right > box.right + 1)
                );
              })
                ? [el.textContent]
                : [];
            }),
          );
          expect(spill, `${path} ${trip}`).toEqual([]);
        }
      }
    });
  }
});

test.describe('the templates showcase by touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a roll tapped fills the template in view, then brings your version into view', async ({ page }) => {
    await page.goto('/features/templates/');
    const plate = showcase(page, 'templates');
    await plate.getByRole('radio', { name: 'A flight out' }).tap();
    await expect(plate.locator('[data-filled]')).toHaveCount(9, { timeout: 6_000 });
    const version = plate.locator('[data-slot="version-frame"]');
    await expect
      .poll(async () => {
        const box = await version.boundingBox();
        return box ? box.x >= -1 && box.x + box.width <= 391 : false;
      })
      .toBe(true);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the template rests filled, a roll fills it at once with nothing flying, and nothing plays', async ({
    page,
  }) => {
    await page.goto('/features/templates/');
    const plate = showcase(page, 'templates');
    await expect(plate.locator('[data-filled]')).toHaveCount(9);
    await expect(plate.locator('[data-slot="version-frame"]')).toHaveAttribute('data-state', 'rest');
    await plate.getByRole('radio', { name: 'A flight out' }).click();
    await expect(plate.locator('[data-filled]')).toHaveCount(9);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    await expect(plate.getByRole('status')).toHaveText(
      'A flight out: its own 9 clips, so it plays as the reel.',
    );
    await expect(plate.locator('[data-slot="version-frame"]')).toHaveAttribute('data-state', 'rest');
    await expect(plate.getByRole('button', { name: 'Play your version' })).toBeVisible();
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the template is filled from the Vietnam trip, your version at rest, the starters on their shelf', async ({
    page,
  }) => {
    await page.goto('/features/templates/');
    const plate = showcase(page, 'templates');
    await expect(plate.locator('[data-filled]')).toHaveCount(9);
    await expect(plate.locator('[data-slot="confidence"][data-level="medium"]')).toHaveCount(2);
    await expect(plate.getByRole('radio', { name: 'Vietnam trip' })).toHaveAttribute('aria-checked', 'true');
    await expect(showcase(page, 'templates-starters').locator('[data-starter]')).toHaveCount(8);
  });
});
