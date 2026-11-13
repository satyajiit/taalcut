// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G25 basic: a burst (small crops and sensor noise of one moment, plus a
 * blurred twin) collapses to one best take, the blurred twin never wins, and
 * distinct shots never group. Quality and dHash from analyzeShots, best-frame
 * vectors from EmbeddingGemma 2 when its component folder is present (else
 * the dHash-only rule), at every image-token budget with that budget's
 * thresholds (IX2-E2). Synthetic fixtures; the real G25 bursts come from
 * phones (human input).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, RationalTime } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeShots } from '../../src/analysis/analyze-shots';
import {
  duplicateThresholds,
  groupNearDuplicates,
  type DuplicateCandidate,
} from '../../src/analysis/duplicates';
import { createEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { IMAGE_TOKEN_BUDGETS, type ImageTokenBudget } from '../../src/embed/space';
import { probeSource, sampleFrames } from '../../src/media/frames';
import { componentDir } from '../helpers/offline';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('duplicates');
const liveDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');

const STILL = "select='eq(n\\,0)',loop=loop=29:size=1,setpts=N/30/TB";
const NOISE = 'noise=alls=10:allf=t';
const SHOTS = [
  { id: 'burst-a', source: 'testsrc2', filter: `${STILL},${NOISE}` },
  { id: 'burst-b', source: 'testsrc2', filter: `${STILL},crop=632:356:4:2,scale=640:360,${NOISE}` },
  { id: 'burst-c', source: 'testsrc2', filter: `${STILL},crop=628:354:8:4,scale=640:360,${NOISE}` },
  { id: 'burst-blurred', source: 'testsrc2', filter: `${STILL},gblur=sigma=4,${NOISE}` },
  { id: 'other-bars', source: 'smptehdbars', filter: STILL },
  { id: 'other-fractal', source: 'mandelbrot', filter: STILL },
  { id: 'other-sunset', source: 'gradients=c0=0xff8c1a:c1=0xc2185b:speed=0', filter: STILL },
] as const;

const RATE = FrameRate.of(30);

/** Each shot's best-frame vector at one budget, sized as vision.embed sizes index frames. */
async function bestFrameVectors(
  budget: ImageTokenBudget,
  modelDir: string,
  shots: readonly { readonly id: string; readonly path: string; readonly bestFrame: number }[],
): Promise<Map<string, Float32Array>> {
  const embedder = createEmbedder({
    modelDir,
    profile: { ...DEFAULT_EMBEDDING_PROFILE, imageTokens: budget },
  });
  const vectors = new Map<string, Float32Array>();
  try {
    for (const shot of shots) {
      const source = await probeSource(ctx!, shot.path);
      if (!source.ok) throw new Error(source.error.code);
      const size = await embedder.frameSize(source.value.width, source.value.height, 'index');
      const frames = await sampleFrames(ctx!, source.value, {
        size,
        format: 'rgb24',
        frames: [shot.bestFrame],
      });
      if (!frames.ok || !frames.value[0]) throw new Error('no best frame');
      const frame = frames.value[0];
      const read = await embedder.embedImages([
        { width: frame.width, height: frame.height, rgb: frame.data },
      ]);
      const [vector] = read.ok ? read.value : [];
      if (!vector) throw new Error(read.ok ? 'no vector' : read.error.code);
      vectors.set(shot.id, vector);
    }
  } finally {
    await embedder.close();
  }
  return vectors;
}

describe.skipIf(!ctx)('near-duplicate bursts', () => {
  let dir: string;
  const candidates: DuplicateCandidate[] = [];
  const best: { id: string; path: string; bestFrame: number }[] = [];
  /** Best-frame vectors by budget (none without the model: the dHash-only rule). */
  const byBudget = new Map<ImageTokenBudget, Map<string, Float32Array>>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-dups-'));
    for (const [i, shot] of SHOTS.entries()) {
      const path = join(dir, `${shot.id}.mp4`);
      await makeReel(ctx!, path, [{ source: shot.source, frames: 30, filter: shot.filter }], {
        width: 640,
        height: 360,
        rate: '30',
      });
      const range = { start: RationalTime.of(0, RATE), duration: RationalTime.of(30, RATE) };
      const analysed = await analyzeShots({ path, shots: [{ shotId: shot.id, range }] }, { media: ctx! });
      if (!analysed.ok) throw new Error(analysed.error.code);
      const analysis = analysed.value[0]!.analysis;
      candidates.push({
        shotId: shot.id,
        assetId: shot.id,
        sourceId: 'phone',
        capturedAt: 1_760_000_000_000 + i * 1000,
        durationMs: 1000,
        overall: analysis.quality.overall,
        dHash: analysis.dHash,
        orientation: analysis.orientation,
      });
      best.push({ id: shot.id, path, bestFrame: analysis.bestFrame });
    }
    for (const budget of liveDir ? IMAGE_TOKEN_BUDGETS : []) {
      byBudget.set(budget, await bestFrameVectors(budget, liveDir!, best));
    }
  }, 480_000);
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([...IMAGE_TOKEN_BUDGETS])(
    'collapses the burst to one best take that is never the blurred twin, and leaves distinct shots alone (%i tokens)',
    (budget) => {
      const vectors = byBudget.get(budget) ?? new Map<string, Float32Array>();
      const groups = groupNearDuplicates(candidates, vectors, duplicateThresholds(budget));
      console.warn(
        `[vision] duplicates at ${budget} (${vectors.size > 0 ? 'cosine + dHash' : 'dHash only'}): ` +
          `${JSON.stringify(groups)}; overall ${candidates.map((c) => `${c.shotId} ${c.overall.toFixed(2)} ${c.dHash}`).join(', ')}`,
      );
      expect(groups).toHaveLength(1);
      const [group] = groups;
      expect([...group!.shotIds].sort()).toEqual(['burst-a', 'burst-b', 'burst-blurred', 'burst-c']);
      expect(group!.bestShotId).not.toBe('burst-blurred');
      for (const other of ['other-bars', 'other-fractal', 'other-sunset']) {
        expect(group!.shotIds).not.toContain(other);
      }
    },
  );

  it('never groups across sources, orientations or capture times more than 10 minutes apart', () => {
    const vectors = byBudget.get(280) ?? new Map<string, Float32Array>();
    const t = duplicateThresholds(280);
    const a = candidates[0]!;
    const b = candidates[1]!;
    expect(groupNearDuplicates([a, { ...b, sourceId: 'other' }], vectors, t)).toEqual([]);
    expect(groupNearDuplicates([a, { ...b, orientation: 'portrait' }], vectors, t)).toEqual([]);
    expect(groupNearDuplicates([a, { ...b, capturedAt: a.capturedAt! + 11 * 60_000 }], vectors, t)).toEqual(
      [],
    );
    // Without capture times only shots of one asset are compared.
    expect(
      groupNearDuplicates(
        [
          { ...a, capturedAt: null },
          { ...b, capturedAt: null },
        ],
        vectors,
        t,
      ),
    ).toEqual([]);
    expect(
      groupNearDuplicates(
        [
          { ...a, capturedAt: null },
          { ...b, capturedAt: null, assetId: a.assetId },
        ],
        vectors,
        t,
      ),
    ).toHaveLength(1);
  });
});
