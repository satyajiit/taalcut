// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Ducking in the export mix (P3-V6, SPEC P3.9/P3.10) with the bundled FFmpeg: the envelope lands on its
 * samples; a spoken voiceover (macOS `say`) over a loud music bed goes through mixExport with a stand-in
 * planner, and the voice stays ≥ 8 LU above the ducked music in short-term loudness (ducking on) or
 * fails the voiceOverMusic check with a fix (ducking off). Stems are exactly the mix's length.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_DUCKING,
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  type GainPoint,
  type Timeline,
  type TimelineMix,
} from '@taalcut/core';
import { runProcess, type MediaContext } from '@taalcut/media';
import { gainAt, gainExpression } from '../../src/audio/ducking-apply';
import { mixExport, renderExportMix } from '../../src/audio/export-mix';
import { renderMix } from '../../src/audio/mix';
import { busedFilterGraph } from '../../src/audio/mix-graph';
import type { AudioMixPlan } from '../../src/audio/mix-types';
import { audioRoles } from '../../src/audio/roles';
import { planTimeline } from '../../src/plan/render-plan';
import { voiceOverMusicCheck } from '../../src/qa/checks/voice-over-music';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { makeTimeline } from '../support/timeline';
import { fakeDuckingPlanner } from './fake-ducking';
import { decodePcm, evalWav } from './helpers';

const media = await findTestMedia('render ducking');
const canSpeak = process.platform === 'darwin' && existsSync('/usr/bin/say');
const target = { integratedLufs: -14, truePeakDbtp: -1 };
const FRAMES = 450; // 15 s at 30 fps

const LINES =
  'Welcome back to the kitchen. Today we are making a simple rice dish, step by step. ' +
  'First, rinse the rice until the water runs clear. Then add it to the pot with a pinch of salt.';

describe.skipIf(!media.binaries)('ducking envelope in the graph', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('ducking-envelope');
  });
  afterAll(() => work?.dispose());

  it('scales the bus by the envelope on its own samples, one gain per 128-sample frame', async () => {
    const constant = await evalWav(ctx, work.dir, 'constant', '0.5', 48_000);
    const points: GainPoint[] = [
      { sample: 4800, db: 0 },
      { sample: 8640, db: -30 },
      { sample: 24_000, db: -30 },
      { sample: 38_400, db: -6 },
    ];
    const mix: AudioMixPlan = {
      sampleRate: 48_000,
      totalSamples: 48_000,
      segments: [
        {
          id: 'music',
          kind: 'music',
          path: constant,
          inSample: 0,
          startSample: 0,
          samples: 48_000,
          gainDb: 0,
          fadeInSamples: 0,
          fadeOutSamples: 0,
          tempo: 1,
        },
      ],
      silent: false,
      music: 'platformSound',
      referenceAudio: false,
    };
    const graph = busedFilterGraph(mix, () => 'music', { music: gainExpression(points)! });
    const out = await renderMix(mix, ctx, { out: join(work.dir, 'enveloped.wav'), graph });
    if (!out.ok) throw new Error(`${out.error.code}: ${out.error.detail ?? ''}`);
    const pcm = await decodePcm(ctx, out.value.path);
    expect(pcm.length).toBe(48_000);
    let worst = 0;
    for (let frame = 0; frame < 48_000; frame += 128) {
      const expected = 0.5 * gainAt(points, frame / 48_000);
      for (let i = frame; i < Math.min(48_000, frame + 128); i++)
        worst = Math.max(worst, Math.abs(pcm[i]! - expected));
    }
    expect(worst).toBeLessThan(1e-5);
    // On the floor: −30 dB.
    expect(20 * Math.log10(pcm[12_000]! / 0.5)).toBeCloseTo(-30, 3);
  });
});

