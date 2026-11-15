// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1 through a real render: a template states its last two slots as the reel's own footage, the timeline
 * package assembles the video (the person's clip, then two clips of the reel), and the bundled FFmpeg and the pinned
 * shell render it. Every frame of the reel and of the person's clip has its own colour, so the render says which
 * source frame each output frame shows: the person's clip from its in-point, then the reel's frames of each kept
 * slot, exactly, with nothing black between.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FrameRate,
  newId,
  RationalTime,
  templateSchema,
  type AssetId,
  type SlotCast,
  type Template,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { assemble, reelMedia } from '@taalcut/timeline';
import { renderVideo } from '../../src/engine/render-video';
import { presetFor } from '../../src/presets/presets.v1';
import { ffmpeg, findTestMedia, mediaContext, patchColours, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('keep1-kept-reel');
const shell = findTestShell('keep1-kept-reel');
const rate = FrameRate.of(30);
const at = (frames: number) => RationalTime.of(frames, rate);

/** Frame n of the reel, and of the person's clip (the same primes on other channels). */
const reelColour = (n: number) => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];
const mineColour = (n: number) => [(n * 53 + 60) % 256, (n * 37 + 20) % 256, (n * 91 + 40) % 256];
const REEL_GEQ = "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p";
const MINE_GEQ = "geq=r='mod(N*53+60,256)':g='mod(N*37+20,256)':b='mod(N*91+40,256)',format=yuv444p";

/** Which frame of which file a colour is: `reel 12`, `mine 40`. */
function shown(colour: readonly number[]): string {
  let best = '';
  let distance = Infinity;
  for (const [name, of] of [
    ['reel', reelColour],
    ['mine', mineColour],
  ] as const)
    for (let n = 0; n < 60; n++) {
      const d = of(n).reduce((sum, value, index) => sum + (value - (colour[index] ?? 0)) ** 2, 0);
      if (d < distance) {
        distance = d;
        best = `${name} ${n}`;
      }
    }
  return best;
}

/** The reel's template: the creator's shot (frames 0–7), a film scene (8–13) and its end (14–17). */
function reelTemplate(): Template {
  const lengths = [8, 6, 4];
  const starts = [0, 8, 14];
  const film = { from: 'reel', by: 'analyst', reason: 'A film scene the joke lands on' };
  return templateSchema.parse({
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: 0,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://example.com/reel/1',
      fingerprint: 'a'.repeat(64),
      source: { duration: at(18), rate, width: 108, height: 192 },
      crop: null,
      pipelineVersion: '1',
      configVersion: '1',
      analysedAt: 0,
    },
    canvas: { width: 1080, height: 1920, rate },
    duration: at(18),
    slots: lengths.map((frames, index) => ({
      id: newId<'TemplateSlot'>(),
      name: null,
      role: index === 0 ? 'hook' : index === 2 ? 'outro' : 'body',
      start: at(starts[index]!),
      duration: at(frames),
      intent: {
        text: `shot ${index}`,
        shotType: null,
        motion: null,
        subject: null,
        people: null,
        place: null,
        energy: 0.5,
        source: 'analyst',
      },
      beatAnchor: null,
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both', confidence: 1 },
      approved: false,
      frame: null,
      ...(index > 0 ? { footage: film } : {}),
    })),
    beatMap: null,
    text: [],
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: 3,
      meanShot: at(6),
      medianShot: at(6),
      shortestShot: at(4),
      longestShot: at(8),
      hookEnd: at(8),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: null,
    language: null,
  });
}

describe.skipIf(!media.binaries || !shell.path)(
  'a video that keeps the reel’s footage',
  { timeout: 240_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('keep1-kept-reel');
    });
    afterAll(async () => work?.dispose());

    it('renders the person’s clip, then the reel’s own frames of each kept slot', async () => {
      const files = new Map<AssetId, { path: string; size: number; mtimeMs: number }>();
      const reel = newId<'Asset'>();
      const mine = newId<'Asset'>();
      for (const [asset, name, geq] of [
        [reel, 'reel', REEL_GEQ],
        [mine, 'mine', MINE_GEQ],
      ] as const) {
        const file = join(work.dir, `${name}.mp4`);
        const input = ['-f', 'lavfi', '-i', 'nullsrc=s=108x192:r=30:d=2', '-vf', geq];
        await ffmpeg(ctx, [...input, '-c:v', FIXTURE_H264, '-b:v', '20M', '-pix_fmt', 'yuv420p', file]);
        const info = await stat(file);
        files.set(asset, { path: file, size: info.size, mtimeMs: info.mtimeMs });
      }
      const template = reelTemplate();
      const shotId = newId<'Shot'>();
      const parts = {
        intent: 1,
        motion: 0,
        quality: 1,
        subject: 0,
        energy: 0,
        hook: null,
        rerank: null,
        penalty: 0,
      };
      const none = { clipId: null, pick: null, alternates: [], confidence: null, needsRerank: false };
      const slots: SlotCast[] = [
        {
          ...none,
          slotId: template.slots[0]!.id,
          pick: { assetId: mine, shotId, sourceStart: at(40), syncPoint: null, score: 1, parts },
          confidence: 1,
          note: 'userPick',
        },
        // What casting answers for a reel slot: nothing picked.
        { ...none, slotId: template.slots[1]!.id, note: 'reelKept' },
        { ...none, slotId: template.slots[2]!.id, note: 'reelKept' },
      ];
      const assembled = assemble(
        {
          projectId: newId<'Project'>(),
          template,
          variant: {
            slots,
            score: 1,
            sequenceConfidence: 1,
            media: [{ kind: 'video', assetId: mine, shotId, available: { start: at(0), duration: at(60) } }],
          },
          cast: {
            castId: newId<'Cast'>(),
            mode: 'template',
            variantIndex: 0,
            variantCount: 1,
            configVersion: 'test',
          },
          reel: reelMedia(template, reel),
          timelineId: newId<'Timeline'>(),
          name: 'Kept reel',
          now: 1,
        },
        { item: () => newId<'TimelineItem'>() },
      );
      if (!assembled.ok) throw new Error(assembled.error.code);
      const timeline: Timeline = assembled.value;
      const video = timeline.tracks[0]!.items;
      expect(video.map((item) => item.type)).toEqual(['clip', 'clip', 'clip']);

      const rendered = await renderVideo({
        timeline,
        preset: presetFor('device'),
        burnCaptions: false,
        source: (visual) => files.get(visual.assetId),
        ctx,
        conformDir: join(work.dir, 'conform'),
        workDir: join(work.dir, 'work'),
        chromePath: shell.path!,
        browserGpu: 'hardware',
        gpuEncode: true,
        workers: 'auto',
      });
      if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
      const colours = await patchColours(ctx, rendered.value.video, { x: 500, y: 900, size: 16 });
      expect(colours.map(shown)).toEqual([
        ...Array.from({ length: 8 }, (_, i) => `mine ${40 + i}`),
        ...Array.from({ length: 6 }, (_, i) => `reel ${8 + i}`),
        ...Array.from({ length: 4 }, (_, i) => `reel ${14 + i}`),
      ]);
    });
  },
);
