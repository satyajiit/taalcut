// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import { PROVIDERS } from '../../src/content/providers';
import { openInTheme } from './helpers';

/** The header mark's four arcs, as drawn now: each arc group's transform and opacity inside the element's shadow. */
function arcs(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const el = document.querySelector('taalcut-mark');
    const groups = el?.shadowRoot?.querySelectorAll('svg > g');
    if (!groups || groups.length === 0) return null;
    return [...groups].map((g) => `${g.getAttribute('transform') ?? ''}|${Number(g.getAttribute('opacity') ?? 1)}`);
  });
}

test.describe('the header mark', () => {
  test('shows the drawn lockup without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/features/');
    const home = page.getByRole('link', { name: 'Taalcut home' });
    await expect(home.locator('img[alt="Taalcut"]:visible')).toHaveCount(1);
    const box = await home.locator('img[alt="Taalcut"]:visible').boundingBox();
    expect(box?.width).toBeGreaterThan(60);
    await context.close();
  });

  test('becomes the moving mark with JavaScript, counting in once a session', async ({ page }) => {
    await page.goto('/features/');
    await page.waitForFunction(() => customElements.get('taalcut-mark') !== undefined);
    await expect.poll(() => arcs(page)).not.toBeNull();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('taalcut.countedIn'))).toBe('1');
    // The count-in ends at rest: every arc home and whole.
    await expect.poll(() => arcs(page), { timeout: 4000 }).toEqual(['|1', '|1', '|1', '|1', '|1']);
  });
});

