// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the graphics checks on what Chrome draws. Four made-up compositions are gated, placed on one still timeline
 * with a burnt-in caption and probed as the export's checking stage probes (openTextProbe, its DOM probe's
 * composition boxes): a card reaching past the safe rect's left edge fails graphicsSafeZone, a card over the caption
 * fails graphicsOverlap, 20 px words fail graphicsReadability, and a card inside the safe rect with large words
 * passes all three. Measured again with nothing changed, the same graphics are read from the cache, and the probe
 * reads only the moment the caption shares.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type QaCheckResult, type Timeline } from '@taalcut/core';
import { createCompositionFonts } from '../../src/captions/fonts';
import { layoutCue } from '../../src/captions/layout';
import type { CompileOptions } from '../../src/compile/composition';
import { compileComposition } from '../../src/compile/composition';
import type { CompositionPlacement } from '../../src/compile/layers/compositions';
import { openTextProbe, type TextProbe } from '../../src/engine/qa-probes';
import { presetFor } from '../../src/presets/presets.v1';
import { createGraphicMeasureCache } from '../../src/qa/graphic-measures';
import { graphicsQaModule } from '../../src/qa/modules/graphics';
import type { QaPlan } from '../../src/types';
import { gateHtml } from '../../src/workspace/gate/gate';
import type { PreparedComposition } from '../../src/workspace/gate/prepare';
import { FONTS_DIR, testMeasurer } from '../support/fonts';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { captionTrackOf, makeTimeline } from '../support/timeline';
import { runInput } from './support';

const media = await findTestMedia('graphics QA');
const shell = findTestShell('graphics QA');
const rate = FrameRate.of(30);
const WANTED = new Set(['graphicsSafeZone', 'graphicsOverlap', 'graphicsReadability'] as const);

/** A made-up card: one block of words at `css`, entering and leaving with a fade. */
const card = (id: string, css: string) => `<!doctype html>
<html lang="en" data-composition-variables='[]'>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template id="${id}-template">
      <style>
        #root { position: absolute; inset: 0; }
        .card { position: absolute; ${css} color: #ffffff; background: #203040; padding: 16px; }
      </style>
      <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920" data-duration="3">
        <div class="card">Made-up words</div>
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.addLabel('enter', 0);
        tl.from('.card', { opacity: 0, duration: 0.3 });
        tl.addLabel('exit', 2.6);
        tl.to('.card', { opacity: 0, duration: 0.3 }, 'exit');
        window.__timelines['${id}'] = tl;
      </script>
    </template>
  </body>
</html>
`;

const CARDS = {
  // Past the safe rect's left edge (x 120 on the device preset).
  GEDGE: card('edge', 'left: 40px; top: 500px; width: 400px; font-size: 64px;'),
  // The whole safe rect, so over the caption wherever it sits in it.
  GOVER: card('over', 'left: 130px; top: 300px; width: 608px; height: 908px; font-size: 64px;'),
  GSMALL: card('small', 'left: 200px; top: 500px; width: 400px; font-size: 20px;'),
  GGOOD: card('good', 'left: 200px; top: 500px; width: 400px; font-size: 64px;'),
} as const;
const SPANS = {
  GEDGE: { start: 0, end: 90 },
  GOVER: { start: 90, end: 180 },
  GSMALL: { start: 180, end: 270 },
  GGOOD: { start: 270, end: 360 },
} as const;
type Id = keyof typeof CARDS;
const IDS = Object.keys(CARDS) as Id[];

