// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * eval:design's stand-in run (HFW1 dsn): a new graphic and a comment's redesign through the Designer loop end to
 * end, placed and replaced, accepted by the Designer's own check at handoff, gated again from the stored files and
 * scored; a report that misses the bar says so; the refusal codes are counted.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DESIGN_VIDEO, designCases } from '../../src/design/cases';
import { standInFrames } from '../../src/design/frames';
import { designReport } from '../../src/design/report';
import { runDesignCase } from '../../src/design/run';
import { standInDesigner } from '../../src/design/stand-in';
import { designWorld } from '../../src/design/world';
import { madeUpVideo } from '../../src/design/video';

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function run(id: string) {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-design-eval-'));
  roots.push(root);
  const [entry] = designCases([id]);
  const initial = madeUpVideo({ clips: [...DESIGN_VIDEO.clips], captions: DESIGN_VIDEO.captions.map((cue) => [...cue] as const) });
  const world = await designWorld(entry!, { root, initial, timelines: new Map(), frames: standInFrames });
  return { world, outcome: await runDesignCase(entry!, world, standInDesigner(entry!, world.input, world.before?.entry)) };
}

describe('eval:design with the stand-in', () => {
  it('places a new graphic and replaces a commented one, each accepted at handoff', async () => {
    const fresh = await run('countdown');
    expect(fresh.outcome).toMatchObject({ pass: true, kind: 'new', placed: true, gatePassed: true, gateEscape: false, renders: 1 });
    expect(fresh.world.handoffs[0]?.results[0]?.outcome).toBe('placed');
    const comment = await run('comment-rounder');
    expect(comment.outcome).toMatchObject({ pass: true, kind: 'redesign', placed: true });
    expect(comment.world.replies).toHaveLength(1);
    const report = designReport('stand-in', [fresh.outcome, comment.outcome]);
    expect(report).toMatchObject({ passed: 2, passRate: 1, gateEscapes: 0, medianRenders: 1, meetsBar: true });
  });

  it('misses the bar on a failed case, and counts its refusal codes', () => {
    const failed = {
      id: 'x',
      request: 'x',
      kind: 'new' as const,
      pass: false,
      why: 'no accepted handoff (turns)',
      placed: false,
      gatePassed: false,
      gateEscape: false,
      failedChecks: [],
      renders: 9,
      turns: 30,
      ms: 1,
      refusals: ['lower.repeat', 'lower.repeat', 'hf.lint'],
      stopped: 'turns' as const,
      stills: [],
      reply: '',
      calls: [],
    };
    const report = designReport('x', [failed]);
    expect(report.meetsBar).toBe(false);
    expect(report.topRefusals).toEqual([
      { code: 'lower.repeat', count: 2 },
      { code: 'hf.lint', count: 1 },
    ]);
  });
});