test.describe('the theme toggle', () => {
  test('plays nightfall into dark and daybreak back, and keeps the choice', async ({ page }) => {
    await page.goto('/features/');
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => {
        const value = document.documentElement.getAttribute('data-theme-transition');
        if (value) seen.push(value);
        if (document.querySelector('[data-theme-scene]')) seen.push('scene');
      }).observe(document.documentElement, { attributes: true, subtree: true, childList: true });
    });
    const seen = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen);

    await page.getByRole('button', { name: 'Switch to dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(seen).toEqual(expect.arrayContaining(['nightfall', 'scene']));
    // The scene ends: the attribute and the bodies are gone, in the new theme.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', /.+/, { timeout: 3000 });
    await expect(page.locator('[data-theme-scene]')).toHaveCount(0);
    const toggle = page.getByRole('button', { name: 'Switch to light' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('taalcut.theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', /.+/, { timeout: 3000 });
    await expect(page.getByRole('button', { name: 'Switch to dark' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('works from the keyboard', async ({ page }) => {
    await page.goto('/features/');
    await page.getByRole('button', { name: 'Switch to dark' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('Kaatu', () => {
  test('decoration acts its pose, then holds it, and is never focusable', async ({ page }) => {
    // The about page's first Kaatu is its head art's: decoration that follows the pointer (WEB2), not a control.
    await page.goto('/about/');
    const kaatu = page.locator('[data-slot="kaatu"]').first();
    await kaatu.scrollIntoViewIfNeeded();
    await expect(kaatu).toHaveAttribute('aria-hidden', 'true');
    const pose = await kaatu.getAttribute('data-pose');
    expect(pose).toBeTruthy();
    // Its act plays once it is on screen, then it holds the pose's own frame.
    await expect(kaatu).toHaveAttribute('data-running', '');
    await expect(kaatu).toHaveAttribute('data-frame', pose!, { timeout: 6000 });
    const focusable = await kaatu.evaluate((el) => {
      const inside = el.querySelectorAll('a, button, input, select, textarea, [tabindex], [contenteditable]');
      (el as HTMLElement).focus();
      return {
        inside: inside.length,
        tabindex: el.getAttribute('tabindex'),
        focused: document.activeElement === el,
        button: el.closest('button') !== null,
      };
    });
    expect(focusable).toEqual({ inside: 0, tabindex: null, focused: false, button: false });
  });

  test('a Kaatu you can poke is a named button, never inside a hidden subtree', async ({ page }) => {
    for (const path of ['/', '/about/', '/ai/', '/faq/', '/press/', '/contact/', '/download/']) {
      await page.goto(path);
      const pokes = await page.locator('[data-slot="kaatu-poke"]').evaluateAll((els) =>
        els.map((el) => ({ tag: el.tagName, name: el.getAttribute('aria-label'), hidden: el.closest('[aria-hidden="true"]') !== null })),
      );
      // The footer's Kaatu is on every page.
      expect(pokes.length, path).toBeGreaterThan(0);
      for (const poke of pokes) expect(poke, path).toEqual({ tag: 'BUTTON', name: 'Kaatu, Taalcut’s beaver: poke', hidden: false });
    }
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('holds the mark and Kaatu still', async ({ page }) => {
    await page.goto('/about/');
    await page.waitForFunction(() => customElements.get('taalcut-mark') !== undefined);
    const kaatu = page.locator('[data-slot="kaatu"]').first();
    await kaatu.scrollIntoViewIfNeeded();
    const pose = await kaatu.getAttribute('data-pose');
    const before = { arcs: await arcs(page), frame: await kaatu.getAttribute('data-frame') };
    await page.waitForTimeout(1500);
    // A pointer beside the following Kaatu, then on the mark: neither moves.
    const box = (await kaatu.boundingBox())!;
    await page.mouse.move(box.x + box.width + 160, box.y + box.height / 2, { steps: 4 });
    await page.getByRole('link', { name: 'Taalcut home' }).hover();
    await page.waitForTimeout(300);
    const after = { arcs: await arcs(page), frame: await kaatu.getAttribute('data-frame') };
    expect(after).toEqual(before);
    expect(before.arcs).toEqual(['|1', '|1', '|1', '|1', '|1']);
    // The pose's still frame, with no act played.
    expect(pose).toBeTruthy();
    expect(before.frame).toBe(pose);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    expect(running).toBe(0);
  });
});

/** Every BrandMark on the page: its words, font size, box height, line count, and any drawing inside it. */
function brandMarks(page: Page) {
  return page.locator('[data-slot="brand-mark"]').evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      const drawn = [...el.querySelectorAll('svg, img')].map((d) => d.getBoundingClientRect().height);
      return {
        name: el.textContent ?? '',
        row: el.closest('ul, dd')?.id || el.closest('ul, dd')?.textContent?.slice(0, 40) || '',
        font: parseFloat(style.fontSize),
        height: el.getBoundingClientRect().height,
        lines: el.getClientRects().length,
        drawn,
      };
    }),
  );
}

test.describe('other companies’ names and marks', () => {
  const named = PROVIDERS.filter((p) => p.way !== 'on-device');

  for (const width of [1440, 1024, 390]) {
    test(`/ai/ and home name every provider in words, one size per row, on one line, at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, providers] of [
        ['/ai/', named.filter((p) => p.way !== 'subscription')],
        ['/', named],
      ] as const) {
        await openInTheme(page, path, 'light');
        const marks = await brandMarks(page);
        for (const p of providers) expect(marks.map((m) => m.name), `${path} ${p.name}`).toContain(p.name);
        const rows = new Map<string, typeof marks>();
        for (const m of marks) rows.set(m.row, [...(rows.get(m.row) ?? []), m]);
        for (const [row, inRow] of rows) {
          // The same type size and the same height for every name in a row; no drawing taller than 1em.
          expect(new Set(inRow.map((m) => m.font)).size, `${path} ${row}`).toBe(1);
          const heights = inRow.map((m) => m.height);
          expect(Math.max(...heights) - Math.min(...heights), `${path} ${row}`).toBeLessThanOrEqual(1);
          for (const m of inRow) {
            expect(m.lines, `${path} ${m.name}`).toBe(1);
            for (const h of m.drawn) expect(h, `${path} ${m.name}`).toBeLessThanOrEqual(m.font);
          }
        }
      }
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`every brand icon is named or sits beside its name in words, and shows the ${theme} drawing (${theme})`, async ({ page }) => {
      for (const path of ['/', '/ai/', '/contact/', '/download/', '/about/', '/press/', '/waitlist/', '/features/reel-breakdown/']) {
        await openInTheme(page, path, theme);
        const icons = await page.locator('[data-slot="brand-icon"]').evaluateAll((els) =>
          els
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => {
              const shown = [...el.children].filter((c) => getComputedStyle(c).display !== 'none');
              return {
                brand: (el as HTMLElement).dataset.brand ?? '',
                named: el.getAttribute('role') === 'img' && (el.getAttribute('aria-label') ?? '').trim().length > 0,
                hidden: el.getAttribute('aria-hidden') === 'true',
                beside: (el.parentElement?.closest('[data-slot="brand-mark"], [data-slot="icon-text"], a, li')?.textContent ?? '').trim().length > 0,
                themeAware: el.hasAttribute('data-theme-aware'),
                shown: shown.map((c) => c.getAttribute('data-variant')),
              };
            }),
        );
        // The footer's platform row and accounts are on every page.
        expect(icons.map((i) => i.brand), path).toEqual(expect.arrayContaining(['apple', 'ubuntu', 'windows', 'instagram', 'github']));
        for (const i of icons) {
          expect(i.named || (i.hidden && i.beside), `${path} ${i.brand}`).toBe(true);
          expect(i.shown.length, `${path} ${i.brand}`).toBe(1);
          if (i.themeAware) expect(i.shown[0], `${path} ${i.brand}`).toBe(theme);
        }
      }
    });
  }

  test('Instagram on /contact/ is its icon beside its name, no taller than the words', async ({ page }) => {
    await openInTheme(page, '/contact/', 'light');
    const mark = page.locator('main [data-slot="brand-mark"][data-mark="instagram"]');
    await expect(mark).toHaveText('Instagram');
    const m = await mark.evaluate((el) => ({
      font: parseFloat(getComputedStyle(el).fontSize),
      icon: el.querySelector('[data-slot="brand-icon"]')?.getBoundingClientRect().height ?? 0,
      lines: el.getClientRects().length,
    }));
    expect(m.icon).toBeGreaterThan(0);
    expect(m.icon).toBeLessThanOrEqual(m.font + 0.5);
    expect(m.lines).toBe(1);
  });
});
