// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the graphics checks on composition graphics, by what each draws at its moments (settled after its entrance,
 * and its middle), here from a stand-in DOM probe: a graphic partly outside the safe rect fails graphicsSafeZone,
 * one over a caption at the same frame fails graphicsOverlap, 20 px words on 1080×1920 fail graphicsReadability,
 * each with the Designer's fix (an agent fix for graphics.design), never a kit's resize. An unchanged graphic is
 * measured once: a later round reads the measurements' cache. No probe says so, skipped; a probe that failed fails.
 * The QA plan carries a placed graphic's composition from the timeline. Made-up words and designs.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRAPHICS_COMMANDS, unwrap, type QaCheckResult, type Rect } from '@taalcut/core';
import { planQa } from '../../src/plan/qa-plan';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor, safeRectFor } from '../../src/presets/presets.v1';
import { capShareOf, graphicMoments } from '../../src/qa/checks/graphics';
import { createGraphicMeasureCache, type GraphicMeasureCache } from '../../src/qa/graphic-measures';
import { QA_MODULES } from '../../src/qa/modules';
import { graphicsQaModule } from '../../src/qa/modules/graphics';
import type { ProbedTextBox, QaGraphic, QaPlan } from '../../src/types';
import { spokenTimeline } from '../compositions/support';
import { workspaceWorld } from '../workspace/tools/support';
import { qaPlan, rate30, runInput } from './support';

const INSIDE: Rect = { x: 200, y: 400, width: 400, height: 120 };
const WANTED = new Set(['graphicsSafeZone', 'graphicsOverlap', 'graphicsReadability'] as const);

const graphic = (id: string, span = { start: 0, end: 90 }, words = 'Made-up words'): QaGraphic => ({
  id,
  span,
  compositionId: 'made-up-card',
  hash: 'c'.repeat(64),
  params: { words },
});

const drawn = (id: string, frame: number, box: Rect, minFontPx = 64): ProbedTextBox => ({
  kind: 'graphic',
  id,
  frame,
  box,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
  minFontPx,
  minFontFamily: 'sans-serif',
});

const caption = (frame: number, box: Rect): ProbedTextBox => ({
  kind: 'caption',
  id: 'cue-1',
  frame,
  box,
  lines: 1,
  overflow: false,
  fontsReady: true,
  color: '#ffffff',
});

/** A stand-in probe that draws `at(frame)` at each frame, and records what it was asked for. */
function probe(at: (frame: number) => ProbedTextBox[]) {
  const asked: number[][] = [];
  return {
    asked,
    probeFrame: async (frames: readonly number[]) => {
      asked.push([...frames]);
      return { boxes: frames.flatMap(at), visuals: [] };
    },
  };
}

/** The module as runQa runs it: its frames, the probe over them, its checks. */
async function check(plan: QaPlan, stand?: ReturnType<typeof probe>, cache?: GraphicMeasureCache) {
  const run = runInput('/nonexistent/render.mp4', plan, {
    preset: { ...presetFor('device'), safe: safeRectFor([]) },
    ...(stand ? { probeFrame: stand.probeFrame } : {}),
    ...(cache ? { graphicMeasures: cache } : {}),
  });
  const frames = graphicsQaModule.probeFrames({ run, facts: {} });
  const probed = stand && frames.length > 0 ? await stand.probeFrame(frames) : null;
  const results = await graphicsQaModule.run({ run, facts: {}, probed }, WANTED);
  const byId = Object.fromEntries(results.map((result) => [result.id, result])) as Record<
    string,
    QaCheckResult
  >;
  return { frames, byId };
}

const statuses = (byId: Record<string, QaCheckResult>) => [
  byId.graphicsSafeZone?.status,
  byId.graphicsOverlap?.status,
  byId.graphicsReadability?.status,
];

