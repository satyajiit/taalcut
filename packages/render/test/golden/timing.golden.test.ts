// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate 5 (P2-M6, P2-Q3): cuts on the beat grid within one frame, and drift
 * under 20 ms over 60 s. Ten golden timelines (test/golden/fixtures/timing,
 * made from beat-grid maths only) at 24, 30, 60, 29.97 and 59.94 fps, with
 * hard cuts, a gap, a still, a dissolve, dips to black and flashes. Each is
 * rendered through the real picture path (conform, compile, producer), its
 * click track mixed at −14 LUFS and muxed as the export does, and then:
 *
 * - the file has exactly N frames;
 * - every frame shows what the timeline puts there (per-frame colour code,
 *   transition blends predicted from their linear ramps);
 * - every beat's click starts within a frame of its cut, and the audio
 *   drifts less than 20 ms over 60 s against the beat grid;
 * - a one-frame shift of a cut in the expectation fails the comparison.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, type FrameRate } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { mixAudio, muxAudio } from '../../src/audio/mix';
import { planAudioMix } from '../../src/audio/mix-plan';
import { renderVideo } from '../../src/engine/render-video';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { samplesForFrames } from '../../src/time/frames';
import {
  audioPacketGaps,
  beatSamples,
  clickOnsets,
  clickTrack,
  decodeTimedPcm,
  drift,
  expectedFrames,
  frameMismatches,
  goldenTimeline,
  loadTimingGoldens,
  nearestFrame,
  rateOf,
  shiftCut,
  SOURCE_GEQ,
  type TimingGolden,
} from '../support/golden';
import { ffmpeg, findTestMedia, mediaContext, patchColours, probeJson, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('timing goldens');
const shell = findTestShell('timing goldens');
const skip = !media.binaries || !shell.path;
const { sourceFrames, goldens } = loadTimingGoldens();

/** Each golden's decoded frame colours (for the shift test) and its timing numbers (for the summary). */
const decoded = new Map<string, [number, number, number][]>();
const measured = new Map<string, { maxOffsetMs: number; driftMs: number; wallMs: number }>();

const frameSeconds = (rate: FrameRate) => rate.den / rate.num;

describe('timing goldens: fixtures are beat-grid maths', () => {
  it('has ten goldens over every supported rate', () => {
    expect(goldens).toHaveLength(10);
    expect(new Set(goldens.map((g) => `${g.rate.num}/${g.rate.den}`))).toEqual(
      new Set(['24/1', '30/1', '60/1', '30000/1001', '60000/1001']),
    );
  });

  it.each(goldens.map((golden) => [golden.name, golden] as const))(
    '%s: each cut is the nearest frame to its beat',
    (_, golden) => {
      const rate = rateOf(golden);
      let at = 0;
      const starts = new Map<number, number>();
      for (const item of golden.items) {
        if (item.beat !== undefined) starts.set(item.beat, at);
        at += item.gap ?? item.frames ?? 0;
      }
      expect(at).toBe(golden.expected.durationFrames);
      expect(golden.expected.durationFrames).toBe(
        nearestFrame((golden.beats.length * 60000) / golden.bpm, rate),
      );
      for (const cut of golden.expected.cuts) {
        expect(cut.beatMs).toBe(golden.beats[cut.beat]);
        expect(cut.frame).toBe(nearestFrame(cut.beatMs, rate));
        if (starts.has(cut.beat)) expect(starts.get(cut.beat)).toBe(cut.frame);
      }
      // The planner puts every anchored clip's beat on its cut.
      const plan = planTimeline(
        goldenTimeline(golden, { video: newId(), image: newId(), music: newId() }, sourceFrames),
      );
      if (!plan.ok) throw new Error(plan.error.code);
      for (const visual of plan.value.visuals) expect(visual.beat?.frame).toBe(visual.cut.start);
    },
  );
});

describe.skipIf(skip)('timing goldens: rendered', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const sources = new Map<string, { path: string; size: number; mtimeMs: number }>();
  let still: { path: string; size: number; mtimeMs: number };

  const fileOf = async (path: string) => {
    const info = await stat(path);
    return { path, size: info.size, mtimeMs: info.mtimeMs };
  };

  /** One colour-coded source per rate: frame n is codeColour(n). */
  async function sourceAt(rate: FrameRate) {
    const key = `${rate.num}-${rate.den}`;
    const known = sources.get(key);
    if (known) return known;
    const path = join(work.dir, `source-${key}.mp4`);
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=108x192:r=${rate.num}/${rate.den}`,
      '-vf',
      `${SOURCE_GEQ},format=yuv444p`,
      '-frames:v',
      String(sourceFrames),
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '20M',
      '-pix_fmt',
      'yuv420p',
      path,
    ]);
    const file = await fileOf(path);
    sources.set(key, file);
    return file;
  }

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('timing-goldens');
    const stillPath = join(work.dir, 'magenta.png');
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'color=c=0xff00ff:s=108x192', '-frames:v', '1', stillPath]);
    still = await fileOf(stillPath);
  });
  afterAll(async () => {
    const rows = [...measured].map(
      ([name, m]) =>
        `${name}: max |click − cut| ${m.maxOffsetMs.toFixed(2)} ms, drift ${m.driftMs.toFixed(2)} ms/60 s, ${m.wallMs} ms`,
    );
    process.stdout.write(`[timing goldens]\n${rows.join('\n')}\n`);
    // TAALCUT_KEEP_GOLDEN_WORK=1 keeps the renders for a look.
    if (process.env.TAALCUT_KEEP_GOLDEN_WORK === '1')
      process.stdout.write(`[timing goldens] kept ${work?.dir}\n`);
    else await work?.dispose();
  });

  async function render(golden: TimingGolden) {
    const started = Date.now();
    const rate = rateOf(golden);
    const assets = { video: newId<'Asset'>(), image: newId<'Asset'>(), music: newId<'Asset'>() };
    const timeline = goldenTimeline(golden, assets, sourceFrames);
    const source = await sourceAt(rate);
    const dir = join(work.dir, golden.name);
    const rendered = await renderVideo({
      timeline,
      preset: presetFor('device'),
      burnCaptions: false,
      source: (visual) => (visual.kind === 'image' ? still : source),
      ctx,
      conformDir: join(work.dir, 'conform'),
      workDir: dir,
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
    });
    if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
    const samples = samplesForFrames(golden.expected.durationFrames, rate, 48000);
    const clicks = join(dir, 'clicks.wav');
    await clickTrack(ctx, clicks, golden.bpm, samples);
    const mix = planAudioMix(rendered.value.bundle.plan, {
      clip: () => undefined,
      ownTrack: { path: clicks },
    });
    if (!mix.ok) throw new Error(mix.error.code);
    const audio = await mixAudio(mix.value, ctx, {
      out: join(dir, 'mix.m4a'),
      loudness: { integratedLufs: -14, truePeakDbtp: -1.5 },
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!audio.ok) throw new Error(`${audio.error.code}: ${audio.error.detail ?? ''}`);
    const out = join(dir, 'final.mp4');
    const muxed = await muxAudio(rendered.value.video, audio.value.path, out, ctx);
    if (!muxed.ok) throw new Error(muxed.error.code);
    return { out, samples, wallMs: Date.now() - started };
  }

  it.each(goldens.map((golden) => [golden.name, golden] as const))(
    '%s: frame-exact cuts, clicks on the cuts, no drift',
    { timeout: 300_000 },
    async (_, golden) => {
      const rate = rateOf(golden);
      const { out, samples, wallMs } = await render(golden);
      // Decoded first, so the shift test has every golden's frames whatever fails below.
      const colours = await patchColours(ctx, out, { x: 532, y: 952, size: 16 });
      decoded.set(golden.name, colours);

      // (a) Exactly N frames, and the sound as long as the picture.
      const probe = (await probeJson(ctx, out, 'stream=codec_type,nb_read_packets,duration')) as {
        streams: { codec_type: string; nb_read_packets: string; duration: string }[];
      };
      const video = probe.streams.find((s) => s.codec_type === 'video')!;
      const sound = probe.streams.find((s) => s.codec_type === 'audio')!;
      expect(Number(video.nb_read_packets)).toBe(golden.expected.durationFrames);
      expect(
        Math.abs(Number(sound.duration) - Number(video.duration)),
        `audio ${sound.duration} s, video ${video.duration} s`,
      ).toBeLessThan(frameSeconds(rate));

      // (b) Every frame shows what the timeline puts there.
      expect(colours).toHaveLength(golden.expected.durationFrames);
      const mismatches = frameMismatches(expectedFrames(golden), colours);
      expect(mismatches, JSON.stringify(mismatches.slice(0, 8))).toEqual([]);
      for (const peak of golden.expected.flashPeaks) expect(Math.min(...colours[peak]!)).toBeGreaterThan(235);
      for (const black of golden.expected.blackFrames) expect(Math.max(...colours[black]!)).toBeLessThan(20);

      // (c) The sound plays back to back (no timestamp holes a player would turn into a delay), every
      // beat's click lands on the grid as a player places it, and each cut's click is within a frame.
      expect(await audioPacketGaps(ctx, out)).toEqual([]);
      const pcm = await decodeTimedPcm(ctx, out);
      expect(Math.abs(pcm.length - samples)).toBeLessThanOrEqual(1);
      const period = beatSamples(golden.bpm);
      const beats = golden.beats.map((ms) => Math.round(ms * 48)).filter((at) => at + 2400 <= samples);
      const onsets = clickOnsets(pcm, beats, period / 2);
      expect(onsets.every((onset) => onset >= 0)).toBe(true);
      const audioErrorMs = onsets.map((onset, i) => ((onset - beats[i]!) * 1000) / 48000);
      expect(Math.max(...audioErrorMs.map(Math.abs))).toBeLessThan(1);
      const offsets = golden.expected.cuts
        .filter((cut) => cut.beat < beats.length)
        .map((cut) => onsets[cut.beat]! / 48000 - cut.frame * frameSeconds(rate));
      for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(frameSeconds(rate));
      const driftMs = drift(
        audioErrorMs.map((y, i) => ({ x: beats[i]! / 48000, y })),
        60,
      );
      expect(Math.abs(driftMs)).toBeLessThan(20);
      measured.set(golden.name, {
        maxOffsetMs: Math.max(0, ...offsets.map((o) => Math.abs(o) * 1000)),
        driftMs,
        wallMs,
      });
    },
  );

  it('a one-frame shift of any cut fails the comparison', () => {
    for (const golden of goldens) {
      const colours = decoded.get(golden.name);
      expect(colours, `${golden.name} was rendered`).toBeDefined();
      // Every boundary between two items, moved a frame either way, must show up as a mismatch.
      for (let index = 0; index + 1 < golden.items.length; index++) {
        for (const by of [-1, 1]) {
          const shifted = frameMismatches(expectedFrames(shiftCut(golden, index, by)), colours!);
          expect(shifted.length, `${golden.name} cut ${index} shifted ${by}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
