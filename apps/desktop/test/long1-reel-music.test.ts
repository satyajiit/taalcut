// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1 from the reel's samples to the mixed sound, in the agent process's wiring (agent-reel-music.ts). The reel
 * is synthetic: 470 frames at 30 a second, a drum loop whose two bars are 129 frames (the first bar at 1.5 s), louder
 * with a pad from the drop at 10.1 s, where the creator's slot ends. No model runs: the bars come from the samples.
 *
 * The chain: the port measures the kept reel's sound; the statement a model would make from that answer (the
 * creator's clip, two bars, the bar line at the drop, the footage before) is read by timeline's `planLengthen`; the
 * lengthened timeline is planned and mixed by render with the bundled FFmpeg; and the mix is measured: 599 frames,
 * the reel to the sample before the splice and 129 frames earlier after it, no gap or jump in level across it.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createContainer,
  err,
  newId,
  NotFoundError,
  ok,
  TemplateMediaStoreToken,
  type TemplateId,
  type TemplateMediaStore,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { planAudioMix, planTimeline, renderMix } from '@taalcut/render';
import { planLengthen } from '@taalcut/timeline';
import { afterAll, describe, expect, it } from 'vitest';
import { reelMusicSource } from '../src/utility/roots/agent-reel-music';
import { ownerTimeline, readLeft, reelLoop, REEL_SAMPLES, wavOf } from './helpers/long1-reel';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('long1 reel music');
if (!resolved.ok) console.warn(`long1 reel music: skipped, no FFmpeg (${resolved.error.code})`);

