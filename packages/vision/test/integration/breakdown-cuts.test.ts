// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.detectCuts on synthetic reels with labelled cuts: the golden set's
 * three synthetic labels (hard cuts and 10-frame dissolves at the labelled
 * frames) and a reel of in-shot distractors (a flash, a fast pan, a light
 * ramp). Every number printed here is SYNTHETIC: lavfi patterns, not real
 * footage; the gate is measured on the labelled sample libraries (H3).
 * Live embeddings when the embeddinggemma-2 component folder is present.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyVerdicts, proposals, settleWithoutModel } from '../../src/breakdown/detect-cuts';
import type { BreakdownCut, CutList } from '../../src/breakdown/types';
import { VISION_CONFIG } from '../../src/config';
import { createEmbedder, type VisionEmbedder } from '../../src/embed/embedder';
import { breakdownJobRegistrations } from '../../src/jobs/breakdown-handlers';
import { visionDetectCutsJob } from '../../src/jobs/breakdown-kinds';
import { probeSource } from '../../src/media/frames';
import { sceneScores } from '../../src/media/scene';
import { createConfirmCutsTool } from '../../src/tools/confirm-cuts-tool';
import { dissolvesOf, GOLDEN_IDS, goldenLabel, makeGoldenReel } from '../breakdown/golden-reel';
import { GEMINI, mutableSelector, scriptedClient, testRuntime, testToolContext } from '../helpers/fakes';
import { componentDir } from '../helpers/offline';
import { cutFrames, makeReel, testMedia, type Segment } from '../helpers/reel';
import { addScores, boundaryF1, type BoundaryScore } from '../helpers/score';

const { ctx } = await testMedia('breakdown-cuts');
const liveDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');
const cfg = VISION_CONFIG.cuts;

const FLASH = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,15)'";
const RAMP = "hue=b='min(4,max(0,(n-8)*0.4))'";
const PAN = "scale=2*iw:2*ih,crop=iw/2:ih/2:x='min(n*24,iw/2)':y=0";
const DISTRACTORS: Segment[] = [
  { source: 'gradients=c0=0x0d47a1:c1=0x00bcd4:speed=0', frames: 40, filter: FLASH },
  { source: 'testsrc2', frames: 50, filter: PAN },
  { source: 'rgbtestsrc', frames: 40 },
  { source: 'mandelbrot', frames: 45, filter: RAMP },
  { source: 'smptehdbars', frames: 30 },
];

interface Reel {
  readonly name: string;
  readonly path: string;
  /** Every labelled cut, hard and soft. */
  readonly cuts: readonly number[];
  readonly dissolves: readonly number[];
}

interface Run {
  readonly scdet: number[];
  readonly live?: CutList;
  readonly plain: CutList;
}

const frames = (cuts: readonly BreakdownCut[], keep: (c: BreakdownCut) => boolean = () => true) =>
  cuts.filter(keep).map((c) => c.frame);

