// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L7 on synthetic footage with known cuts (FFmpeg lavfi, made at test
 * time): hard cuts found to the frame (±2, as the eval scores), and flash
 * frames, light ramps and fast pans inside shots rejected. Boundary F1 over
 * the set must reach 0.9. These are synthetic numbers; the gate is measured
 * on the labelled sample libraries (H3). Live embeddings when the
 * embeddinggemma-2 component folder is present, else scdet alone.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbedder, type VisionEmbedder } from '../../src/embed/embedder';
import { detectShots } from '../../src/shots/detect-shots';
import { componentDir } from '../helpers/offline';
import { cutFrames, makeReel, testMedia, type ReelOptions, type Segment } from '../helpers/reel';
import { addScores, boundaryF1, type BoundaryScore } from '../helpers/score';

const { ctx } = await testMedia('shots');
const liveDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');

const FLASH = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,15)'";
const RAMP = "hue=b='min(4,max(0,(n-8)*0.4))'";
const PAN = "scale=2*iw:2*ih,crop=iw/2:ih/2:x='min(n*24,iw/2)':y=0";

const REELS: { name: string; options: ReelOptions; segments: Segment[] }[] = [
  {
    name: 'hard-30',
    options: { width: 640, height: 360, rate: '30' },
    segments: [
      { source: 'testsrc2', frames: 45 },
      { source: 'smptebars', frames: 30 },
      { source: 'mandelbrot', frames: 40 },
      { source: 'cellauto', frames: 35 },
      { source: 'sierpinski', frames: 40 },
      { source: 'gradients=c0=0xff8c1a:c1=0xc2185b:speed=0', frames: 30 },
      { source: 'testsrc2', frames: 40, filter: 'hue=h=150' },
    ],
  },
  {
    name: 'distractors-25',
    options: { width: 640, height: 360, rate: '25' },
    segments: [
      { source: 'gradients=c0=0x0d47a1:c1=0x00bcd4:speed=0', frames: 40, filter: FLASH },
      { source: 'testsrc2', frames: 50, filter: PAN },
      { source: 'rgbtestsrc', frames: 40 },
      { source: 'mandelbrot', frames: 45, filter: RAMP },
      { source: 'smptehdbars', frames: 30 },
    ],
  },
  {
    name: 'ntsc',
    options: { width: 480, height: 854, rate: '30000/1001' },
    segments: [
      { source: 'life=mold=10:ratio=0.3', frames: 60 },
      { source: 'smptehdbars', frames: 30 },
      { source: 'yuvtestsrc', frames: 45 },
      { source: 'testsrc', frames: 40, filter: FLASH },
    ],
  },
  // Held out: added after the thresholds were set from the three reels above, and not tuned on.
  {
    name: 'held-out-24-portrait',
    options: { width: 720, height: 1280, rate: '24' },
    segments: [
      { source: 'zoneplate=kx2=200:ky2=100', frames: 36 },
      { source: 'gradients=c0=0x1b5e20:c1=0xcddc39:speed=0.02', frames: 30, filter: FLASH },
      { source: 'testsrc2', frames: 40, filter: 'hue=h=60' },
      { source: 'rgbtestsrc', frames: 24, filter: RAMP },
      { source: 'mandelbrot=start_scale=1', frames: 48 },
      { source: 'color=c=0x8d6e63', frames: 30, filter: 'noise=alls=20:allf=t' },
    ],
  },
  {
    name: 'held-out-50',
    options: { width: 960, height: 540, rate: '50' },
    segments: [
      { source: 'smptebars', frames: 60, filter: PAN },
      { source: 'cellauto=rule=110', frames: 50 },
      { source: 'testsrc2', frames: 70, filter: 'hue=s=0' },
      { source: 'sierpinski=type=triangle', frames: 40, filter: FLASH },
      { source: 'yuvtestsrc', frames: 45 },
    ],
  },
];

describe.skipIf(!ctx)('detectShots on synthetic footage', () => {
  let dir: string;
  let embedder: VisionEmbedder | undefined;
  const scores: BoundaryScore[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-shots-'));
    if (liveDir) embedder = createEmbedder({ modelDir: liveDir });
  });
  afterAll(async () => {
    await embedder?.close();
    await rm(dir, { recursive: true, force: true });
  });

  for (const reel of REELS) {
    it(`finds the cuts of ${reel.name} within 2 frames`, async () => {
      const path = join(dir, `${reel.name}.mp4`);
      await makeReel(ctx!, path, reel.segments, reel.options);
      const result = await detectShots(path, { media: ctx!, ...(embedder ? { embedder } : {}) });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const labelled = cutFrames(reel.segments);
      const score = boundaryF1(
        result.value.cuts.map((c) => c.frame),
        labelled,
      );
      scores.push(score);
      console.warn(
        `[vision] shots ${reel.name}: found ${result.value.cuts.map((c) => `${c.frame}(${c.score.toFixed(1)}${c.distance === undefined ? '' : `/${c.distance.toFixed(2)}`})`).join(' ')}; ` +
          `labelled ${labelled.join(' ')}; rejected ${result.value.rejected.map((c) => `${c.frame}(${c.score.toFixed(1)}/${c.distance?.toFixed(2) ?? '-'})`).join(' ')}`,
      );
      expect(result.value.shots).toHaveLength(result.value.cuts.length + 1);
      const total = result.value.shots.reduce((sum, shot) => sum + shot.duration.value, 0);
      expect(total).toBe(result.value.frameCount);
    }, 120_000);
  }

  it('reaches boundary F1 ≥ 0.9 over the synthetic set', () => {
    const total = addScores(scores);
    console.warn(
      `[vision] shot boundary F1 (synthetic, ${embedder ? 'scdet + EmbeddingGemma 2' : 'scdet only'}): ` +
        `${total.f1.toFixed(3)} (P ${total.precision.toFixed(3)}, R ${total.recall.toFixed(3)}, ` +
        `TP ${total.truePositives}, FP ${total.falsePositives}, FN ${total.falseNegatives})`,
    );
    expect(scores).toHaveLength(REELS.length);
    expect(total.f1).toBeGreaterThanOrEqual(0.9);
  });

  it('treats a clip without cuts as one shot, and merges a shot under 0.5 s', async () => {
    const single = join(dir, 'single.mp4');
    await makeReel(ctx!, single, [{ source: 'testsrc2', frames: 60, filter: PAN }], {
      width: 320,
      height: 568,
      rate: '30',
    });
    const one = await detectShots(single, { media: ctx!, ...(embedder ? { embedder } : {}) });
    expect(one.ok && one.value.shots).toHaveLength(1);
    const short = join(dir, 'short.mp4');
    const segments = [
      { source: 'testsrc2', frames: 40 },
      { source: 'smptebars', frames: 8 },
      { source: 'mandelbrot', frames: 40 },
    ];
    await makeReel(ctx!, short, segments, { width: 320, height: 180, rate: '30' });
    const merged = await detectShots(short, { media: ctx!, ...(embedder ? { embedder } : {}) });
    expect(merged.ok && merged.value.shots.map((s) => s.duration.value)).toEqual([48, 40]);
  }, 120_000);
});
