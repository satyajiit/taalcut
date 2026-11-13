// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: video.compare puts the newest draft next to the reel, slot by slot, as sheets a model sees, with each
 * slot's facts; the draft's frames only where the person's frames may go; a judge per slot when asked.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, ok, type ArtifactRef } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { videoCompareTool } from '../../src/eyes/compare-tool';
import type { EyesDeps } from '../../src/eyes/deps';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { eyesContext, runTool } from './support';
import { draftRecord, eyesDeps, madeUpFiles, madeUpTemplate, madeUpTimeline } from './world';

const media = await findTestMedia('video.compare');
const SHEETS = process.env.TAALCUT_EYES_SHEETS;
const SHOWN = async () => ({ shown: true, why: 'On this Mac.' });
const KEPT = async () => ({ shown: false, why: 'No standing upload consent for the cloud model.' });

interface Out {
  draft: { renderId: string; revision: number; newest: boolean } | null;
  reel: boolean;
  pictures: { footage: string };
  sheets: { image: ArtifactRef; columns: string[]; rows: { slot: number; moment: string }[] }[];
  slots: {
    slot: number;
    clip: number | null;
    needs: string[];
    face: string | null;
    draft: { at: number; seconds: number } | null;
    frames: {
      moment: string;
      reelSeconds: number | null;
      draftSeconds: number | null;
      reelImage: string | null;
      draftImage: string | null;
    }[];
    judged?: unknown;
  }[];
  left: number[];
  note: string;
}

