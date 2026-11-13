// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D1: which file the analysis decodes. The proxy only when the profile
 * prefers it and it answers the same questions (a video on the asset's grid,
 * at least 1280 px); the shots stage then waits for it and every frame job
 * names it.
 */
import { describe, expect, it } from 'vitest';
import {
  FrameRate,
  newId,
  RationalTime,
  type AssetIndexView,
  type DerivedFileRef,
  type ShotId,
} from '@taalcut/core';
import { frameInputFor, preferredFrameInput } from '../../src/media/frame-source-policy';
import { createVisionIndexStages } from '../../src/jobs/stages';
import { fakeFrameSource } from '../helpers/fake-frame-source';

const video = { kind: 'video' as const, rate: { num: 30, den: 1 } };
const rate = FrameRate.of(30);
const proxy = { width: 1280, height: 720, frameRate: { num: 30, den: 1 } };

describe('frameInputFor', () => {
  it('reads the proxy only when preferred, on the same grid and big enough for OCR', () => {
    expect(frameInputFor('proxy', video, proxy)).toBe('proxy');
    expect(frameInputFor('original', video, proxy)).toBe('original');
    expect(frameInputFor('proxy', video, undefined)).toBe('original');
    expect(frameInputFor('proxy', video, { ...proxy, frameRate: { num: 120, den: 1 } })).toBe('original');
    expect(frameInputFor('proxy', video, { ...proxy, width: 960, height: 540 })).toBe('original');
    expect(frameInputFor('proxy', { ...video, kind: 'image' }, proxy)).toBe('original');
    expect(
      frameInputFor(
        'proxy',
        { kind: 'video', rate: { num: 60000, den: 2002 } },
        {
          ...proxy,
          frameRate: { num: 30000, den: 1001 },
        },
      ),
    ).toBe('proxy');
  });

  it('prefers the original wherever a hardware decoder is wired', () => {
    expect(preferredFrameInput('videotoolbox')).toBe('original');
    expect(preferredFrameInput('nvdec')).toBe('original');
    expect(preferredFrameInput('none')).toBe('proxy');
  });
});

describe('vision stages with a proxy preference', () => {
  const plan = fakeFrameSource({ width: 1920, height: 1080 }).video.plan;
  const file: DerivedFileRef = {
    kind: 'proxy',
    key: `proxies/ab/${'ab'.repeat(32)}.v1.mp4`,
    bytes: 10,
    mimeType: 'video/mp4',
    recipe: 1,
    ...proxy,
  };
  const view = (outputs: Record<string, unknown>): AssetIndexView => ({
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/clips/a.mov',
    contentHash: 'ab'.repeat(32),
    sizeBytes: 1,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [],
    transcript: null,
    outputs,
  });
  const options = { tier: 'recommended' as const, ocrLanguages: () => [], placement: () => 'local' as const };

  it('makes the shots stage wait for the proxy and name it', () => {
    const shots = createVisionIndexStages({ ...options, frameInput: 'proxy' })[0]!;
    expect(shots.needs).toEqual(['media.normalise', 'media.proxy']);
    const job = shots.job(
      view({
        'media.normalise': { plan, facts: plan.facts },
        'media.proxy': { file, reusedOriginal: false, ratio: 0.1, overBudget: false, warnings: [] },
      }),
    );
    expect(job).toMatchObject({ input: { proxyKey: file.key, plan: { kind: 'video' } } });
  });

  it('gives vision.embed the same file as the other frame stages, so it reads what they left in the cache', () => {
    const outputs = {
      'media.normalise': { plan, facts: plan.facts },
      'media.proxy': { file, reusedOriginal: false, ratio: 0.1, overBudget: false, warnings: [] },
    };
    const range = { start: RationalTime.of(0, rate), duration: RationalTime.of(60, rate) };
    const analysed = {
      ...view(outputs),
      shots: [
        { shotId: newId<'Shot'>() as ShotId, range, analysis: { bestFrame: 5, onScreenText: [] } as never },
      ],
    };
    const embed = createVisionIndexStages({ ...options, frameInput: 'proxy' }).find(
      (stage) => stage.stage === 'vision.embed',
    );
    expect(embed?.job(analysed)).toMatchObject({ input: { proxyKey: file.key, plan: { kind: 'video' } } });
    const original = createVisionIndexStages(options).find((stage) => stage.stage === 'vision.embed');
    const job = original?.job(analysed);
    expect(job).toMatchObject({ input: { plan: { kind: 'video' } } });
    expect(job).not.toHaveProperty('input.proxyKey');
  });

  it('keeps the original by default', () => {
    const shots = createVisionIndexStages(options)[0]!;
    expect(shots.needs).toEqual(['media.normalise']);
    const job = shots.job(view({ 'media.normalise': { plan, facts: plan.facts } }));
    expect(job).not.toHaveProperty('input.proxyKey');
  });
});
