// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-R2 reduced motion (apps/renderer/SPEC.md, "P3-R2: accessibility pass targets"; DESIGN.md "Motion"): with
// prefers-reduced-motion: reduce emulated, opening any route runs no finite animation or transition that moves,
// scales or turns something (transform, translate, scale, rotate), whether CSS, the Web Animations API or a
// script writing `style.transform` frame after frame. Fades are fine; loaders (infinite) keep going.
import { expect, test } from '@playwright/test';
import { ROUTES } from './routes.ts';
import { open, preferences } from './support.ts';

/** Collected in the page from its first script on: every moving animation seen, one line each. */
declare global {
  interface Window {
    __motionSeen?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const seen = new Set<string>();
    window.__motionSeen = [];
    const MOVING = ['transform', 'translate', 'scale', 'rotate'];
    const describe = (target: Element | null) => {
      if (!target) return '(none)';
      const slot = target.getAttribute('data-slot');
      const cls = (target.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
      return `${target.tagName.toLowerCase()}${slot ? `[data-slot=${slot}]` : ''}${cls ? `.${cls}` : ''}`;
    };
    const note = (line: string) => {
      if (seen.has(line)) return;
      seen.add(line);
      window.__motionSeen?.push(line);
    };
    // A moving property whose value differs between keyframes (an absent one counts as a value), or that a
    // lone keyframe sets (the other end is the element's own value).
    const moves = (keyframes: ComputedKeyframe[]) =>
      MOVING.some((property) => {
        if (!keyframes.some((frame) => property in frame)) return false;
        if (keyframes.length === 1) return true;
        return new Set(keyframes.map((frame) => String(frame[property] ?? '∅'))).size > 1;
      });
    const sample = () => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || animation.playState !== 'running') continue;
        const timing = effect.getComputedTiming();
        if (timing.iterations === Infinity) continue;
        const duration = typeof timing.duration === 'number' ? timing.duration : 0;
        if (duration <= 0) continue;
        if (!moves(effect.getKeyframes())) continue;
        const name =
          animation instanceof CSSAnimation
            ? `css animation ${animation.animationName}`
            : animation instanceof CSSTransition
              ? `css transition ${animation.transitionProperty}`
              : 'web animation';
        note(`${name} (${Math.round(duration)} ms) on ${describe(effect.target)}`);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    // A script that moves something writes style.transform on each frame: three or more changes is motion.
    const writes = new Map<Element, { count: number; last: string }>();
    new MutationObserver((records) => {
      for (const record of records) {
        if (!(record.target instanceof HTMLElement || record.target instanceof SVGElement)) continue;
        // A progress bar's fill follows the work done: content, not motion.
        if (record.target.closest('[role=progressbar]')) continue;
        const now = record.target.style.transform;
        const known = writes.get(record.target) ?? { count: 0, last: '' };
        if (now === known.last) continue;
        writes.set(record.target, { count: known.count + 1, last: now });
        if (known.count + 1 >= 3)
          note(`style.transform written frame by frame on ${describe(record.target)}`);
      }
    }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true });
  });
});

for (const route of ROUTES) {
  test(`${route.name}: nothing moves on opening`, async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, route);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    // Arrivals and staggered lists finish well within this.
    await page.waitForTimeout(1200);
    const seen = await page.evaluate(() => window.__motionSeen ?? []);
    expect(seen, `${route.path}: motion under reduced motion`).toEqual([]);
  });
}
