// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A synthetic reel (hard cuts, a 2-frame shot, a one-frame flash, a 120 BPM
 * click track) through the `templates.breakdown` job as the jobs process
 * registers it: the experiment sandbox under userData, media's normalise,
 * frame and loudness primitives, vision's scene scores and frame vectors,
 * and the analysers' adapters. The embedding model is a colour-grid stand-in
 * and beats come from the test build's onset stand-in: no model component is
 * installed here. OCR is unavailable, so text is skipped with a warning.
 * The same reel inside a phone screen recording (static chrome around it)
 * goes through `detectCrop` and a cropped normalise.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createDirectJobRunner,
  newId,
  ok,
  RationalTime,
  systemClock,
  type ComputeFallbackEvent,
  type ExperimentId,
} from '@taalcut/core';
import { DEFAULT_BEAT_PLAN } from '@taalcut/audio';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import {
  createMediaService,
  runFfmpeg,
  selectWorkingEncoder,
  type MediaContext,
  type ResolvedFfmpeg,
} from '@taalcut/media';
import {
  createTemplateJobs,
  resolveCuts,
  templatesBreakdownJob,
  type BreakdownDraft,
} from '@taalcut/templates';
import {
  runProcess,
  SYNTHETIC_REELS,
  syntheticLabels,
  syntheticReelArgs,
} from '@taalcut/templates/test-support';
import { createEmbedder } from '@taalcut/vision';
import { breakdownMedia, breakdownVision } from '../src/utility/roots/template-analysers';
import { breakdownAudio } from '../src/utility/roots/template-audio';
import { createJobsSandbox } from '../src/utility/roots/template-sandbox';
import { standinBeats } from '../src/utility/roots/template-standins';
import { colourGridLoader, noComponents, noOcr } from './helpers/breakdown-fakes';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('template breakdown');
if (!resolved.ok) console.warn(`template breakdown: skipped, no FFmpeg (${resolved.error.code})`);