describe('the graphics checks on composition graphics (HFW1)', () => {
  it('is one of QA’s modules, and measures each graphic settled after its entrance and in its middle', () => {
    expect(QA_MODULES).toContain(graphicsQaModule);
    expect(graphicMoments({ start: 0, end: 90 }, rate30)).toEqual([15, 45]);
    expect(graphicMoments({ start: 30, end: 50 }, rate30)).toEqual([35, 40]);
    expect(capShareOf('sans-serif')).toBe(0.7);
  });

  it('passes a graphic inside the safe rect, clear of the captions, with words at the floor', async () => {
    const { byId } = await check(
      qaPlan({ durationFrames: 90, graphics: [graphic('G1')] }),
      probe((frame) => [drawn('G1', frame, INSIDE)]),
    );
    expect(statuses(byId)).toEqual(['pass', 'pass', 'pass']);
  });

  it('fails a graphic placed partly outside the safe rect, with the Designer’s fix', async () => {
    const { byId } = await check(
      qaPlan({ durationFrames: 90, graphics: [graphic('G1')] }),
      probe((frame) => [drawn('G1', frame, { ...INSIDE, x: 60 })]),
    );
    const safe = byId.graphicsSafeZone!;
    expect(safe.status).toBe('fail');
    // The explicit cross-post safe rect starts at x 120, less the 2 px tolerance.
    expect(safe.measured).toEqual({ value: 58, unit: 'px' });
    expect(safe.findings.map((finding) => finding.frames?.start)).toEqual([15, 45]);
    expect(safe.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.moveGraphic', params: { itemId: 'G1' } },
    ]);
  });

  it('fails a graphic that draws nothing where it should be settled', async () => {
    const { byId } = await check(
      qaPlan({ durationFrames: 90, graphics: [graphic('G1')] }),
      probe(() => []),
    );
    expect(byId.graphicsSafeZone?.status).toBe('fail');
  });

  it('fails a graphic over a caption at the same frame, and passes one clear of it', async () => {
    const cues = [{ id: 'cue-1', span: { start: 0, end: 90 }, probeFrames: [45] }];
    const low = { x: 200, y: 1000, width: 400, height: 120 };
    const over = await check(
      qaPlan({ durationFrames: 90, cues, graphics: [graphic('G1')] }),
      probe((frame) => [
        drawn('G1', frame, low),
        caption(frame, { x: 150, y: 1060, width: 500, height: 80 }),
      ]),
    );
    expect(over.byId.graphicsOverlap?.status).toBe('fail');
    expect(over.byId.graphicsOverlap?.fixes).toEqual([
      { kind: 'agent', instructionKey: 'qa.fixes.moveGraphic', params: { itemId: 'G1' } },
    ]);
    const clear = await check(
      qaPlan({ durationFrames: 90, cues, graphics: [graphic('G1')] }),
      probe((frame) => [
        drawn('G1', frame, INSIDE),
        caption(frame, { x: 150, y: 1060, width: 500, height: 80 }),
      ]),
    );
    expect(clear.byId.graphicsOverlap?.status).toBe('pass');
  });

  it('fails 20 px words on 1080×1920 and asks the Designer for larger ones', async () => {
    const { byId } = await check(
      qaPlan({ durationFrames: 90, graphics: [graphic('G1')] }),
      probe((frame) => [drawn('G1', frame, INSIDE, 20)]),
    );
    const read = byId.graphicsReadability!;
    expect(read.status).toBe('fail');
    expect(read.threshold).toEqual({ min: 36, unit: 'px' });
    expect(read.measured).toEqual({ value: 14, unit: 'px' });
    expect(read.fixes).toEqual([
      {
        kind: 'agent',
        instructionKey: 'qa.fixes.largerGraphicWords',
        params: { itemId: 'G1', minCapPx: 36 },
      },
    ]);
  });

  it('fails a graphic on for less than a second, with a ready graphics.edit of its length', async () => {
    const { byId } = await check(
      qaPlan({ durationFrames: 90, graphics: [graphic('G1', { start: 0, end: 20 })] }),
      probe((frame) => [drawn('G1', frame, INSIDE)]),
    );
    expect(byId.graphicsReadability?.status).toBe('fail');
    expect(byId.graphicsReadability?.fixes[0]).toMatchObject({
      kind: 'command',
      command: GRAPHICS_COMMANDS.edit,
      payload: { itemId: 'G1', duration: { value: 1200 } },
    });
  });

  it('measures an unchanged graphic once; a change of words, or a caption beside it, is read again', async () => {
    const cache = createGraphicMeasureCache();
    const stand = probe((frame) => [drawn('G1', frame, { ...INSIDE, x: 60 })]);
    const first = await check(qaPlan({ durationFrames: 300, graphics: [graphic('G1')] }), stand, cache);
    expect(first.frames).toEqual([15, 45]);
    // Later, on another export, the same design with the same words and length, somewhere else on the timeline.
    const again = await check(
      qaPlan({ durationFrames: 300, graphics: [graphic('G1', { start: 120, end: 210 })] }),
      stand,
      cache,
    );
    expect(again.frames).toEqual([]);
    expect(stand.asked).toHaveLength(1);
    expect(statuses(again.byId)).toEqual(statuses(first.byId));
    expect(again.byId.graphicsSafeZone?.findings.map((finding) => finding.frames?.start)).toEqual([135, 165]);
    const reworded = await check(
      qaPlan({
        durationFrames: 300,
        graphics: [graphic('G1', { start: 0, end: 90 }, 'Other made-up words')],
      }),
      stand,
      cache,
    );
    expect(reworded.frames).toEqual([15, 45]);
    const cues = [{ id: 'cue-1', span: { start: 40, end: 60 }, probeFrames: [50] }];
    const beside = await check(
      qaPlan({ durationFrames: 300, cues, graphics: [graphic('G1')] }),
      stand,
      cache,
    );
    expect(beside.frames).toEqual([45]);
  });

  it('says it had no probe, skipped; a probe that couldn’t read the frames fails with a re-render', async () => {
    const plan = qaPlan({ durationFrames: 90, graphics: [graphic('G1')] });
    const none = await check(plan);
    expect(statuses(none.byId)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(none.byId.graphicsSafeZone?.findings).toEqual([{ target: { kind: 'file', id: 'domProbe' } }]);
    const run = runInput('/nonexistent/render.mp4', plan, {
      probeFrame: () => Promise.reject(new Error('made-up capture fault')),
    });
    const failed = await graphicsQaModule.run({ run, facts: {}, probed: null }, WANTED);
    expect(failed.map((result) => [result.status, result.fixes])).toEqual(
      Array.from({ length: 3 }, () => ['fail', [{ kind: 'auto', action: 'rerender' }]]),
    );
    const empty = await graphicsQaModule.run(
      { run: runInput('/nonexistent/render.mp4', qaPlan()), facts: {}, probed: null },
      WANTED,
    );
    expect(empty.map((result) => result.status)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('the QA plan carries a used graphic’s composition, its params and its frames', async () => {
    const timeline = spokenTimeline([[10, 60, 'see you at the lake']]);
    const world = workspaceWorld(timeline);
    const html = await readFile(
      join(import.meta.dirname, '..', 'workspace', 'tools', 'fixtures', 'bubble.html'),
      'utf8',
    );
    unwrap(
      await world.call('workspace.write', {
        projectId: world.projectId,
        path: 'bubble/index.html',
        text: html,
      }),
    );
    const placed = unwrap(
      await world.call('workspace.place', {
        projectId: world.projectId,
        timelineId: timeline.id,
        revision: timeline.revision,
        entry: 'bubble/index.html',
        name: 'Made-up bubble',
        request: 'a bubble',
        at: 0.4,
      }),
    ) as { itemIds: string[] };
    const before = unwrap(await world.store.get(timeline.id));
    unwrap(
      await world.bus.dispatch(
        GRAPHICS_COMMANDS.useProposal,
        {
          projectId: timeline.projectId,
          timelineId: timeline.id,
          revision: before.revision,
          itemId: placed.itemIds[0],
        },
        { source: 'ui', actor: 'user' },
      ),
    );
    const used = unwrap(await world.store.get(timeline.id));
    const [composition] = used.graphicCompositions ?? [];
    const qa = planQa(unwrap(planTimeline(used)), presetFor('device'));
    expect(qa.graphics).toEqual([
      {
        id: placed.itemIds[0],
        span: { start: 12, end: expect.any(Number) as number },
        compositionId: composition?.id,
        hash: composition?.hash,
        params: expect.any(Object) as object,
      },
    ]);
  });
});
