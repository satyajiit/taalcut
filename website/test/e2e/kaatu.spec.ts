// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { KAATU_POSES } from '../../src/components/kaatu/kaatu-poses';
import { KaatuFixture } from './fixtures/kaatu';

/**
 * Kaatu, live (WEB2 lane L5): test/e2e/fixtures/kaatu.tsx rendered to HTML here, then hydrated in the browser by a
 * bundle of fixtures/kaatu-client.tsx, at an address the site doesn't have on its origin, with the built site's
 * stylesheets and the real atlases from out/kaatu/. The bundle is made in memory with esbuild, which the site has
 * through vitest (vite's own bundler); nothing is written. KAATU_CAPTURE=1 also writes review screenshots to
 * .impeccable/review/kaatu/.
 */
const SITE = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = '/__fixtures/kaatu/';
const SCRIPT = '/__fixtures/kaatu/client.js';
const POKE = 'Kaatu, Taalcut’s beaver: poke';
const built = readFileSync(`${SITE}out/index.html`, 'utf8');
const htmlClass = /<html[^>]*class="([^"]*)"/.exec(built)?.[1] ?? '';
const styles = [...built.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join('\n');
const serverHtml = renderToString(createElement(KaatuFixture));

/** The little of esbuild's API this spec uses (the site has no types for it). */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { text: string }[] }>;
}