const root = mkdtempSync(join(tmpdir(), 'taalcut-desktop-breakdown-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One-to-one matches within ±2 frames, nearest first (as tools/evals scores). */
function unmatched(found: readonly number[], expected: readonly number[]) {
  const pairs = expected
    .flatMap((cut, i) => found.map((frame, j) => ({ i, j, d: Math.abs(frame - cut) })))
    .filter((pair) => pair.d <= 2)
    .sort((a, b) => a.d - b.d);
  const usedTrue = new Set<number>();
  const usedFound = new Set<number>();
  for (const { i, j } of pairs)
    if (!usedTrue.has(i) && !usedFound.has(j)) {
      usedTrue.add(i);
      usedFound.add(j);
    }
  return {
    missed: expected.filter((_, i) => !usedTrue.has(i)),
    extra: found.filter((_, j) => !usedFound.has(j)),
  };
}

/** The reel's encoder: media's working H.264 encoder on this machine (h264_videotoolbox, h264_nvenc, OpenH264). */
async function reelEncoder(binaries: ResolvedFfmpeg): Promise<string> {
  const choice = await selectWorkingEncoder({ binaries }, 'h264');
  if (!choice.ok) throw new Error(`no H.264 encoder: ${choice.error.code}`);
  return choice.value.encoder;
}

/** The breakdown job on `reference` as the jobs process registers it; its draft and experiment folder. */
async function breakdown(binaries: ResolvedFfmpeg, reference: string, input: 'file' | 'screenRecording') {
  const config = testConfig('jobs', ':memory:', join(root, `user-data-${input}`));
  const media = createMediaService({ resolver: { resolve: async () => ok(binaries) } });
  const fallbacks: ComputeFallbackEvent[] = [];
  const onFallback = (event: ComputeFallbackEvent) => void fallbacks.push(event);
  const context = { media: async () => ok<MediaContext>({ binaries }), onFallback };
  const sandbox = createJobsSandbox({ config, media, components: () => noComponents });
  const jobs = createTemplateJobs({
    sandbox,
    components: noComponents,
    clock: systemClock,
    analysers: {
      media: breakdownMedia(context),
      vision: breakdownVision({
        ...context,
        embedder: createEmbedder({ modelDir: '/stand-in', loader: colourGridLoader }),
        ocr: noOcr,
      }),
      audio: breakdownAudio({
        media: context.media,
        components: () => noComponents,
        onFallback,
        beatPlan: async () => DEFAULT_BEAT_PLAN,
        standinBeats: async () => standinBeats(context.media),
      }),
    },
  });

  const id = newId<'Experiment'>() as ExperimentId;
  const opened = await sandbox.open({ id, projectId: null, purpose: 'breakdown' });
  if (!opened.ok) throw new Error(opened.error.code);
  const runner = createDirectJobRunner(jobs);
  const ran = await runner.run(templatesBreakdownJob, {
    experimentId: id,
    reference: { kind: 'file', path: reference },
    input,
    platform: null,
    url: null,
    sound: null,
    fingerprint: 'a'.repeat(64),
  });
  if (!ran.ok) throw new Error(`${ran.error.code}: ${ran.error.detail ?? ''}`);
  const draft: BreakdownDraft = ran.value;
  return { draft, dir: opened.value.dir, fallbacks };
}

describe.skipIf(!resolved.ok)('the breakdown job on real media and vision functions', () => {
  it(
    'finds the cuts within ±2 frames, the click track, and writes the contact sheet',
    { timeout: 300_000 },
    async () => {
      const binaries = resolved.ok ? resolved.value : (undefined as never);
      const spec = SYNTHETIC_REELS[0]!;
      const reel = join(root, `${spec.id}.mp4`);
      const made = await runProcess(
        binaries.ffmpeg,
        syntheticReelArgs(spec, reel, { encoder: await reelEncoder(binaries) }),
      );
      if (!made.ok) throw new Error(made.error.detail);
      const { draft, dir, fallbacks } = await breakdown(binaries, reel, 'file');

      const labels = syntheticLabels(spec);
      const cuts = resolveCuts(draft, []).cuts.map((cut) => cut.frame);
      expect(unmatched(cuts, labels.cuts)).toEqual({ missed: [], extra: [] });
      expect(draft.duration.value).toBe(labels.durationFrames);
      const beats = draft.beatMap!.beats.map((beat) => RationalTime.toSeconds(beat));
      beats.slice(0, 8).forEach((time, k) => expect(Math.abs(time - k * 0.5)).toBeLessThanOrEqual(0.02));
      expect(draft.audio.kind).toBe('music');
      expect(draft.warnings.some((warning) => warning.startsWith('text_failed'))).toBe(true);
      expect(draft.reference.crop).toBeNull();
      expect(existsSync(join(dir, draft.contactSheet!.path))).toBe(true);
      expect(
        draft.slotFrames.every((slot) => slot.frames.every((frame) => existsSync(join(dir, frame)))),
      ).toBe(true);
      // scdet has no GPU form: reported once, with its reason.
      expect(fallbacks.some((event) => event.operation === 'vision.sceneScores')).toBe(true);
    },
  );

  it(
    'crops a screen recording to the reel inside it and still finds the cuts',
    { timeout: 300_000 },
    async () => {
      const binaries = resolved.ok ? resolved.value : undefined;
      const spec = SYNTHETIC_REELS[0];
      if (!binaries || !spec) throw new Error('no FFmpeg or no synthetic reel');
      const reel = join(root, `${spec.id}-for-screen.mp4`);
      const made = await runProcess(
        binaries.ffmpeg,
        syntheticReelArgs(spec, reel, { encoder: await reelEncoder(binaries) }),
      );
      if (!made.ok) throw new Error(made.error.detail);
      // A 300×650 phone screen: light chrome, a status bar, a bottom bar, the reel at (16, 80).
      const drawn = { x: 16, y: 80, width: spec.width, height: spec.height };
      const screen = join(root, 'screen-recording.mp4');
      const chrome = [
        `color=c=0xeeeeee:s=300x650:r=${spec.rate.num}/${spec.rate.den}[bg]`,
        `[bg][0:v]overlay=x=${drawn.x}:y=${drawn.y}:shortest=1,` +
          'drawbox=x=12:y=16:w=40:h=20:color=0x222222:t=fill,' +
          'drawbox=x=20:y=590:w=260:h=40:color=0xcccccc:t=fill[v]',
      ].join(';');
      const composed = await runFfmpeg({ binaries }, [
        ...['-y', '-i', reel, '-filter_complex', chrome, '-map', '[v]', '-map', '0:a'],
        ...softwareH264FixtureFlags(),
        ...['-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'copy', screen],
      ]);
      if (!composed.ok) throw new Error(composed.error.detail);
      const { draft } = await breakdown(binaries, screen, 'screenRecording');

      const crop = draft.reference.crop;
      console.warn(`MEASURE breakdown-screen-crop ${JSON.stringify(crop)} (drawn ${JSON.stringify(drawn)})`);
      expect(crop).not.toBeNull();
      if (!crop) return;
      for (const [found, want, side] of [
        [crop.x, drawn.x, 300],
        [crop.y, drawn.y, 650],
        [crop.x + crop.width, drawn.x + drawn.width, 300],
        [crop.y + crop.height, drawn.y + drawn.height, 650],
      ] as const)
        expect(Math.abs(found - want)).toBeLessThanOrEqual(side * 0.02);
      expect(draft.canvas.height / draft.canvas.width).toBeCloseTo(crop.height / crop.width, 1);
      const labels = syntheticLabels(spec);
      const cuts = resolveCuts(draft, []).cuts.map((cut) => cut.frame);
      expect(unmatched(cuts, labels.cuts)).toEqual({ missed: [], extra: [] });
    },
  );
});