describe.skipIf(!media.binaries)('video.compare', { timeout: 180_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let files: { reel: string; draft: string };
  const ctx = () => mediaContext(media.binaries!);
  const template = madeUpTemplate();
  const timeline = madeUpTimeline(template);

  const world = (overrides: Partial<EyesDeps> = {}, renders = [draftRecord(timeline, files.draft)]) =>
    eyesDeps({ media: ctx(), scratch: work.dir, template, timeline, renders, reel: files.reel, overrides });
  const compare = async (deps: EyesDeps, input: Record<string, unknown> = {}) => {
    const tool = videoCompareTool(deps);
    const { ctx: context, stored } = eyesContext();
    const run = await runTool(
      tool,
      { projectId: timeline.projectId, timelineId: timeline.id, ...input },
      context,
    );
    if (!run.ok) throw new Error(run.error.detail ?? run.error.code);
    const images = tool.images?.(run.value as never) ?? [];
    // TAALCUT_EYES_SHEETS=<dir> writes the sheets there, to look at.
    if (SHEETS)
      for (const image of images)
        await writeFile(join(SHEETS, `${image.id}.jpg`), stored.get(image.id)!.data);
    return { out: run.value as unknown as Out, images };
  };

  beforeAll(async () => {
    work = await tempDir('eyes-compare');
    files = await madeUpFiles(ctx(), work.dir);
  });
  afterAll(async () => {
    await work?.dispose();
  });

  it('shows every slot’s middle, the reel left and the draft right, with the slots’ facts', async () => {
    const { out, images } = await compare(world({ pictures: SHOWN }));
    expect(out.draft).toMatchObject({ revision: timeline.revision, newest: true });
    expect(out.reel).toBe(true);
    expect(out.pictures.footage).toBe('shown');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]).toMatchObject({
      columns: ['reel', 'draft'],
      rows: [
        { slot: 1, moment: 'middle' },
        { slot: 2, moment: 'middle' },
      ],
    });
    expect(images).toEqual([out.sheets[0]!.image]);
    expect(out.sheets[0]!.image.mediaType).toBe('image/jpeg');
    const [first, second] = out.slots;
    expect(first).toMatchObject({
      slot: 1,
      clip: 1,
      needs: ['a made-up prop in hand'],
      face: 'hidden',
      draft: { at: 0, seconds: 1.5 },
    });
    expect(first!.frames).toEqual([
      expect.objectContaining({
        moment: 'middle',
        reelSeconds: 0.75,
        draftSeconds: 0.75,
        reelImage: expect.any(String),
        draftImage: expect.any(String),
      }),
    ]);
    expect(second!.frames[0]).toMatchObject({ reelSeconds: 2.25, draftSeconds: 2.25 });
    expect(out.left).toEqual([]);
    expect(out.note).toContain('reel on the left, draft on the right');
  });

  it('shows one slot at its start, middle and end; the reel alone where the person’s frames stay here', async () => {
    const { out, images } = await compare(world({ pictures: KEPT }), { slots: [2] });
    expect(out.pictures.footage).toBe('kept');
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]!.columns).toEqual(['reel']);
    expect(out.sheets[0]!.rows.map((row) => row.moment)).toEqual(['start', 'middle', 'end']);
    expect(images).toHaveLength(1);
    expect(out.slots.map((slot) => slot.slot)).toEqual([2]);
    expect(out.slots[0]!.frames.map((frame) => frame.reelSeconds)).toEqual([1.65, 2.25, 2.85]);
    // The draft's frames are still artifacts on this Mac, to describe (which asks) or draw over.
    expect(out.slots[0]!.frames.every((frame) => frame.draftImage !== null)).toBe(true);
    expect(out.note).toContain('No standing upload consent');
  });

  it('shows the reel and the facts before the first draft, and leaves out slots the template has not', async () => {
    const { out } = await compare(world({ pictures: SHOWN }, []), { slots: [1, 5] });
    expect(out.draft).toBeNull();
    expect(out.sheets[0]!.columns).toEqual(['reel']);
    expect(
      out.slots[0]!.frames.every((frame) => frame.draftSeconds === null && frame.draftImage === null),
    ).toBe(true);
    expect(out.left).toEqual([5]);
    expect(out.note).toContain('No draft yet');
  });

  it('judges each slot where the person’s frames may go, and says why not elsewhere', async () => {
    const seen: number[] = [];
    const judge: EyesDeps['judge'] = async ({ facts, pairs }) => {
      seen.push(pairs.length);
      return ok({
        matches: facts.slot === 2,
        differences: facts.slot === 2 ? [] : ['the face shows where the slot keeps it out'],
        by: 'made-up/judge',
      });
    };
    const judged = await compare(world({ pictures: SHOWN, judge }), { judge: true });
    expect(seen).toEqual([1, 1]);
    expect(judged.out.slots.map((slot) => slot.judged)).toEqual([
      { matches: false, differences: ['the face shows where the slot keeps it out'], by: 'made-up/judge' },
      { matches: true, differences: [], by: 'made-up/judge' },
    ]);
    const kept = await compare(world({ pictures: KEPT, judge }), { judge: true, slots: [1] });
    expect(kept.out.slots[0]!.judged).toMatch(/^Not judged: No standing upload consent/);
    const none = await compare(world({ pictures: SHOWN }), { judge: true, slots: [1] });
    expect(none.out.slots[0]!.judged).toMatch(/No vision judge here/);
  });

  it('refuses a timeline made without a template, and says so when FFmpeg is missing', async () => {
    const loose = { ...timeline, template: null };
    const tool = videoCompareTool(
      eyesDeps({ media: ctx(), scratch: work.dir, template, timeline: loose, renders: [], reel: files.reel }),
    );
    const refused = await runTool(
      tool,
      { projectId: timeline.projectId, timelineId: timeline.id },
      eyesContext().ctx,
    );
    expect(refused.ok ? null : refused.error.code).toBe('core.validation');
    const blind = await compare(world({ pictures: SHOWN, media: async () => null }));
    expect(blind.out.sheets).toEqual([]);
    expect(blind.out.slots).toHaveLength(2);
    expect(blind.out.note).toContain('FFmpeg is not available');
  });

  it('compares the render asked for, and says when it shows an older revision', async () => {
    const older = draftRecord(timeline, files.draft, timeline.revision);
    const newer = { ...timeline, revision: timeline.revision + 1 };
    const deps = eyesDeps({
      media: ctx(),
      scratch: work.dir,
      template,
      timeline: newer,
      renders: [older],
      reel: files.reel,
    });
    const tool = videoCompareTool({ ...deps, pictures: SHOWN });
    const run = await runTool(
      tool,
      { projectId: timeline.projectId, timelineId: timeline.id, renderId: older.id, slots: [1] },
      eyesContext().ctx,
    );
    if (!run.ok) throw new Error(run.error.code);
    const out = run.value as unknown as Out;
    expect(out.draft).toMatchObject({ renderId: older.id, newest: false });
    expect(out.note).toContain(`revision ${timeline.revision}`);
    const wrong = await runTool(
      tool,
      { projectId: timeline.projectId, timelineId: timeline.id, renderId: newId<'Render'>() },
      eyesContext().ctx,
    );
    expect(wrong.ok).toBe(false);
    // A pre-render QA stop on this timeline has no filePath yet; compare falls back instead of failing.
    const preRenderStop = { ...draftRecord(timeline, null as unknown as string), filePath: null };
    const fallbackDeps = eyesDeps({
      media: ctx(),
      scratch: work.dir,
      template,
      timeline: newer,
      renders: [older, preRenderStop],
      reel: files.reel,
    });
    const fallbackRun = await runTool(
      videoCompareTool({ ...fallbackDeps, pictures: SHOWN }),
      { projectId: timeline.projectId, timelineId: timeline.id, renderId: preRenderStop.id, slots: [1] },
      eyesContext().ctx,
    );
    expect(fallbackRun.ok).toBe(true);
    if (fallbackRun.ok) {
      expect((fallbackRun.value as unknown as Out).draft).toMatchObject({ renderId: older.id });
    }
  });
});
