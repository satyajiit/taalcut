// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A2's QA budget: the sound checks add at most 4 s to QA on a 60 s render. The hearing runs in the jobs
 * process (another process: audio's analysis, measured at 4.4 s warm for a 60 s render with the fp16 models on an
 * M5 Max, apps/desktop render-listener.test), started when the file is finished, so it overlaps QA's format,
 * picture and level passes. This runs real QA on a real 60 s 1080×1920 render, once without the sound checks and
 * once with a listener that answers after the measured hearing time (TAALCUT_LISTEN_MS overrides it), and prints
 * both. A benchmark: TAALCUT_BENCH=1 only.
 */
import { join } from 'node:path';
import { ok, type AsyncResult, type RenderListening, type SoundListener } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQa, type QaContext } from '../../src/qa/run-qa';
import { hearingOf } from '../../src/qa/modules/sound-listening';
import type { SoundListeningFact } from '../../src/qa/modules/facts';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { clock, passFixture, qaPlan, runInput } from './support';

const bench = process.env.TAALCUT_BENCH === '1';
const media = bench ? await findTestMedia('sound QA bench') : { binaries: undefined };
const HEARING_MS = Number(process.env.TAALCUT_LISTEN_MS ?? 4400);

const CUTS = Array.from({ length: 40 }, (_, i) => ({
  frame: 40 + i * 44,
  from: `c${i}`,
  to: `c${i + 1}`,
  beat: null,
}));
const heard = (): RenderListening => ({
  measures: {
    duration: { value: 60_000, rate: { num: 1000, den: 1 } },
    lufs: -14,
    truePeakDbtp: -1.2,
    peakDbfs: -1.5,
    lraLu: 5,
    crestLu: 2,
    noiseFloorDbfs: -60,
    nearSilent: false,
    bandwidthHz: 16_000,
    brightnessHz: 2000,
    bands: null,
    sideToMidDb: -9,
  },
  events: [],
  cutSync: {
    items: [],
    cutsWithoutHit: [],
    okShare: 0,
    nearShare: 0,
    chanceShare: 0,
    medianOffsetMs: null,
    toleranceMs: 33.3,
  },
  audit: { ok: true, findings: [] },
  critique: null,
  realness: null,
  model: null,
});

describe.skipIf(!bench || !media.binaries)(
  'sound QA on a 60 s render (EAR1-A2 budget)',
  { timeout: 600_000 },
  () => {
    let ctx: QaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;
    let file: string;
    const plan = qaPlan({ durationFrames: 1800, cuts: CUTS });

    beforeAll(async () => {
      ctx = { media: mediaContext(media.binaries!), clock };
      work = await tempDir('qa-sound-bench');
      file = join(work.dir, 'render.mp4');
      await passFixture(ctx.media, file, { seconds: 60, extra: ['-af', 'volume=7.8dB'] });
    });
    afterAll(() => work.dispose());

    it('adds at most 4 s to QA', async () => {
      const without = performance.now();
      await runQa(runInput(file, plan, { probe: async () => [] }), ctx);
      const baseMs = performance.now() - without;

      const listener: SoundListener = {
        hearRender: (): AsyncResult<RenderListening> =>
          new Promise((resolve) => setTimeout(() => resolve(ok(heard())), HEARING_MS)),
      };
      const fact: SoundListeningFact = { listener, profile: 'launch', effects: [] };
      const started = performance.now();
      // What qa-facts does when the file is finished: the hearing starts before QA's first pass.
      let pending: AsyncResult<RenderListening> | undefined = listener.hearRender(
        hearingOf(plan, fact, file),
      );
      const prefetched = (asked: string) => {
        const taken = asked === file ? pending : undefined;
        pending = undefined;
        return taken;
      };
      const report = await runQa(
        runInput(file, plan, { probe: async () => [], facts: { listening: { ...fact, prefetched } } }),
        ctx,
      );
      const withMs = performance.now() - started;
      expect(report.ok).toBe(true);
      console.warn(
        `[A2 QA budget, 60 s render] QA ${Math.round(baseMs)} ms without the sound checks, ${Math.round(withMs)} ms ` +
          `with a ${HEARING_MS} ms hearing: +${Math.round(withMs - baseMs)} ms`,
      );
      expect(withMs - baseMs).toBeLessThanOrEqual(4000);
    });
  },
);