let bundle: Promise<string> | null = null;
function client(): Promise<string> {
  bundle ??= (async () => {
    const fromVitest = createRequire(createRequire(import.meta.url).resolve('vitest/package.json'));
    const esbuild = fromVitest('esbuild') as Esbuild;
    const out = await esbuild.build({
      entryPoints: [`${SITE}test/e2e/fixtures/kaatu-client.tsx`],
      absWorkingDir: SITE,
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    return out.outputFiles?.[0]?.text ?? '';
  })();
  return bundle;
}

function html(theme: 'light' | 'dark'): string {
  return `<!doctype html><html lang="en" class="${htmlClass}" data-theme="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kaatu fixture</title>${styles}</head><body class="min-h-dvh bg-canvas text-ink"><div id="fixture">${serverHtml}</div><script src="${SCRIPT}"></script></body></html>`;
}

async function open(p: Page, theme: 'light' | 'dark' = 'light') {
  const script = await client();
  await p.route(`**${SCRIPT}`, (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: script }));
  await p.route(`**${FIXTURE}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html(theme) }));
  await p.goto(FIXTURE);
  await p.evaluate(() => document.fonts.ready);
  await expect(p.locator('html')).toHaveAttribute('data-hydrated', '');
  // The first row is on screen at load: its Kaatu runs once hydrated and its atlases are in.
  // Generous: thirty Kaatus hydrate and decode their atlases, and the gate runs lanes side by side.
  await expect(art(p, 'pose-film')).toHaveAttribute('data-running', '', { timeout: 15_000 });
}

/** The drawing in a fixture cell. */
const art = (p: Page, cell: string): Locator => p.locator(`[data-fixture="${cell}"] [data-slot="kaatu"]`);

/** Every Kaatu's frame on the page, by cell. */
const frames = (p: Page) =>
  p.locator('[data-fixture]').evaluateAll((cells) =>
    Object.fromEntries(cells.map((c) => [c.getAttribute('data-fixture'), c.querySelector('[data-slot="kaatu"]')?.getAttribute('data-frame')])),
  );

test('the server HTML shows each pose’s own frame, and hydration keeps it', async ({ page: p }) => {
  for (const pose of KAATU_POSES) expect(serverHtml).toContain(`data-pose="${pose}" data-frame="${pose}"`);
  expect(serverHtml).not.toContain('tabindex');
  await open(p);
  for (const pose of ['peek-left', 'peek-up', 'point', 'laptop'] as const) await expect(art(p, `pose-${pose}`)).toHaveAttribute('data-frame', pose);
});

test('every new pose settles on a non-empty frame from its own atlas', async ({ page: p }) => {
  await open(p);
  for (const pose of KAATU_POSES) {
    const kaatu = art(p, `pose-${pose}`);
    await expect(kaatu, pose).toHaveAttribute('data-frame', pose, { timeout: 8000 });
    const drawn = await kaatu.evaluate(async (el) => {
      const layer = el.querySelector<HTMLElement>('.tc-kaatu-layer[data-on]:not([data-slot="kaatu-ghost"])');
      if (!layer) return null;
      const style = getComputedStyle(layer);
      const url = /url\("?([^")]+)"?\)/.exec(style.backgroundImage)?.[1] ?? '';
      const cell = Number(layer.dataset.cell);
      const image = new Image();
      image.src = url;
      await image.decode();
      const side = image.naturalWidth / 3;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(image, (cell % 3) * side, Math.floor(cell / 3) * side, side, side, 0, 0, side, side);
      const data = ctx.getImageData(0, 0, side, side).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 128) opaque += 1;
      return { url, side, share: opaque / (side * side), opacity: style.opacity, width: (el as HTMLElement).offsetWidth };
    });
    expect(drawn, pose).not.toBeNull();
    expect(drawn?.url, pose).toMatch(/\/kaatu\/kaatu-web-(creator|story)\.webp$/);
    expect(drawn?.side, pose).toBe(480);
    expect(drawn?.share, pose).toBeGreaterThan(0.15);
    expect(drawn?.opacity, pose).toBe('1');
    expect(drawn?.width, pose).toBe(120);
  }
});

test('a poke works by keyboard: a named button, a visible ring, a reaction with a hop, dizzy after four', async ({ page: p }) => {
  await open(p);
  const button = p.getByRole('button', { name: POKE, exact: true }).first();
  await p.keyboard.press('Tab');
  await expect(button).toBeFocused();
  expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  const box = await button.boundingBox();
  expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(24);
  const kaatu = button.locator('[data-slot="kaatu"]');
  await expect(kaatu).toHaveAttribute('aria-hidden', 'true');
  await p.keyboard.press('Enter');
  await expect(kaatu).toHaveAttribute('data-frame', 'heart');
  await p.waitForTimeout(1200);
  await p.keyboard.press('Space');
  await expect(kaatu).toHaveAttribute('data-frame', 'laugh');
  await p.waitForTimeout(1200);
  for (let i = 0; i < 4; i += 1) await p.keyboard.press('Enter');
  await expect(kaatu).toHaveAttribute('data-frame', 'dizzy');
  await expect(kaatu).toHaveAttribute('data-frame', 'center', { timeout: 4000 });
});

test('an interactive Kaatu turns its head to the pointer and leans after it', async ({ page: p }) => {
  await open(p);
  const button = p.locator('[data-fixture="interactive"] [data-slot="kaatu-poke"]');
  const kaatu = button.locator('[data-slot="kaatu"]');
  await button.scrollIntoViewIfNeeded();
  await expect(kaatu).toHaveAttribute('data-running', '');
  const box = await button.boundingBox();
  if (!box) throw new Error('no box');
  const cy = box.y + box.height * 0.45;
  await p.mouse.move(box.x + box.width + 200, cy, { steps: 4 });
  await expect(kaatu).toHaveAttribute('data-facing', 'right');
  await p.mouse.move(box.x + box.width / 2, box.y - 220, { steps: 4 });
  await expect(kaatu).toHaveAttribute('data-facing', 'up');
  const lean = await kaatu.evaluate((el) => (el.querySelector('[data-slot="kaatu-breath"] > span') as HTMLElement).style.transform);
  expect(lean).toMatch(/translate\(/);
  // Far away and still: it looks out again.
  await p.mouse.move(5, 5);
  await expect(kaatu).toHaveAttribute('data-facing', 'center', { timeout: 5000 });
});

test('a following Kaatu is decoration: it turns to the pointer and leans, and is never focusable', async ({ page: p }) => {
  await open(p);
  const kaatu = art(p, 'follow');
  await kaatu.scrollIntoViewIfNeeded();
  await expect(kaatu).toHaveAttribute('data-running', '');
  await expect(kaatu).toHaveAttribute('data-follow', 'true');
  expect(await p.locator('[data-fixture="follow"] button, [data-fixture="follow"] [tabindex]').count()).toBe(0);
  const box = await kaatu.boundingBox();
  if (!box) throw new Error('no box');
  await p.mouse.move(box.x + box.width + 200, box.y + box.height * 0.45, { steps: 4 });
  await expect(kaatu).toHaveAttribute('data-facing', 'right');
  const lean = await kaatu.evaluate((el) => (el.querySelector('[data-slot="kaatu-breath"] > span') as HTMLElement).style.transform);
  expect(lean).toMatch(/translate\(/);
  await p.mouse.move(5, 5);
  await expect(kaatu).toHaveAttribute('data-facing', 'center', { timeout: 5000 });
});

test('it dances on the beat: bop left, bop right, a note each; a posed Kaatu sways in its pose', async ({ page: p }) => {
  await open(p);
  const dancer = art(p, 'dancing');
  const posed = art(p, 'dancing-pose');
  await dancer.scrollIntoViewIfNeeded();
  await expect(dancer).toHaveAttribute('data-running', '');
  await expect(posed).toHaveAttribute('data-frame', 'headphones', { timeout: 6000 });
  const beat = () => p.evaluate(() => window.dispatchEvent(new Event('kaatu-beat')));
  await beat();
  await expect(dancer).toHaveAttribute('data-frame', 'bop-left');
  const notes = await dancer.evaluate((el) => [...el.querySelectorAll('.tc-kaatu-note')].reduce((n, note) => n + note.getAnimations().length, 0));
  expect(notes).toBeGreaterThan(0);
  await beat();
  await expect(dancer).toHaveAttribute('data-frame', 'bop-right');
  await expect(posed).toHaveAttribute('data-frame', 'headphones');
  await expect(dancer).toHaveAttribute('data-frame', 'center', { timeout: 4000 });
});

test('off screen it stops, and a hidden tab stops it too', async ({ page: p }) => {
  await open(p);
  const far = art(p, 'far');
  await expect(far).not.toHaveAttribute('data-running');
  await expect(far.locator('[data-slot="kaatu-breath"]')).toHaveAttribute('data-paused', '');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-running', '');
  await expect(far.locator('[data-slot="kaatu-breath"]')).not.toHaveAttribute('data-paused');
  await p.evaluate(() => window.scrollTo(0, 0));
  await expect(far).not.toHaveAttribute('data-running');
  // The tab hidden: every Kaatu on screen stops.
  const idle = art(p, 'pose-film');
  await expect(idle).toHaveAttribute('data-running', '');
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(idle).not.toHaveAttribute('data-running');
});

test('peeks and stickers below the fold wait hidden, then arrive when scrolled to', async ({ page: p }) => {
  await open(p);
  const slide = (cell: string) => p.locator(`[data-fixture="${cell}"] [data-slot="kaatu-entrance"] > span`);
  const held = (cell: string) => slide(cell).evaluate((el) => getComputedStyle(el).transform);
  expect(await held('far-peek-left')).not.toBe('none');
  expect(await held('far-sticker')).not.toBe('none');
  await p.locator('[data-fixture="far-peek-up"]').scrollIntoViewIfNeeded();
  await expect.poll(() => held('far-peek-left'), { timeout: 4000 }).toBe('none');
  await expect.poll(() => held('far-peek-up'), { timeout: 4000 }).toBe('none');
  await expect.poll(() => held('far-sticker'), { timeout: 4000 }).toBe('none');
  // A section sets the mood of the Kaatu inside it.
  await expect(art(p, 'section-thinking')).toHaveAttribute('data-mood', 'thinking');
});

test('the fixture passes axe (WCAG 2.2 AA)', async ({ page: p }) => {
  await open(p);
  const result = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('stills every Kaatu: the still frames, no life, no moves, a poke one calm face', async ({ page: p }) => {
    await open(p);
    const before = await frames(p);
    for (const pose of KAATU_POSES) expect(before[`pose-${pose}`], pose).toBe(pose);
    expect(before['mood-wave']).toBe('wave');
    await p.mouse.move(400, 900, { steps: 3 });
    await p.evaluate(() => window.dispatchEvent(new Event('kaatu-beat')));
    await p.waitForTimeout(2500);
    expect(await frames(p)).toEqual(before);
    const running = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    expect(running).toBe(0);
    const button = p.getByRole('button', { name: POKE, exact: true }).first();
    const kaatu = button.locator('[data-slot="kaatu"]');
    await button.focus();
    await expect(kaatu).toHaveAttribute('data-running', '');
    await p.keyboard.press('Enter');
    await expect(kaatu).toHaveAttribute('data-frame', 'heart');
    await expect(kaatu).toHaveAttribute('data-frame', 'center', { timeout: 2000 });
  });
});

test('captures the review screenshots (KAATU_CAPTURE=1)', async ({ page: p }) => {
  test.skip(!process.env.KAATU_CAPTURE, 'Set KAATU_CAPTURE=1 to write the review screenshots.');
  test.setTimeout(180_000);
  const dir = `${SITE}.impeccable/review/kaatu`;
  mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await p.setViewportSize({ width: w, height: h });
      await open(p, theme);
      await p.waitForTimeout(3500);
      await p.screenshot({ path: `${dir}/fixture-${w}-${theme}.png`, fullPage: false });
      await p.locator('[data-fixture="interactive"]').scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${dir}/fixture-modes-${w}-${theme}.png` });
      // Mid-dance, with the pointer near the interactive Kaatu: the notes, the bop and the lean.
      await p.locator('[data-fixture="dancing"]').scrollIntoViewIfNeeded();
      const near = await p.locator('[data-fixture="interactive"] [data-slot="kaatu-poke"]').boundingBox();
      if (near) await p.mouse.move(near.x + near.width + 120, near.y + 20, { steps: 3 });
      await p.evaluate(() => window.dispatchEvent(new Event('kaatu-beat')));
      await p.waitForTimeout(260);
      await p.screenshot({ path: `${dir}/fixture-dance-${w}-${theme}.png` });
      await p.mouse.move(2, 2);
      // The site's own Kaatus: the about page's, and the footer's interactive sticker.
      await p.addInitScript((t) => {
        try {
          window.localStorage.setItem('taalcut.theme', t);
        } catch {
          // Blocked storage: the default theme.
        }
      }, theme);
      await p.goto('/about/');
      await p.evaluate(() => document.fonts.ready);
      await p.locator('#kaatu').scrollIntoViewIfNeeded();
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${dir}/about-${w}-${theme}.png` });
      await p.locator('footer[data-slot="site-footer"]').scrollIntoViewIfNeeded();
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${dir}/footer-${w}-${theme}.png` });
    }
  }
});
