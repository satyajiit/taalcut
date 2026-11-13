// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, RationalTime, unwrap } from '@taalcut/core';
import { createAuthoredTimeline } from '@taalcut/timeline';
import { compileComposition } from '../../src/compile/composition';
import { writeBundle } from '../../src/engine/bundle-writer';
import { presetFor } from '../../src/presets/presets.v1';
import { DOM_PROBE } from '../../src/engine/dom-probe';
import { findTestShell } from '../support/shell';
import { authoredFixture, authoredSource } from './support';

const shell = findTestShell('authored continuous clock');

describe.skipIf(!shell.path)('authored program frame seeking', { timeout: 60_000 }, () => {
  let work: string;
  let browser: Browser;
  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'taalcut-authored-'));
    browser = await puppeteer.launch({
      executablePath: shell.path,
      headless: true,
      args: ['--allow-file-access-from-files'],
    });
  });
  afterAll(async () => {
    await browser?.close();
    if (work) await rm(work, { recursive: true, force: true });
  });

  it('shows the same source state forwards and backwards after trimming five seconds', async () => {
    const timeline = unwrap(
      createAuthoredTimeline({ projectId: newId<'Project'>(), name: 'Launch', program: authoredFixture() }),
    );
    const track = timeline.tracks[0]!;
    if (track.kind !== 'video') throw new Error('Expected video');
    const item = track.items[0]!;
    if (item.type !== 'program') throw new Error('Expected program');
    const trimmed = {
      ...timeline,
      tracks: [
        {
          ...track,
          items: [
            {
              ...item,
              sourceStart: RationalTime.of(300, timeline.canvas.rate),
              duration: RationalTime.of(600, timeline.canvas.rate),
            },
          ],
        },
      ],
    };
    const bundle = unwrap(
      compileComposition(trimmed, {
        variant: 'export',
        preset: presetFor('device'),
        burnCaptions: false,
        media: () => undefined,
        authoredWorkspace: { text: () => authoredSource, asset: () => undefined },
      }),
    );
    await writeBundle(bundle, work);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(pathToFileURL(join(work, 'index.html')).href);
    await page.waitForFunction('Boolean(window.__timelines?.taalcut)');
    const stateAt = async (time: number) =>
      page.evaluate(`(() => {
      window.__timelines.taalcut.totalTime(${time}, true);
      const node = document.getElementById('w-${item.id}-title');
      return Number(window.gsap.getProperty(node, 'x'));
    })()`) as Promise<number>;
    const samples = [0, 0.5, 2, 5, 9.5];
    const states = new Map<number, number>();
    for (const sample of samples) {
      const x = await stateAt(sample);
      states.set(sample, x);
      expect(x).toBeCloseTo((sample + 5) * 30, 2);
    }
    for (const sample of samples.toReversed()) expect(await stateAt(sample)).toBe(states.get(sample));
    for (const time of [1, 2, 3, 5, 3, 2, 1]) {
      await stateAt(time);
      const opacity = await page.evaluate(
        `Number(window.gsap.getProperty(document.getElementById('w-${item.id}-cursor'), 'opacity'))`,
      );
      expect(opacity).toBe(time >= 2 && time < 4 ? 0 : 1);
    }
    const probe = (await page.evaluate(DOM_PROBE)) as {
      boxes: { program?: boolean; textBounds?: { width: number } }[];
    };
    const programBox = probe.boxes.find((box) => box.program);
    expect(programBox?.textBounds?.width).toBeGreaterThan(0);
    expect(programBox?.textBounds?.width).toBeLessThan(1920);
    expect(errors).toEqual([]);
    await page.close();
  });
});
