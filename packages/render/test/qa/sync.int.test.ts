// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * avSync and beatSync on a 60 s render: the picture cuts between two greys
 * every 0.5 s and the sound is a click track on the same beat. Fail
 * fixtures move the sound: 40 ms late, 30 ms of drift, a 30 ms offset input.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { avSyncCheck, beatSyncCheck } from '../../src/qa/checks/sync';
import { readStreamFacts } from '../../src/qa/measure/stream-facts';
import { measureWindows, type SyncWindow } from '../../src/qa/measure/sync';
import { runVideoPass } from '../../src/qa/measure/video-pass';
import type { QaPlan } from '../../src/types';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { PASS_AUDIO, PASS_VIDEO, qaPlan, rate30 } from './support';

const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };

const media = await findTestMedia('qa sync');
const FRAMES = 1800;
const CLICKS = "aevalsrc='if(lt(mod(t,0.5),0.005),0.8*sin(2*PI*1000*t),0)':s=48000:d=60";
const GREYS = 'color=c=0x303030:s=270x480:r=30:d=0.5[a];color=c=0xd0d0d0:s=270x480:r=30:d=0.5[b]';

/** Cuts every 15 frames, the first ten anchored to their beat. */
function syncPlan(shift = 0): QaPlan {
  const cuts = Array.from({ length: 10 }, (_, index) => {
    const frame = (index + 1) * 15 + shift;
    return { frame, from: `clip-${index}`, to: `clip-${index + 1}`, beat: { beatIndex: index + 1, frame } };
  });
  return qaPlan({
    durationFrames: FRAMES,
    cuts,
    anchors: cuts.map((cut) => ({ clipId: cut.to, frame: cut.frame, beatFrame: cut.frame })),
    audio: {
      silent: false,
      music: 'platformSound',
      referenceAudio: false,
      // The music every 5 s, one second each, from 0.1 s.
      windows: Array.from({ length: 12 }, (_, index) => ({ sourceId: 'music', kind: 'music' as const, startFrame: index * 150 + 3, frames: 30 })),
    },
  });
}

describe.skipIf(!media.binaries)('sync checks', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const path = (name: string) => join(work.dir, name);
  let scores: readonly number[] = [];

  const mux = (name: string, audioInput: readonly string[], filter?: string) =>
    ffmpeg(ctx, [
      '-i', path('picture.mp4'), ...audioInput, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      ...(filter ? ['-af', filter] : []), ...PASS_AUDIO, '-movflags', '+faststart', path(name),
    ]);

  const check = async (name: string, plan = syncPlan()) => {
    const facts = await readStreamFacts(ctx, path(name));
    if (!facts.ok) throw new Error(facts.error.code);
    const frameSeconds = 1 / 30;
    const windows: SyncWindow[] = plan.audio.windows.map((window) => ({
      at: window.startFrame * frameSeconds,
      seconds: window.frames * frameSeconds,
      source: { path: path('clicks.wav'), offset: { value: 0, rate: rate30 } },
    }));
    const correlations = await measureWindows(ctx, path(name), windows);
    if (!correlations.ok) throw new Error(correlations.error.code);
    return avSyncCheck({ facts: facts.value, plan, sceneScores: scores, correlations: correlations.value });
  };

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-sync');
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', CLICKS, path('clicks.wav')]);
    await ffmpeg(ctx, [
      '-filter_complex', `${GREYS};[a][b]concat=n=2:v=1:a=0,loop=loop=59:size=30:start=0`,
      ...PASS_VIDEO, '-an', path('picture.mp4'),
    ]);
    await mux('pass.mp4', ['-i', path('clicks.wav')]);
    await mux('late.mp4', ['-i', path('clicks.wav')], 'adelay=40:all=1,atrim=duration=60');
    await mux('drift.mp4', ['-i', path('clicks.wav')], 'atempo=1.0005');
    await mux('offset.mp4', ['-itsoffset', '0.03', '-i', path('clicks.wav')]);
    const pass = await runVideoPass(ctx, path('pass.mp4'), { rate: rate30 });
    if (!pass.ok) throw new Error(pass.error.code);
    scores = pass.value.sceneScores;
  }, 120_000);
  afterAll(() => work.dispose());

  it('finds each grey cut on its frame', () => {
    expect(scores).toHaveLength(FRAMES);
    for (const cut of syncPlan().cuts) expect(scores[cut.frame]).toBeGreaterThanOrEqual(8);
    expect(scores[16]).toBeLessThan(8);
  });

  it('passes the click track muxed as is', async () => {
    const result = await check('pass.mp4');
    expect(result.findings).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.measured!.value).toBeLessThanOrEqual(1);
  });

  it('fails sound 40 ms late in every window', async () => {
    const result = await check('late.mp4');
    expect(result.status).toBe('fail');
    const offsets = result.findings.filter((finding) => finding.target?.id === 'offset');
    expect(offsets).toHaveLength(12);
    for (const finding of offsets) expect(finding.measured!.value).toBeCloseTo(40, -1);
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
  });

  it('fails 30 ms of drift over 60 s', async () => {
    const result = await check('drift.mp4');
    expect(result.status).toBe('fail');
    const drift = result.findings.find((finding) => finding.target?.id === 'drift');
    expect(drift?.measured?.value).toBeLessThan(-20);
  });

  it('fails audio that starts 30 ms after the picture', async () => {
    const result = await check('offset.mp4');
    expect(result.status).toBe('fail');
    const ids = result.findings.map((finding) => finding.target?.id);
    expect(ids.some((id) => id === 'start' || id === 'offset')).toBe(true);
  });

  it('fails a cut the render put off its planned frame', async () => {
    const result = await check('pass.mp4', syncPlan(1));
    const cuts = result.findings.filter((finding) => finding.target?.kind === 'clip');
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0]!.measured).toEqual({ value: -1, unit: 'frames' });
  });

  describe('beatSync', () => {
    it('passes cuts on their beats', () => {
      expect(beatSyncCheck(syncPlan(), scores, target).status).toBe('pass');
    });

    it('fails a timeline cut two frames off its anchor', () => {
      const plan = syncPlan();
      const anchors = plan.anchors.map((anchor, index) => (index === 3 ? { ...anchor, frame: anchor.frame + 2 } : anchor));
      const result = beatSyncCheck({ ...plan, anchors }, scores, target);
      expect(result.status).toBe('fail');
      expect(result.findings).toHaveLength(1);
      expect(result.fixes).toEqual([
        { kind: 'command', labelKey: 'qa.fixes.resyncBeats', command: 'timeline.resyncBeats', payload: target },
      ]);
      expect(result.findings[0]!.measured).toEqual({ value: 2, unit: 'frames' });
      expect(result.overridable).toBe(true);
    });

    it('fails when the render cut two frames from where the timeline and the beat agree', () => {
      // The plan puts every cut two frames early; the file still cuts on the beat-grid frames.
      const result = beatSyncCheck(syncPlan(-2), scores, target);
      expect(result.status).toBe('fail');
      expect(result.findings[0]!.measured).toEqual({ value: 2, unit: 'frames' });
    });

    it('is skipped without anchors', () => {
      expect(beatSyncCheck(qaPlan(), scores, target).status).toBe('skipped');
    });
  });
});
