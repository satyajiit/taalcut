// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 through the real breakdown, on reels of two moving pictures made with the bundled FFmpeg
 * (testing/moving-reel.ts): joined by a dissolve, by a fade through black and by a hard cut. The dissolve and the
 * fade are found from pixels, the cut sits inside the transition, the slot that follows knows which of its frames
 * are blended, and what the Analyst is shown of each shot is the shot's own picture. FFmpeg stand-ins for the
 * vision lane (method B is a thumbnail, not EmbeddingGemma).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createManualClock, newId, templateSchema } from '@taalcut/core';
import {
  BREAKDOWN_PIPELINE_VERSION,
  buildTemplate,
  resolveCuts,
  runBreakdown,
  type BreakdownDraft,
} from '../../src/index';
import {
  createFfmpegAnalysers,
  MOVING_REEL,
  movingReelArgs,
  runProcess,
  type MovingReelJoin,
} from '../../src/test-support';
import { findFfmpeg } from '../helpers/ffmpeg';
import { json, sequentialIds } from '../helpers/fixtures';

const { bins, skip } = findFfmpeg('MATCH1 gradual transitions');
const root = mkdtempSync(join(tmpdir(), 'taalcut-match1-'));
const drafts = new Map<MovingReelJoin, BreakdownDraft>();

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function breakDown(kind: MovingReelJoin): Promise<BreakdownDraft> {
  const reel = join(root, `${kind}.mp4`);
  const made = await runProcess(bins!.ffmpeg, movingReelArgs(kind, reel));
  if (!made.ok) throw new Error(made.error.detail);
  const experimentDir = join(root, `exp-${kind}`);
  await mkdir(experimentDir, { recursive: true });
  const draft = await runBreakdown(
    { breakdownId: newId(), referencePath: reel, input: 'file', platform: null, url: null },
    { ...createFfmpegAnalysers(bins!), experimentDir, clock: createManualClock(1) },
    { signal: new AbortController().signal },
  );
  if (!draft.ok) throw new Error(`${draft.error.code}: ${draft.error.detail}`);
  return draft.value;
}

/** The frame number in a working frame's file name (`frame-000123.jpg`). */
const frameOf = (path: string) => Number(/^frame-(\d+)/.exec(basename(path))?.[1]);

describe.skipIf(Boolean(skip))('gradual transitions in a breakdown (MATCH1)', () => {
  beforeAll(async () => {
    for (const kind of ['dissolve', 'fadeBlack', 'cut'] as const) drafts.set(kind, await breakDown(kind));
  }, 600_000);

  it('finds the dissolve from pixels and puts the cut inside it', () => {
    const draft = drafts.get('dissolve')!;
    expect(draft.pipelineVersion).toBe(BREAKDOWN_PIPELINE_VERSION);
    expect(draft.warnings.filter((warning) => warning.startsWith('gradual'))).toEqual([]);
    const all = [...draft.cuts, ...draft.disputes];
    // One cut for the one transition: nothing else is proposed inside it or beside it.
    expect(all).toHaveLength(1);
    const [cut] = all;
    const { start, end } = MOVING_REEL.dissolve;
    expect(cut!.transition?.kind).toBe('dissolve');
    expect(cut!.frame).toBeGreaterThan(start);
    expect(cut!.frame).toBeLessThanOrEqual(end);
    // The blended frames are [frame - before, frame + after): every truly blended frame, and at most two more.
    const first = cut!.frame - cut!.transition!.before;
    const last = cut!.frame + cut!.transition!.after - 1;
    expect(first).toBeLessThanOrEqual(start);
    expect(first).toBeGreaterThanOrEqual(start - 2);
    expect(last).toBeGreaterThanOrEqual(end);
    expect(last).toBeLessThanOrEqual(end + 2);
  });

  it('records it on the template between the two slots, and the template parses', () => {
    const draft = drafts.get('dissolve')!;
    const { slots, cuts } = resolveCuts(draft, []);
    expect(slots).toHaveLength(2);
    const template = buildTemplate(draft, [], [], sequentialIds(), { createdAt: 1 });
    expect(template.ok).toBe(true);
    const value = template.ok ? template.value : (undefined as never);
    expect(templateSchema.safeParse(json(value)).success).toBe(true);
    const into = value.slots[1]!.transitionIn!;
    expect(into.kind).toBe('dissolve');
    expect(value.slots[1]!.start.value).toBe(cuts[0]!.frame);
    expect(into.before.value).toBe(cuts[0]!.transition!.before);
    expect(into.after.value).toBe(cuts[0]!.transition!.after);
    // The second slot's own picture starts `after` frames in: at the dissolve's end or just past it.
    const clean = value.slots[1]!.start.value + into.after.value;
    expect(clean).toBeGreaterThan(MOVING_REEL.dissolve.end);
    expect(value.slots[0]!.transitionIn).toBeNull();
  });

  it('shows the Analyst each shot’s own picture, never a blended frame', () => {
    const draft = drafts.get('dissolve')!;
    const [cut] = [...draft.cuts, ...draft.disputes];
    const first = cut!.frame - cut!.transition!.before;
    const last = cut!.frame + cut!.transition!.after - 1;
    for (const slot of draft.slotFrames)
      for (const frame of slot.frames.map(frameOf)) expect(frame < first || frame > last).toBe(true);
    // The first shot's last shown frame is just before the dissolve; the second's first is just after it.
    expect(frameOf(draft.slotFrames[0]!.frames.at(-1)!)).toBe(first - 1);
    expect(frameOf(draft.slotFrames[1]!.frames[0]!)).toBe(last + 1);
    for (const dispute of draft.disputes) {
      expect(frameOf(dispute.before)).toBe(first - 1);
      expect(frameOf(dispute.after)).toBe(last + 1);
      expect(existsSync(join(root, 'exp-dissolve', dispute.before))).toBe(true);
    }
  });

  it('finds the fade through black as a fade, the new shot starting where the picture comes back', () => {
    const draft = drafts.get('fadeBlack')!;
    const fades = [...draft.cuts, ...draft.disputes].filter((cut) => cut.transition?.kind === 'fade');
    expect(fades).toHaveLength(1);
    const [fade] = fades;
    expect(fade!.frame).toBeGreaterThanOrEqual(MOVING_REEL.join);
    expect(fade!.frame).toBeLessThanOrEqual(MOVING_REEL.join + 3);
    expect(fade!.frame - fade!.transition!.before).toBeLessThanOrEqual(MOVING_REEL.fade.start);
    expect(fade!.frame + fade!.transition!.after - 1).toBeGreaterThanOrEqual(MOVING_REEL.fade.end - 1);
    expect(resolveCuts(draft, []).slots).toHaveLength(2);
  });

  it('leaves a hard cut a hard cut, at its frame, with no transition', () => {
    const draft = drafts.get('cut')!;
    const { cuts } = resolveCuts(draft, []);
    expect(cuts.map((cut) => cut.frame)).toEqual([MOVING_REEL.join]);
    expect(cuts[0]!.transition).toBeNull();
  });
});
