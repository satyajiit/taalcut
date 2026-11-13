// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The indeterminate bar (`tc-global-loader-bar`: the global loader and every card's "working" track) sweeps a
// clipped third across its track. Its box spans the track and never moves, so it never makes the track wider than
// itself (which the pseudo-locale check reads as text that does not fit); and it still moves. Reduced motion: the
// whole track pulses instead, with no clip.
import { expect, test, type Locator } from '@playwright/test';
import { open, preferences } from './support.ts';

const KIT = { name: 'dev-kit', path: '/dev/kit' };

interface Sample {
  readonly x: string;
  readonly clip: string;
  readonly overflow: number;
  readonly offset: number;
}

/** The bar's state every 80 ms for one 1.2 s sweep: its clip, how far its track overflows, its box against the track's. */
async function sweep(bar: Locator): Promise<Sample[]> {
  return bar.evaluate(async (element) => {
    const samples: Sample[] = [];
    const track = element.parentElement;
    for (let i = 0; i < 15; i += 1) {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const trackBox = track?.getBoundingClientRect() ?? box;
      samples.push({
        x: style.getPropertyValue('--tc-loader-x'),
        clip: style.clipPath,
        overflow: track ? track.scrollWidth - track.clientWidth : 0,
        offset: Math.abs(box.left - trackBox.left) + Math.abs(box.width - trackBox.width),
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return samples;
  });
}

test('the bar sweeps inside its track: its box never moves or widens the track, and the clip moves', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, KIT);
  const bar = page.locator('.tc-global-loader-bar').first();
  await expect(bar).toBeVisible();
  const samples = await sweep(bar);
  expect(samples.map((s) => s.overflow).filter((overflow) => overflow > 1)).toEqual([]);
  expect(samples.map((s) => s.offset).filter((offset) => offset > 1)).toEqual([]);
  expect(new Set(samples.map((s) => s.clip)).size, 'the clip moves').toBeGreaterThan(5);
  expect(samples.every((s) => s.clip.startsWith('inset('))).toBe(true);
});

test('reduced motion: the whole track pulses, no clip', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, KIT);
  const bar = page.locator('.tc-global-loader-bar').first();
  await expect(bar).toBeVisible();
  const style = await bar.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { clip: computed.clipPath, animation: computed.animationName };
  });
  expect(style).toEqual({ clip: 'none', animation: 'tc-bone-pulse' });
});
