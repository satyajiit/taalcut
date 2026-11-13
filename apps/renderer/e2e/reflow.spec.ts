// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-R2 reflow probe (WCAG 1.4.10): every route at 320 × 256 CSS px, the size a 1280 × 1024 window has at 400 %
// zoom. Records how far the page scrolls sideways and which elements stick out, without failing: the window's
// minimum is 960 × 600 and the timeline is two-dimensional content (an exception), so this is a report for the
// gate, not a gate. Runs only with TAALCUT_A11Y_REFLOW=1; lines go to $TAALCUT_A11Y_OUT/reflow.jsonl when set.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROUTES } from './routes.ts';
import { preferences } from './support.ts';

test.skip(process.env.TAALCUT_A11Y_REFLOW !== '1', 'a report, run with TAALCUT_A11Y_REFLOW=1');
test.use({ viewport: { width: 320, height: 256 } });

for (const route of ROUTES) {
  test(`${route.name}: reflow at 320 px`, async ({ page }, testInfo) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    // Not support.ts's open(): at this width the window bar's title can shrink to nothing, which is a finding.
    await page.goto(route.path);
    await expect(page.locator('h1').first()).toBeAttached();
    await expect(
      page.locator('[data-boneyard][aria-busy="true"], [data-slot=global-loader], [data-slot="loading"]'),
    ).toHaveCount(0);
    const found = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const title = document.querySelector('h1')?.getBoundingClientRect();
      const titleWidth = Math.round(title?.width ?? 0);
      // Inside something that scrolls sideways on its own (a strip, the timeline), sticking out is by design;
      // anywhere else it is cut off or scrolls the page.
      const scrolls = (element: Element) => {
        for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
          const { overflowX } = getComputedStyle(node);
          if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
        return false;
      };
      const out: string[] = [];
      for (const element of document.body.querySelectorAll('*')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= width + 1 || scrolls(element)) continue;
        // Only the outermost: a child of something already listed adds nothing.
        if (
          out.length > 0 &&
          [...document.querySelectorAll('[data-r2-reflow]')].some((o) => o.contains(element))
        )
          continue;
        element.setAttribute('data-r2-reflow', '');
        const slot = element.getAttribute('data-slot');
        out.push(
          `${element.tagName.toLowerCase()}${slot ? `[data-slot=${slot}]` : ''} right ${Math.round(box.right)} px`,
        );
      }
      return { scrollWidth: document.documentElement.scrollWidth, width, titleWidth, out: out.slice(0, 8) };
    });
    const line = { route: route.path, ...found };
    await testInfo.attach('reflow', { body: JSON.stringify(line, null, 2), contentType: 'application/json' });
    const dir = process.env.TAALCUT_A11Y_OUT;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'reflow.jsonl'), `${JSON.stringify(line)}\n`);
    }
  });
}