describe.skipIf(!media.binaries || !shell.path)(
  'the graphics checks on what Chrome draws',
  { timeout: 600_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    let probe: TextProbe;
    let plan: QaPlan;
    const asked: number[][] = [];

    beforeAll(async () => {
      work = await tempDir('graphics-qa');
      const prepared = new Map<Id, PreparedComposition>();
      for (const id of IDS) {
        const gated = await gateHtml(CARDS[id], `${id}.html`);
        if (!gated.ok) throw new Error(`${id}: ${JSON.stringify(gated.findings)}`);
        prepared.set(id, gated.value);
      }
      const placements: CompositionPlacement[] = IDS.map((id) => ({
        itemId: id,
        span: SPANS[id],
        composition: prepared.get(id)!,
        values: {},
      }));
      const timeline: Timeline = makeTimeline({
        items: [{ kind: 'image', frames: 360 }],
        captions: captionTrackOf(rate, [[90, 90, 'Made up words on the caption']]),
      });
      const measurer = await testMeasurer();
      const options: Omit<CompileOptions, 'media' | 'variant'> = {
        preset: presetFor('device'),
        burnCaptions: true,
        fonts: createCompositionFonts(FONTS_DIR, measurer),
        captionLayout: (text, style, safe, language) => layoutCue(text, style, measurer, safe, language),
        compositions: placements,
      };
      // The compiled plan's cues; its graphics are the placements given here (a timeline's come from its items).
      const compiled = compileComposition(timeline, {
        ...options,
        variant: 'export',
        media: () => ({
          file: '/nonexistent/still.jpg',
          key: 'still',
          mediaStart: RationalTime.zero(rate),
          ext: 'jpg',
        }),
      });
      if (!compiled.ok) throw new Error(compiled.error.code);
      plan = {
        ...compiled.value.qaPlan,
        graphics: IDS.map((id) => ({
          id,
          span: SPANS[id],
          compositionId: id,
          hash: createHash('sha256').update(CARDS[id]).digest('hex'),
          params: {},
        })),
      };
      const opened = await openTextProbe({
        timeline,
        options,
        dir: join(work.dir, 'probe'),
        ctx: mediaContext(media.binaries!),
        chromePath: shell.path!,
        browserGpu: 'software',
      });
      if (!opened.ok) throw new Error(opened.error.code);
      probe = opened.value;
    });

    afterAll(async () => {
      await probe?.close();
      await work?.dispose();
    });

    const cache = createGraphicMeasureCache();
    async function check() {
      const run = runInput('/nonexistent/render.mp4', plan, {
        probeFrame: async (frames) => {
          asked.push([...frames]);
          return probe.probeFrame(frames);
        },
        graphicMeasures: cache,
      });
      const frames = graphicsQaModule.probeFrames({ run, facts: {} });
      const probed = frames.length > 0 ? await run.probeFrame!(frames) : null;
      const results = await graphicsQaModule.run({ run, facts: {}, probed }, WANTED);
      return Object.fromEntries(results.map((result) => [result.id, result])) as Record<
        string,
        QaCheckResult
      >;
    }
    const failing = (result: QaCheckResult | undefined) =>
      [...new Set((result?.findings ?? []).map((finding) => finding.target?.id))].sort();

    it('fails the card past the edge, the card over the caption and the small words, and passes the good card', async () => {
      const results = await check();
      expect(asked).toEqual([[15, 45, 105, 135, 195, 225, 285, 315]]);
      expect(results.graphicsSafeZone?.status).toBe('fail');
      expect(failing(results.graphicsSafeZone)).toEqual(['GEDGE']);
      expect(results.graphicsOverlap?.status).toBe('fail');
      expect(failing(results.graphicsOverlap)).toEqual(['GOVER']);
      expect(results.graphicsReadability?.status).toBe('fail');
      expect(failing(results.graphicsReadability)).toEqual(['GSMALL']);
      // 20 px at the curated sans' cap height, against 36 px.
      expect(results.graphicsReadability?.measured?.value).toBeLessThan(16);
    });

    it('reads unchanged graphics from the cache, and the probe only where the caption is on', async () => {
      const before = asked.length;
      const results = await check();
      expect(asked.slice(before)).toEqual([[105, 135]]);
      expect(failing(results.graphicsSafeZone)).toEqual(['GEDGE']);
      expect(failing(results.graphicsOverlap)).toEqual(['GOVER']);
      expect(failing(results.graphicsReadability)).toEqual(['GSMALL']);
    });
  },
);