describe.skipIf(!ctx)('breakdown cuts on synthetic reels', () => {
  let dir = '';
  let embedder: VisionEmbedder | undefined;
  const reels: Reel[] = [];
  const runs = new Map<string, Run>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-breakdown-cuts-'));
    if (liveDir) embedder = createEmbedder({ modelDir: liveDir });
    for (const id of GOLDEN_IDS) {
      const label = goldenLabel(id);
      const path = join(dir, `${id}.mp4`);
      await makeGoldenReel(ctx!, path, label);
      reels.push({ name: id, path, cuts: label.cuts, dissolves: dissolvesOf(label) });
    }
    const path = join(dir, 'distractors-25.mp4');
    await makeReel(ctx!, path, DISTRACTORS, { width: 360, height: 640, rate: '25' });
    reels.push({ name: 'distractors-25', path, cuts: cutFrames(DISTRACTORS), dissolves: [] });
  }, 180_000);
  afterAll(async () => {
    await embedder?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const detect = async (path: string, withEmbedder: boolean) => {
    const jobs = createDirectJobRunner(
      breakdownJobRegistrations({
        media: ctx!,
        tier: 'recommended',
        tempDir: dir,
        ...(withEmbedder && embedder ? { embedder } : {}),
      }),
    );
    const result = await jobs.run(visionDetectCutsJob, { path, sensitivity: 'normal' });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    return result.value;
  };

  for (const index of [0, 1, 2, 3]) {
    it(`detects the cuts of reel ${index + 1} of 4`, async () => {
      const reel = reels[index]!;
      const started = Date.now();
      const source = await probeSource(ctx!, reel.path);
      if (!source.ok) throw new Error(source.error.code);
      const samples = await sceneScores(ctx!, source.value, { every: 1, longSide: cfg.longSide });
      if (!samples.ok) throw new Error(`${samples.error.code}: ${samples.error.detail ?? ''}`);
      const scdet = proposals(samples.value, cfg.confirmScore)
        .filter((p) => !p.flashLike)
        .map((p) => p.frame);
      const live = embedder ? await detect(reel.path, true) : undefined;
      const liveMs = Date.now() - started;
      const plain = await detect(reel.path, false);
      runs.set(reel.name, { scdet, plain, ...(live ? { live } : {}) });
      const show = (list: CutList) =>
        list.cuts
          .map(
            (c) =>
              `${c.frame}${c.kind === 'soft' ? `~${c.transition ?? ''}` : ''}:${c.status[0]}` +
              `(${c.score?.toFixed(0) ?? '-'}/${c.distance?.toFixed(2) ?? '-'})`,
          )
          .join(' ');
      console.warn(
        `[vision] breakdown ${reel.name} (synthetic): labelled ${reel.cuts.join(' ')}` +
          (reel.dissolves.length ? ` (dissolves ${reel.dissolves.join(' ')})` : '') +
          `\n  live (${liveMs} ms): ${live ? show(live) : 'no embedding model'}\n  no embedder: ${show(plain)}`,
      );
      if (!live) return;
      const kept = (c: BreakdownCut) => c.status !== 'unverified';
      for (const cut of reel.cuts.filter((c) => !reel.dissolves.includes(c))) {
        expect(
          frames(live.cuts, kept).some((f) => Math.abs(f - cut) <= 2),
          `hard cut ${cut}`,
        ).toBe(true);
      }
      for (const at of reel.dissolves) {
        const soft = live.cuts.find((c) => c.kind === 'soft' && Math.abs(c.frame - at) <= 2);
        expect(soft, `dissolve at ${at}`).toMatchObject({ method: 'embedding', transition: 'dissolve' });
      }
    }, 300_000);
  }

  it('reports boundary F1 by method (synthetic numbers)', () => {
    expect(runs.size).toBe(reels.length);
    const methods: [string, (run: Run, reel: Reel) => number[] | undefined][] = [
      ['scdet alone (score ≥ confirmScore)', (run) => run.scdet],
      ['scdet only, settled (no embedder, no model)', (run) => frames(settleWithoutModel(run.plain.cuts))],
      [
        'two methods: confirmed only',
        (run) => run.live && frames(run.live.cuts, (c) => c.status === 'confirmed'),
      ],
      ['two methods: confirmed + disputed', (run) => run.live && frames(run.live.cuts)],
      [
        'two methods, settled (no vision model)',
        (run) => run.live && frames(settleWithoutModel(run.live.cuts)),
      ],
      [
        'two methods + oracle tie-break (upper bound, not a model)',
        (run, reel) =>
          run.live &&
          frames(
            run.live.cuts,
            (c) => c.status !== 'disputed' || reel.cuts.some((l) => Math.abs(l - c.frame) <= 2),
          ),
      ],
    ];
    const totals = new Map<string, BoundaryScore>();
    for (const [name, pick] of methods) {
      const scores = reels.flatMap((reel) => {
        const found = pick(runs.get(reel.name)!, reel);
        return found ? [boundaryF1(found, reel.cuts)] : [];
      });
      if (scores.length === 0) continue;
      const total = addScores(scores);
      totals.set(name, total);
      console.warn(
        `[vision] cut F1 (synthetic, ±2 frames) ${name}: ${total.f1.toFixed(3)} (P ${total.precision.toFixed(3)}, ` +
          `R ${total.recall.toFixed(3)}, TP ${total.truePositives}, FP ${total.falsePositives}, FN ${total.falseNegatives})`,
      );
    }
    if (embedder) expect(totals.get('two methods: confirmed + disputed')!.f1).toBeGreaterThanOrEqual(0.9);
  });

  it('sends the disputes to the vision model through vision.confirmCuts and applies its verdicts', async () => {
    const run = [...runs.values()].find((r) => (r.live ?? r.plain).cuts.some((c) => c.status === 'disputed'));
    if (!run) return;
    const list = run.live ?? run.plain;
    const reel = reels.find((r) => runs.get(r.name) === run)!;
    const disputed = list.cuts.filter((c) => c.status === 'disputed').slice(0, 24);
    const candidates = disputed.map((c) => c.at);
    // A scripted model (no real one in CI) that agrees with every row: this checks the plumbing, not accuracy.
    const models = scriptedClient((request) => {
      const rows = Number(/has (\d+) row/.exec(JSON.stringify(request.messages))?.[1] ?? 0);
      const text = JSON.stringify(
        Array.from({ length: rows }, (_, row) => ({ row, cut: true, transition: null })),
      );
      return [{ choice: GEMINI, local: false, outcome: { text } }];
    });
    const jobs = createDirectJobRunner(
      breakdownJobRegistrations({ media: ctx!, tier: 'recommended', tempDir: dir }),
    );
    const tool = createConfirmCutsTool(
      { jobs, models, selector: mutableSelector([GEMINI]), runtime: testRuntime() },
      'cloud',
    );
    const result = await tool.run({ path: reel.path, candidates }, testToolContext());
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect(result.value.uploadedTo).toEqual(['google']);
    expect(models.requests).toHaveLength(Math.ceil(candidates.length / VISION_CONFIG.strip.perSheet));
    const image = models.requests[0]!.messages[0]!;
    const data = 'content' in image && Array.isArray(image.content) ? image.content[1] : undefined;
    const jpeg = Buffer.from(data && 'data' in data ? data.data : '', 'base64');
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
    const verdicts = new Map(
      result.value.decisions.map((d) => [
        d.at.value,
        { cut: d.cut, ...(d.transition ? { transition: d.transition } : {}) },
      ]),
    );
    const applied = applyVerdicts(list.cuts, verdicts);
    expect(applied.filter((c) => c.status === 'disputed')).toEqual([]);
    expect(applied.filter((c) => c.method === 'vision')).toHaveLength(disputed.length);
    // With no model at all, the same disputes settle: strong hard ones and soft ones the pixels showed stay
    // as unverified, the rest go.
    for (const cut of settleWithoutModel(list.cuts).filter((c) => c.status === 'unverified')) {
      if (cut.kind === 'hard') expect(cut.score).toBeGreaterThanOrEqual(cfg.unverifiedKeepScore);
      else expect(cut.transition).toBeDefined();
    }
  }, 120_000);
});
