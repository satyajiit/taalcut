// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: library.frameAt shows any clip at any second; library.subjects says where people are in it. */
import {
  err,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  FrameRate,
  type SubjectSample,
  type SubjectSource,
} from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameAtTool, subjectsTool } from '../../src/eyes/library-tools';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { eyesContext, runTool } from './support';
import { madeUpFiles } from './world';

const media = await findTestMedia('library.frameAt');

describe.skipIf(!media.binaries)('library.frameAt', { timeout: 120_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let clip: string;
  const assetId = newId<'Asset'>();
  const ctx = () => mediaContext(media.binaries!);
  const original = async () => ok({ path: clip, size: 1, mtimeMs: 0 });

  beforeAll(async () => {
    work = await tempDir('eyes-frame-at');
    clip = (await madeUpFiles(ctx(), work.dir)).reel;
  });
  afterAll(async () => {
    await work?.dispose();
  });

  it('returns the clip at a second as a picture where the person’s frames may go', async () => {
    const tool = frameAtTool({
      assets: { original },
      media: async () => ctx(),
      pictures: async () => ({ shown: true, why: 'On this Mac.' }),
    });
    const run = await runTool(tool, { assetId, seconds: 1.2, maxDimension: 256 }, eyesContext().ctx);
    if (!run.ok) throw new Error(run.error.detail ?? run.error.code);
    expect(run.value).toMatchObject({
      assetId,
      seconds: 1.2,
      width: 144,
      height: 256,
      pictures: { footage: 'shown' },
    });
    expect(tool.images?.(run.value as never)).toEqual([run.value.image]);
  });

  it('keeps it here otherwise, and says why it can’t when the clip is offline or FFmpeg missing', async () => {
    const kept = frameAtTool({ assets: { original }, media: async () => ctx() });
    const run = await runTool(kept, { assetId, seconds: 0 }, eyesContext().ctx);
    if (!run.ok) throw new Error(run.error.code);
    expect(kept.images?.(run.value as never)).toEqual([]);
    const offline = frameAtTool({ assets: { original: async () => ok(null) }, media: async () => ctx() });
    const gone = await runTool(offline, { assetId, seconds: 0 }, eyesContext().ctx);
    expect(gone.ok ? null : gone.error.code).toBe('core.not_found');
    const blind = frameAtTool({ assets: { original }, media: async () => null });
    const none = await runTool(blind, { assetId, seconds: 0 }, eyesContext().ctx);
    expect(none.ok ? null : none.error.code).toBe('core.not_implemented');
  });
});

const ms = FrameRate.of(1000);
const sample = (seconds: number, source: 'detect' | 'track', face: boolean): SubjectSample => ({
  t: RationalTime.fromSeconds(seconds, ms),
  source,
  faces: face
    ? [{ box: { x: 0.41234, y: 0.2, width: 0.2, height: 0.12 }, confidence: 0.9, roll: 0, yaw: 0, pitch: 0 }]
    : [],
  humans: [],
  saliency: [],
  ...(source === 'detect'
    ? {
        heads: face ? [{ box: { x: 0.4, y: 0.18, width: 0.22, height: 0.15 }, confidence: 0.9 }] : [],
        people: [{ box: { x: 0.3, y: 0.15, width: 0.4, height: 0.8 }, confidence: 0.9 }],
      }
    : {}),
  subject: {
    kind: face ? 'face' : 'human',
    box: { x: 0.3, y: 0.15, width: 0.4, height: 0.8 },
    focus: null,
    confidence: 0.8,
  },
});

describe('library.subjects', () => {
  const assetId = newId<'Asset'>();
  const span = {
    frame: { width: 1080, height: 1920 },
    detector: 'vision' as const,
    samples: Array.from({ length: 40 }, (_, index) =>
      sample(index * 0.25, index % 2 === 0 ? 'detect' : 'track', index < 20),
    ),
  };

  it('reads the stored track, detect samples spread evenly, boxes as shares', async () => {
    const tool = subjectsTool({
      subjects: { over: async () => ok(span), ensure: async () => ok(undefined) },
    });
    const run = await runTool(tool, { assetId, from: 0, to: 10, samples: 4 }, eyesContext().ctx);
    if (!run.ok) throw new Error(run.error.code);
    const out = run.value as {
      track: string;
      frame: unknown;
      samples: { t: number; faces: unknown[]; heads: unknown[] }[];
    };
    expect(out.track).toBe('stored');
    expect(out.frame).toEqual({ width: 1080, height: 1920 });
    expect(out.samples.map((s) => s.t)).toEqual([0, 2.5, 5, 7.5]);
    expect(out.samples[0]!.faces).toEqual([{ x: 0.412, y: 0.2, width: 0.2, height: 0.12 }]);
    expect(out.samples[0]!.heads).toHaveLength(1);
    expect(out.samples[3]!.faces).toEqual([]);
  });

  it('makes the track when none covers the stretch, and says when it can’t', async () => {
    let made = false;
    const source: SubjectSource = {
      over: async () => ok(made ? span : undefined),
      ensure: async () => {
        made = true;
        return ok(undefined);
      },
    };
    const run = await runTool(
      subjectsTool({ subjects: source }),
      { assetId, from: 2, to: 4 },
      eyesContext().ctx,
    );
    if (!run.ok) throw new Error(run.error.code);
    expect(run.value).toMatchObject({ track: 'made' });
    const failing: SubjectSource = {
      over: async () => ok(undefined),
      ensure: async () => err(NotFoundError({ entity: 'subjectTracker' })),
    };
    const none = await runTool(
      subjectsTool({ subjects: failing }),
      { assetId, from: 0, to: 1 },
      eyesContext().ctx,
    );
    if (!none.ok) throw new Error(none.error.code);
    expect(none.value).toMatchObject({
      track: 'none',
      samples: [],
      note: expect.stringContaining('core.not_found'),
    });
    const unread = await runTool(
      subjectsTool({ subjects: failing }),
      { assetId, from: 0, to: 1, make: false },
      eyesContext().ctx,
    );
    if (!unread.ok) throw new Error(unread.error.code);
    expect(unread.value).toMatchObject({ track: 'none', note: expect.stringContaining('make: true') });
  });

  it('refuses a stretch past the cap or backwards', async () => {
    const tool = subjectsTool({
      subjects: { over: async () => ok(span), ensure: async () => ok(undefined) },
    });
    for (const range of [
      { from: 5, to: 4 },
      { from: 0, to: 61 },
    ]) {
      const run = await runTool(tool, { assetId, ...range }, eyesContext().ctx);
      expect(run.ok ? null : run.error.code).toBe('core.validation');
    }
  });
});
