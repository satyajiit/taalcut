// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl: the make's frame checks on made-up footage. A composition two graphics draw with is drawn over each
 * one's footage with its own words; a head under it, a box past the safe rect and the render's own failed checks go
 * back to the Designer (a stand-in) with the frames, and the next version is checked again over both. With no
 * Designer the failures stand, and nothing is resized or moved by anything else.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  RationalTime,
  type Box,
  type GraphicItem,
  type Timeline,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import { checkFills, fillMoments } from '../../../src/workspace/fill/check-fills';
import { compositionBriefs } from '../../../src/workspace/template/brief';
import type { DesignJob, DesignOverlay } from '../../../src/workspace/template/designer';
import { makeTimeline } from '../../support/timeline';
import { madeUpReel } from '../template/reel-fixture';
import { fixtureComposition } from '../template/stand-in';

const rate = { num: 30, den: 1 };
const HEAD: Box = { x: 0.05, y: 0.36, width: 0.3, height: 0.12 };
const SAFE: Box = { x: 0.05, y: 0.08, width: 0.85, height: 0.8 };

async function world() {
  const { composition } = await fixtureComposition('incoming-bubble.html');
  const graphic = (start: number, words: string): GraphicItem => ({
    type: 'graphic',
    id: newId<'TimelineItem'>(),
    anchor: { kind: 'time', at: RationalTime.of(start, rate) },
    start: RationalTime.of(start, rate),
    duration: RationalTime.of(90, rate),
    placement: { box: { x: 0.06, y: 0.38, width: 0.43, height: 0.045 } },
    styleKey: 'caption',
    language: 'en',
    origin: 'agent',
    composition: { id: composition.id, hash: composition.hash, params: { text: words } },
  });
  const base = makeTimeline({ items: [{ frames: 300 }] });
  const items = [graphic(30, 'Made-up question for you, ok?'), graphic(150, 'Another made-up line')];
  const timeline: Timeline = {
    ...base,
    tracks: [...base.tracks, { kind: 'text', id: 'T1', name: 'T1', enabled: true, items }],
    graphicCompositions: [composition],
  };
  return { timeline, composition, items };
}

describe('the make’s frame checks (HFW1 tpl)', () => {
  it('sends a head under the design back to the Designer with the frames, and checks the next version again', async () => {
    const { timeline, composition, items } = await world();
    const asked: WorkspaceFramesInput[] = [];
    let version = 1;
    const frames = async (input: WorkspaceFramesInput) => {
      asked.push(input);
      const seconds = input.seconds;
      // The first design sits on the head; the next one sits below it.
      const box =
        version === 1
          ? { x: 0.06, y: 0.38, width: 0.6, height: 0.05 }
          : { x: 0.06, y: 0.55, width: 0.6, height: 0.05 };
      return ok({
        frames: seconds.map((at) => ({
          seconds: at,
          mimeType: 'image/jpeg' as const,
          dataBase64: '/9j/AA==',
          width: 432,
          height: 768,
          box,
        })),
        checks: [{ id: 'bounds', status: 'pass' as const }],
        ms: 4,
      });
    };
    const jobs: DesignJob[] = [];
    const design: DesignOverlay = async (job) => {
      jobs.push(job);
      version++;
      const next = await fixtureComposition('incoming-bubble.html');
      return ok({ designed: { composition: next.composition, params: {} } });
    };
    const { template } = madeUpReel();
    const result = await checkFills(timeline, {
      projectId: newId<'Project'>(),
      frames,
      scene: { heads: (frame) => (frame < 120 ? [HEAD] : []), safe: SAFE },
      design,
      briefFor: () => compositionBriefs(template)[0]!,
    });
    // Each graphic drawn over its own footage with its own words, settled and in its middle.
    expect(asked[0]).toMatchObject({
      over: { kind: 'footage', timelineId: timeline.id, start: 1 },
      params: { text: 'Made-up question for you, ok?' },
      seconds: fillMoments(items[0]!, composition),
    });
    expect(asked[1]).toMatchObject({ over: { start: 5 }, params: { text: 'Another made-up line' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.feedback!.reason).toMatch(/covers a person's head/);
    expect(jobs[0]!.feedback!.reason).toMatch(/Keep its variables and their names/);
    expect(jobs[0]!.feedback!.frames[0]!.label).toMatch(/over the made video's footage/);
    expect(result.redesigns).toHaveLength(1);
    expect(result.redesigns[0]!.itemIds).toEqual(items.map((item) => item.id));
    expect(result.redesigns[0]!.composition).toMatchObject({ id: composition.id, version: 2 });
    expect(result.findings).toEqual([]);
    expect(result.checked).toBe(2);
  });

  it('keeps the failures, the safe rect’s and the render’s, when there is no Designer', async () => {
    const { timeline } = await world();
    const frames = async (input: WorkspaceFramesInput) =>
      ok({
        frames: input.seconds.map((at) => ({
          seconds: at,
          mimeType: 'image/jpeg' as const,
          dataBase64: '/9j/AA==',
          width: 432,
          height: 768,
          box: { x: 0.5, y: 0.5, width: 0.48, height: 0.05 },
        })),
        checks: [
          { id: 'contrast', status: 'fail' as const, detail: 'Words #ffffff on #f0f0f0: darken the words' },
        ],
        ms: 4,
      });
    const result = await checkFills(timeline, {
      projectId: newId<'Project'>(),
      frames,
      scene: { heads: () => [], safe: SAFE },
    });
    expect(result.redesigns).toEqual([]);
    expect([...new Set(result.findings.map((finding) => finding.check))]).toEqual(['contrast', 'safeRect']);
    expect(result.findings.find((finding) => finding.check === 'safeRect')!.detail).toMatch(
      /outside the safe area/,
    );
  });
});
