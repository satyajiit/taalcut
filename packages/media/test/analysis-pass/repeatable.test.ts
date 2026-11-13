// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-F15: on VideoToolbox, frames reach the CPU at their size and only convert there, and FFmpeg 9.0.2's threaded
 * conversion of matrix-tagged NV12 to gray or RGB isn't repeatable at some sizes (on 18 cores: gray and rgb24 at
 * 256×144 and 1280×720 differed almost every run). The pass, the frame sets and `sampleFrames` convert on one thread
 * (normalise/one-thread.ts), so a BT.709-tagged clip gives the same bytes run after run: the analysis pass's 256 px
 * gray frames, its scene scores and its 1280 px rgb24 set, and sampled rgb24 frames. It decodes on the platform's
 * hardware decoder (VideoToolbox; NVDEC on Linux, whose frames download at their size the same way): run it under
 * the machine's hardware lock. Skips without FFmpeg or a hardware plan.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planNormalisation,
  probeMedia,
  runAnalysisPass,
  sampleFrames,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, renderClip } from '../helpers/clip';

const found = await findTestBinaries('repeatable conversions');
const RUNS = 3;
const digest = (data: Buffer) => createHash('sha1').update(data).digest('hex');

describe.skipIf(!found.binaries)('conversions on hardware frames (IX2-F15)', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  let plan: NormalisationPlan | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-repeatable-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'tagged.mp4');
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-frames:v', '60', ...h264],
      ...['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'],
    ]);
    if (!made) return;
    const probed = await probeMedia(path, ctx);
    const planned = probed.ok ? planNormalisation(probed.value, {}) : undefined;
    if (planned?.ok && planned.value.decode.backend !== 'software') plan = planned.value;
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function pass(clip: NormalisationPlan) {
    const gray: string[] = [];
    const run = await runAnalysisPass(path, clip, ctx, {
      size: 256,
      coarseEvery: 3,
      dir,
      onFrame: (frame) => gray.push(digest(frame.data)),
      frameSets: [{ set: 'ocr', size: { longSide: 1280 }, format: 'rgb24', every: 10, maxFrames: 6 }],
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    const sets = await Promise.all(run.value.files.map(async (file) => digest(await readFile(file.path))));
    await Promise.all(run.value.files.map((file) => rm(file.path, { force: true })));
    const { fine, coarse } = run.value;
    return { gray, sets, scores: JSON.stringify({ fine, coarse }) };
  }

  it('gives the same gray frames, scene scores and frame sets every run', async (t) => {
    if (!plan) return t.skip('no hardware plan');
    const runs = [];
    for (let n = 0; n < RUNS; n++) runs.push(await pass(plan));
    expect(runs[0]?.gray).toHaveLength(60);
    expect(runs[0]?.sets).toHaveLength(1);
    for (const run of runs.slice(1)) expect(run).toEqual(runs[0]);
  });

  it('samples the same rgb24 frames every run', async (t) => {
    if (!plan) return t.skip('no hardware plan');
    const clip = plan;
    const sample = async () => {
      const frames: string[] = [];
      const run = await sampleFrames(path, clip, ctx, {
        size: 256,
        format: 'rgb24',
        every: 5,
        onFrame: (frame) => frames.push(digest(frame.data)),
      });
      if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
      return frames;
    };
    const runs = [];
    for (let n = 0; n < RUNS; n++) runs.push(await sample());
    expect(runs[0]).toHaveLength(12);
    for (const run of runs.slice(1)) expect(run).toEqual(runs[0]);
  });
});