const root = mkdtempSync(join(tmpdir(), 'taalcut-long1-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BACK = 206_400; // 129 frames of 1600 samples
const rms = (pcm: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let n = from; n < to; n++) sum += pcm[n]! * pcm[n]!;
  return Math.sqrt(sum / (to - from));
};

/** A template media store that keeps one reel file. */
function kept(path: string, hasAudio = true): { store: TemplateMediaStore; reads: number[] } {
  const reads: number[] = [];
  const media = { hasAudio, sha256: 'c'.repeat(64) } as never;
  return {
    reads,
    store: {
      keep: async () => err(NotFoundError({ entity: 'template', id: 'none' })),
      get: async () => {
        reads.push(1);
        return ok({ media, path });
      },
      remove: async () => ok(undefined),
    },
  };
}

describe.skipIf(!resolved.ok)('the reel’s bars, from its samples to the mix (LONG1)', () => {
  const media: MediaContext = { binaries: resolved.ok ? resolved.value : (undefined as never) };
  const templateId = newId<'Template'>() as TemplateId;
  const reel = reelLoop();
  const path = join(root, 'reel.wav');
  writeFileSync(path, wavOf(reel));

  it('measures the kept reel once: steady bars of 2.15 s on the lines the loop has, the drop among the changes', async () => {
    let measures = 0;
    const { store } = kept(path);
    const source = reelMusicSource(createContainer().value(TemplateMediaStoreToken, store), async () => {
      measures += 1;
      return media;
    });
    await source(templateId);
    await source(templateId);
    const music = await source(templateId);
    if (!music.ok || !music.value) throw new Error('no music');
    const { bars } = music.value;
    expect(bars.steady).toBe(true);
    expect(bars.beatsPerBar).toBe(4);
    expect(bars.barSeconds).toBeCloseTo(2.15, 2);
    // Two bars are 129 frames at 30 a second.
    expect(Math.round(2 * bars.barSeconds! * 30)).toBe(129);
    const lines = [1.5, 3.65, 5.8, 7.95, 10.1, 12.25, 14.4];
    expect(bars.bars).toHaveLength(lines.length);
    bars.bars.forEach((bar, index) => expect(Math.abs(bar.at - lines[index]!)).toBeLessThan(0.006));
    expect(bars.changes.some((change) => Math.abs(change.at - 10.1) < 0.02 && change.levelDb > 2)).toBe(true);
    for (const sure of Object.values(bars.sure)) expect(sure).toBeGreaterThan(0);
    // Asked again (a second read, a try, the write), the same measurement answers: one decode.
    expect(measures).toBe(1);
    expect(music.value.seam(10.1, 4.3).apartDb).toBeLessThan(3);
  });

  it('answers no music where there is none to measure', async () => {
    const none = createContainer();
    expect(await reelMusicSource(none, async () => media)(templateId)).toEqual(ok(null));
    const silent = createContainer().value(TemplateMediaStoreToken, kept(path, false).store);
    expect(await reelMusicSource(silent, async () => media)(templateId)).toEqual(ok(null));
    const noFfmpeg = createContainer().value(TemplateMediaStoreToken, kept(path).store);
    expect(await reelMusicSource(noFfmpeg, async () => null)(templateId)).toEqual(ok(null));
  });

  it('two bars longer at the drop: 599 frames, and the mix is the reel again from 129 frames back', async () => {
    const source = reelMusicSource(
      createContainer().value(TemplateMediaStoreToken, kept(path).store),
      async () => media,
    );
    const music = await source(templateId);
    if (!music.ok || !music.value) throw new Error('no music');
    const { timeline, personClip } = ownerTimeline(templateId);
    // What a model states from timeline.musicBars' answer: the bar line the strongest change sits on.
    const drop = music.value.bars.bars.find((bar) => Math.abs(bar.at - 10.1) < 0.02)!;
    const plan = planLengthen(timeline, null, music.value, {
      clipId: personClip,
      bars: 2,
      at: Math.round(drop.at * 1000) / 1000,
      footage: 'before',
    });
    if (!plan.ok) throw new Error(plan.why);
    expect(plan.would).toMatchObject({
      frames: 129,
      seconds: 4.3,
      video: { fromFrames: 470, toFrames: 599 },
      later: { clips: 1, reelClips: 1 },
    });
    expect(Math.abs(plan.would.offMs)).toBeLessThan(5);
    // The seam, measured on the samples: the same bars two bars apart sound alike and as loud.
    expect(plan.would.music.seam.apartDb).toBeLessThan(3);
    expect(Math.abs(plan.would.music.seam.levelDb ?? 99)).toBeLessThan(1.5);

    const planned = planTimeline(plan.edited.timeline);
    if (!planned.ok) throw new Error(planned.error.code);
    expect(planned.value.durationFrames).toBe(599);
    const mix = planAudioMix(planned.value, { clip: () => undefined, reference: { path } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.totalSamples).toBe(REEL_SAMPLES + BACK);
    expect(mix.value.segments).toHaveLength(2);
    const out = join(root, 'mix.wav');
    const rendered = await renderMix(mix.value, media, { out });
    if (!rendered.ok) throw new Error(rendered.error.code);
    const mixed = readLeft(readFileSync(out));
    expect(mixed.length).toBe(958_400);

    const [before, after] = mix.value.segments;
    const at = before!.samples;
    const cross = before!.fadeOutSamples;
    expect(cross).toBe(2400);
    // The splice is 5 ms before the measured bar line, itself within 6 ms of the loop's (10.1 s: 484 800).
    expect(Math.abs(at + 240 - 484_800)).toBeLessThan(300);
    expect(after!.startSample - after!.inSample).toBe(BACK);
    const worst = (from: number, to: number, expected: (n: number) => number) => {
      let max = 0;
      for (let n = from; n < to; n++) max = Math.max(max, Math.abs(mixed[n]! - expected(n)));
      return max;
    };
    expect(worst(0, at - cross, (n) => reel[n]!)).toBeLessThan(1e-4);
    // After the splice every sample, so every hit and the drop, is the reel's 129 frames later.
    expect(worst(at, mixed.length, (n) => reel[n - BACK]!)).toBeLessThan(1e-4);
    // Across the crossfade: no gap and no jump. It is the two sides' blend, and as loud as the reel is there.
    const blend = (n: number) => {
      const gain = (n - (at - cross)) / cross;
      return (1 - gain) * reel[n]! + gain * reel[n - BACK]!;
    };
    expect(worst(at - cross, at, blend)).toBeLessThan(2e-3);
    const level = 20 * Math.log10(rms(mixed, at - cross, at) / rms(reel, at - cross, at));
    expect(Math.abs(level)).toBeLessThan(1);
    // The drop (louder, with the pad) is at 14.4 s of the video, frame 432, where the reel's own clip now starts.
    const loud = (pcm: Float32Array, from: number) => rms(pcm, from, from + 48_000);
    expect(loud(mixed, 484_800 + BACK)).toBeCloseTo(loud(reel, 484_800), 4);
    expect(loud(mixed, 484_800 + BACK)).toBeGreaterThan(loud(mixed, 484_800) * 1.3);
  }, 120_000);
});
