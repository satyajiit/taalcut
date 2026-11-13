// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * tc.js v2 in the pinned shell (SPEC G.2, G.9): it builds one paused GSAP timeline from the motion data, as long as
 * the composition, and registers it for HyperFrames; every element's state at a frame is the same whichever way
 * the playhead came (forwards, backwards, in random order); it refuses a property, a value or an ease off the
 * allowlists; and a page whose GSAP didn't load fails at once instead of waiting.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TC_RUNTIME_JS } from '../../src/compile/runtime';
import { gsapDistDir } from '../../src/motion/gsap-files';
import { findTestShell } from '../support/shell';
import { MOTION_STATE, writeMotionBundle } from './page-support';
import { motionTimeline } from './support';

const shell = findTestShell('motion runtime');

async function open(browser: Browser, file: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewport({ width: 1080, height: 1920 });
  await page.goto(pathToFileURL(file).href);
  return { page, errors };
}

const registered = (page: Page) =>
  page.waitForFunction('Boolean(window.__timelines && window.__timelines.taalcut)', { timeout: 10_000 }).then(
    () => true,
    () => false,
  );

async function stateAt(page: Page, frame: number): Promise<Record<string, string>> {
  // void: totalTime returns the timeline, which is not for serialising back.
  await page.evaluate(`void window.__timelines.taalcut.totalTime(${frame / 30}, true)`);
  return page.evaluate(MOTION_STATE) as Promise<Record<string, string>>;
}

describe.skipIf(!shell.path)('tc.js v2 (SPEC G.2)', { timeout: 600_000 }, () => {
  let work: string;
  let browser: Browser;
  let page: Page;
  let errors: string[];
  let durationFrames: number;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'taalcut-motion-runtime-'));
    const { timeline } = await motionTimeline();
    const bundle = await writeMotionBundle(timeline, join(work, 'export'), 'export');
    durationFrames = bundle.durationFrames;
    browser = await puppeteer.launch({
      executablePath: shell.path,
      headless: true,
      args: ['--allow-file-access-from-files'],
    });
    ({ page, errors } = await open(browser, join(work, 'export', 'index.html')));
  });

  afterAll(async () => {
    await browser?.close();
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('registers one paused timeline as long as the composition', async () => {
    expect(await registered(page)).toBe(true);
    const facts = (await page.evaluate(
      '({ paused: window.__timelines.taalcut.paused(), duration: window.__timelines.taalcut.duration() })',
    )) as { paused: boolean; duration: number };
    expect(facts.paused).toBe(true);
    expect(facts.duration).toBeCloseTo(durationFrames / 30, 6);
    expect(errors).toEqual([]);
  });

  it('draws every frame the same whichever way the playhead came', async () => {
    expect(await registered(page)).toBe(true);
    const frames = Array.from({ length: durationFrames }, (_, frame) => frame);
    const forward = new Map<number, Record<string, string>>();
    for (const frame of frames) forward.set(frame, await stateAt(page, frame));
    for (const frame of [...frames].reverse())
      expect(await stateAt(page, frame), `backwards to ${frame}`).toEqual(forward.get(frame));
    // A fixed pseudo-random order (a scrub): each frame from wherever the last one left the playhead.
    let seed = 7;
    for (let step = 0; step < 300; step++) {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      const frame = seed % durationFrames;
      expect(await stateAt(page, frame), `jump to ${frame}`).toEqual(forward.get(frame));
    }
    // It moves: captions and the transitions change what is drawn.
    expect(forward.get(30)).not.toEqual(forward.get(90));
  });

  describe('refusals', () => {
    const page = (data: unknown, withGsap = true) =>
      [
        '<!doctype html><html><body><div id="root"><div id="a"></div></div>',
        `<script type="application/json" id="tc-data">${JSON.stringify(data)}</script>`,
        withGsap ? `<script src="${pathToFileURL(join(gsapDistDir(), 'gsap.min.js')).href}"></script>` : '',
        '<script src="tc.js"></script></body></html>',
      ].join('\n');
    const tween = (to: unknown, ease?: string) => ({
      version: 2,
      duration: 1,
      motion: {
        tweens: [{ targets: { ids: ['a'] }, at: 0, duration: 0.5, from: {}, to, ...(ease ? { ease } : {}) }],
        splits: [],
      },
    });

    async function run(html: string): Promise<{ errors: string[]; registered: boolean }> {
      const dir = join(work, `refuse-${Math.random().toString(36).slice(2)}`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'tc.js'), TC_RUNTIME_JS);
      await writeFile(join(dir, 'index.html'), html);
      const opened = await open(browser, join(dir, 'index.html'));
      const done = await opened.page
        .waitForFunction('Boolean(window.__timelines && window.__timelines.taalcut)', { timeout: 1_500 })
        .then(
          () => true,
          () => false,
        );
      await opened.page.close();
      return { errors: opened.errors, registered: done };
    }

    it('refuses what is off the allowlists, and registers nothing', async () => {
      for (const [to, ease, message] of [
        [{ fontSize: '10px' }, undefined, 'property fontSize'],
        [{ clipPath: 'url(https://example.com/x)' }, undefined, 'clipPath'],
        [{ morphSVG: '#elsewhere' }, undefined, 'morphSVG'],
        [{ opacity: '1' }, undefined, 'opacity'],
        [{ opacity: 1 }, 'rough({ points: 20 })', 'ease'],
      ] as const) {
        const result = await run(page(tween(to, ease)));
        expect(result.registered, message).toBe(false);
        expect(result.errors.join('\n'), message).toContain(`Taalcut: refused ${message}`);
      }
    });

    it('accepts the same tween within them', async () => {
      const result = await run(page(tween({ opacity: 0.5 }, 'power2.out')));
      expect(result).toEqual({ errors: [], registered: true });
    });

    it('fails at once when GSAP did not load', async () => {
      const result = await run(page(tween({ opacity: 1 }), false));
      expect(result.registered).toBe(false);
      expect(result.errors.join('\n')).toContain('Taalcut: GSAP did not load');
    });
  });
});
