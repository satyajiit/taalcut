// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `duration` against every preset. The check reads only the packet count, so
 * the fixtures are 64×64 solid colour: a three-minute file stays tiny.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExportPresetId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { presetFor } from '../../src/presets/presets.v1';
import { durationCheck, durationPreflight } from '../../src/qa/checks/format';
import { readStreamFacts } from '../../src/qa/measure/stream-facts';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { qaPlan, target } from './support';

const media = await findTestMedia('qa duration');
const PRESETS: readonly ExportPresetId[] = ['shorts', 'reels', 'tiktok', 'device', 'deviceHevc'];

describe.skipIf(!media.binaries)('duration check', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const path = (name: string) => join(work.dir, `${name}.mp4`);
  const fixture = (name: string, frames: number) =>
    ffmpeg(ctx, ['-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=30', '-frames:v', String(frames), '-c:v', 'mpeg4', path(name)]);
  const check = async (name: string, timelineFrames: number, preset: ExportPresetId) => {
    const facts = await readStreamFacts(ctx, path(name));
    if (!facts.ok) throw new Error(facts.error.code);
    return durationCheck(facts.value, qaPlan({ durationFrames: timelineFrames }), presetFor(preset), target);
  };

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-duration');
    await fixture('s30', 900);
    await fixture('s181', 5430);
    await fixture('s2', 60);
    await fixture('short1', 899);
  });
  afterAll(() => work.dispose());

  it.each(PRESETS)('passes 30 s for %s', async (preset) => {
    const result = await check('s30', 900, preset);
    expect(result.status).toBe('pass');
    expect(result.measured).toEqual({ value: 30, unit: 'seconds' });
  });

  it.each(['shorts', 'reels', 'tiktok'] as const)('fails 181 s for %s, not overridable, trim offered', async (preset) => {
    const result = await check('s181', 5430, preset);
    expect(result.status).toBe('fail');
    expect(result.overridable).toBe(false);
    expect(result.threshold).toEqual({ min: presetFor(preset).duration.minSeconds, max: 179, unit: 'seconds' });
    expect(result.fixes).toEqual([
      {
        kind: 'command',
        labelKey: 'qa.fixes.trimToDuration',
        command: 'timeline.trimToDuration',
        payload: { ...target, maxSeconds: 179 },
      },
    ]);
  });

  it('keeps 181 s for a device export', async () => {
    expect((await check('s181', 5430, 'device')).status).toBe('pass');
  });

  it('fails 2 s for Reels (3 s minimum) and lets the user export anyway', async () => {
    const result = await check('s2', 60, 'reels');
    expect(result.status).toBe('fail');
    expect(result.overridable).toBe(true);
    expect(result.fixes).toEqual([{ kind: 'agent', instructionKey: 'qa.fixes.lengthen', params: { minSeconds: 3 } }]);
    expect((await check('s2', 60, 'shorts')).status).toBe('pass');
  });

  it('fails a file one frame shorter than its timeline, never overridable, and re-renders', async () => {
    const result = await check('short1', 900, 'device');
    expect(result.status).toBe('fail');
    expect(result.overridable).toBe(false);
    expect(result.findings).toEqual([{ target: { kind: 'file', id: 'frameCount' }, measured: { value: -1, unit: 'frames' } }]);
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
  });

  it('runs the same rule at preflight from the timeline alone', () => {
    expect(durationPreflight(qaPlan({ durationFrames: 5430 }), presetFor('shorts'), target).status).toBe('fail');
    expect(durationPreflight(qaPlan({ durationFrames: 900 }), presetFor('shorts'), target).status).toBe('pass');
    // 29.97 fps: 5370 frames is 179.18 s, just over.
    const ntsc = qaPlan({ durationFrames: 5370, rateNum: 30_000, rateDen: 1001 });
    expect(durationPreflight(ntsc, presetFor('tiktok'), target).status).toBe('fail');
  });
});