describe.skipIf(!media.binaries || !canSpeak)(
  'voice over music, ducked (P3-V6)',
  { timeout: 180_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;
    let voice: string;
    let music: string;
    let timeline: Timeline;

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('ducking');
      const aiff = join(work.dir, 'vo.aiff');
      const said = await runProcess('/usr/bin/say', ['-o', aiff, LINES], { timeoutMs: 60_000 });
      if (!said.ok) throw new Error(`say failed: ${said.error.code}`);
      // The voiceover from 1.5 s, 48 kHz stereo, so the mix has a stretch of music alone first.
      voice = join(work.dir, 'vo.wav');
      await ffmpeg(ctx, [
        '-i',
        aiff,
        '-af',
        'aresample=48000,adelay=delays=1500:all=1,apad=whole_dur=16',
        '-ac',
        '2',
        '-t',
        '16',
        '-c:a',
        'pcm_f32le',
        voice,
      ]);
      // A loud bed: pink noise and a chord, about −12 LUFS, with no gaps.
      music = join(work.dir, 'music.wav');
      await ffmpeg(ctx, [
        '-f',
        'lavfi',
        '-i',
        'anoisesrc=c=pink:a=0.3:r=48000:d=16:s=3',
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='0.15*sin(2*PI*220*t)+0.12*sin(2*PI*277*t)+0.1*sin(2*PI*330*t)':s=48000:d=16",
        '-filter_complex',
        '[0][1]amix=inputs=2:normalize=0,lowpass=f=6000',
        '-ac',
        '2',
        '-c:a',
        'pcm_f32le',
        music,
      ]);
      const base = makeTimeline({
        items: [{ frames: FRAMES, muted: true }],
        audioTracks: [[{ frames: FRAMES }]],
        music: {
          path: 'ownTrack',
          assetId: newId<'Asset'>(),
          offset: RationalTime.of(0, FrameRate.of(1000)),
          gainDb: 0,
        },
      });
      // The voiceover track: render reads the role, not the id.
      timeline = {
        ...base,
        tracks: base.tracks.map((track) =>
          track.kind === 'audio' ? { ...track, role: 'voice' as const } : track,
        ),
      };
    });
    afterAll(() => work?.dispose());

    async function exported(mix: TimelineMix, name: string) {
      const plan = planTimeline(timeline);
      if (!plan.ok) throw new Error(plan.error.code);
      const planner = fakeDuckingPlanner(ctx, work.dir);
      const result = await mixExport(
        {
          plan: plan.value,
          roles: audioRoles(timeline),
          mix,
          ducking: planner,
          sources: {
            clip: (id) => {
              const clip = plan.value.audio.find((candidate) => candidate.id === id);
              return clip ? { path: voice, offset: clip.sourceIn } : undefined;
            },
            ownTrack: { path: music },
          },
        },
        ctx,
        {
          out: join(work.dir, `${name}.m4a`),
          loudness: target,
          bitrateKbps: 192,
          sampleRate: 48_000,
          workDir: work.dir,
        },
      );
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
      return { result: result.value, planner, plan: plan.value };
    }

    const ids = () => ({ projectId: timeline.projectId, timelineId: timeline.id });

    it('ducking on: the voice stays at least 8 LU above the music, and QA passes', async () => {
      const { result, planner, plan } = await exported(DEFAULT_MIX, 'on');
      expect(result.ducked).toBe(true);
      const report = result.voiceOverMusic!;
      process.stdout.write(
        `[ducking] on: ${JSON.stringify({ min: report.minMarginLu, counted: report.counted })}\n`,
      );
      expect(report.counted).toBeGreaterThan(40);
      expect(report.minMarginLu!).toBeGreaterThanOrEqual(8);
      const check = voiceOverMusicCheck({ report, settings: DEFAULT_DUCKING, target: ids(), fps: 30 });
      expect(check.status).toBe('pass');
      // The planner got the dry voice and the music as stems, each exactly the mix's length.
      const total = (FRAMES / 30) * 48_000;
      expect(planner.calls).toEqual([{ lengths: { voice: total, music: total }, durationSamples: total }]);
      // The delivered file: exact length, at the target loudness, and no stem left behind.
      expect((await decodePcm(ctx, result.path)).length).toBe(total);
      expect(Math.abs(result.measured!.integratedLufs + 14)).toBeLessThanOrEqual(0.5);
      expect((await readdir(work.dir)).filter((file) => file.includes('.stem.'))).toEqual([]);
      expect(plan.audio.map((clip) => clip.track)).toEqual(['A1']);
    });

    it('ducking off: the music drowns the voice, and QA fails with a fix that turns ducking on', async () => {
      const off: TimelineMix = { ...DEFAULT_MIX, ducking: { ...DEFAULT_DUCKING, enabled: false } };
      const { result, planner } = await exported(off, 'off');
      expect(result.ducked).toBe(false);
      expect(planner.calls).toEqual([]);
      const report = result.voiceOverMusic!;
      process.stdout.write(
        `[ducking] off: ${JSON.stringify({ min: report.minMarginLu, counted: report.counted })}\n`,
      );
      expect(report.minMarginLu!).toBeLessThan(8);
      const check = voiceOverMusicCheck({ report, settings: off.ducking, target: ids(), fps: 30 });
      expect(check.status).toBe('fail');
      expect(check.fixes[0]).toMatchObject({
        kind: 'command',
        command: 'music.setDucking',
        payload: { ...ids(), ducking: { enabled: true } },
      });
    });

    it('the preview renders the same ducked sound, without the loudness pass', async () => {
      const plan = planTimeline(timeline);
      if (!plan.ok) throw new Error(plan.error.code);
      const preview = await renderExportMix(
        {
          plan: plan.value,
          roles: audioRoles(timeline),
          mix: DEFAULT_MIX,
          ducking: fakeDuckingPlanner(ctx, work.dir),
          sources: {
            clip: () => ({ path: voice, offset: RationalTime.of(0, FrameRate.of(48_000)) }),
            ownTrack: { path: music },
          },
        },
        ctx,
        { out: join(work.dir, 'preview.wav'), workDir: work.dir },
      );
      if (!preview.ok) throw new Error(preview.error.code);
      expect(preview.value).toMatchObject({ ducked: true, samples: (FRAMES / 30) * 48_000 });
    });
  },
);
