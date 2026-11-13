// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What UX3-ONB's specs share: first run's screens in order, the system's window controls over the bar (Linux), the
 * frame's parts as boxes, and the pairing QR read back as a phone camera would.
 */
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import decodeQR from 'qr/decode.js';
import { fakes, type Ui2bFakeOptions } from './ui2b-support.ts';

/** The welcome, then every step an alpha build shows. */
export const SCREENS = ['welcome', 'sources', 'alpha', 'first-video'] as const;
export type Screen = (typeof SCREENS)[number];

export const pathOf = (screen: Screen) => (screen === 'welcome' ? '/onboarding' : `/onboarding/${screen}`);

/** A fresh first run on this machine, the models already here and nothing moving under the screenshots. */
export async function firstRun(page: Page, system: NonNullable<Ui2bFakeOptions['system']>): Promise<void> {
  await fakes(page, {
    onboarding: 'fresh',
    channel: 'alpha',
    library: 'empty',
    downloadTickMs: 0,
    indexingTickMs: 0,
    system,
    transfer: 'waiting',
  });
  // Off a Mac the system draws the window's controls over the bar (Electron's titleBarOverlay, stubbed).
  if (system !== 'mac')
    await page.addInitScript(() => {
      const overlay = new EventTarget();
      Object.defineProperty(overlay, 'visible', { get: () => true });
      Object.defineProperty(navigator, 'windowControlsOverlay', { get: () => overlay });
    });
}

/** Opens a screen and waits for its heading, its fonts and its data (no bones left). */
export async function openScreen(page: Page, screen: Screen): Promise<void> {
  await page.goto(pathOf(screen));
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Where the frame's parts are on screen, and how far its content can scroll. */
export async function frameBoxes(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect();
      return found ? { top: found.top, bottom: found.bottom, left: found.left, right: found.right } : null;
    };
    const content = document.querySelector<HTMLElement>('[data-onboarding=content]');
    return {
      bar: box('[data-slot=window-bar]'),
      sidebar: box('[data-slot=onboarding-sidebar]'),
      footer: box('[data-slot=onboarding-footer]'),
      content: box('[data-onboarding=content]'),
      overflow: content ? content.scrollHeight - content.clientHeight : 0,
      scrollTop: content?.scrollTop ?? 0,
      documentScrolls: document.scrollingElement!.scrollHeight > window.innerHeight,
    };
  });
}

/** Scrolls the content to its end, as a wheel would. */
export async function scrollContentToEnd(page: Page): Promise<void> {
  await page.locator('[data-onboarding=content]').evaluate((content) => {
    content.scrollTop = content.scrollHeight;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

/** A screenshot of the window as it is (not the whole scroll): the point is what stands still. */
export async function shootWindow(page: Page, name: string): Promise<void> {
  const dir = process.env.TAALCUT_ONB_SCREENS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir.replace(/\/$/, '')}/${name}.png`, animations: 'disabled' });
}

/**
 * The pairing QR as a phone's camera reads it: the drawn SVG, with the colours the page gives it, rasterised on a
 * white margin in the page and decoded here by the same library that draws it (qr 0.7.2's decoder).
 */
export async function readQr(page: Page): Promise<string> {
  const image = await page.locator('[data-slot=qr-code]').evaluate(async (svg: SVGSVGElement) => {
    const size = 360;
    const margin = 40;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Classes don't travel with the markup: write each drawn part's colour onto it.
    const originals = [svg, ...svg.querySelectorAll('*')];
    [clone, ...clone.querySelectorAll('*')].forEach((element, i) => {
      const style = getComputedStyle(originals[i]!);
      if (originals[i]!.getAttribute('class')) element.setAttribute('fill', style.fill);
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(size));
    clone.setAttribute('height', String(size));
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
    );
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size + margin * 2;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, margin, margin, size, size);
    URL.revokeObjectURL(url);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: pixels.width, height: pixels.height, data: Array.from(pixels.data) };
  });
  return decodeQR({ width: image.width, height: image.height, data: Uint8Array.from(image.data) });
}
