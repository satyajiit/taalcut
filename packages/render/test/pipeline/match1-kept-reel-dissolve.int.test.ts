// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 through a real render: the reel dissolves from the creator's shot into a film shot the template keeps.
 * The timeline package assembles the video (the person's clip, the dissolve drawn again, a held clean frame of
 * the reel, then the reel's footage) and the bundled FFmpeg and the pinned shell render it. Every frame of the reel
 * and of the person's clip has its own colour, so the render says what each output frame shows: the person's clip,
 * then a blend of the person's clip with the reel's first clean frame and nothing else, then the reel from that
 * frame on. No frame the reel itself blended (frames 7 to 12) appears anywhere.
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
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { assemble, reelMedia } from '@taalcut/timeline';
import { renderVideo } from '../../src/engine/render-video';
import { presetFor } from '../../src/presets/presets.v1';
import { ffmpeg, findTestMedia, mediaContext, patchColours, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('match1-kept-reel-dissolve');
const shell = findTestShell('match1-kept-reel-dissolve');
const rate = FrameRate.of(30);
const at = (frames: number) => RationalTime.of(frames, rate);

type Rgb = readonly number[];
/** Frame n of the reel, and of the person's clip (the same primes on other channels). */
const reelColour = (n: number): Rgb => [(n * 37 + 20) % 256, (n * 91 + 40) % 256, (n * 53 + 60) % 256];
const mineColour = (n: number): Rgb => [(n * 53 + 60) % 256, (n * 37 + 20) % 256, (n * 91 + 40) % 256];
const REEL_GEQ = "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p";
const MINE_GEQ = "geq=r='mod(N*53+60,256)':g='mod(N*37+20,256)':b='mod(N*91+40,256)',format=yuv444p";
const far = (a: Rgb, b: Rgb) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]!) ** 2, 0));

/** How much of `to` is in a colour that lies between `from` and `to`, and how far the colour is off that line. */
function between(colour: Rgb, from: Rgb, to: Rgb): { share: number; off: number } {
  const line = to.map((value, i) => value - from[i]!);
  const length = line.reduce((sum, value) => sum + value * value, 0);
  const share = colour.reduce((sum, value, i) => sum + (value - from[i]!) * line[i]!, 0) / length;
  return {
    share,
    off: far(
      colour,
      from.map((value, i) => value + share * line[i]!),
    ),
  };
}

/** The slots: the creator's shot (0–9), a film shot (10–17) the reel dissolves into over 7–12, and its end. */
const SLOTS = [
  { start: 0, frames: 10 },
  { start: 10, frames: 8 },
  { start: 18, frames: 4 },
];
const BLEND = { before: 3, after: 3 };
const CLEAN = 13;
const IN_POINT = 20;

function reelTemplate(): Template {
  const film = { from: 'reel', by: 'analyst', reason: 'A film scene the cut lands on' };
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
      source: { duration: at(22), rate, width: 108, height: 192 },
      crop: null,
      pipelineVersion: '8',
      configVersion: '1',
      analysedAt: 0,
    },
    canvas: { width: 1080, height: 1920, rate },
    duration: at(22),
    slots: SLOTS.map(({ start, frames }, index) => ({
      id: newId<'TemplateSlot'>(),
      name: null,
      role: index === 0 ? 'hook' : index === 2 ? 'outro' : 'body',
      start: at(start),
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
      transitionIn:
        index === 1
          ? {
              kind: 'dissolve',
              before: at(BLEND.before),
              after: at(BLEND.after),
              direction: null,
              confidence: 0.95,
            }
          : null,
      speedRamp: null,
      cut: { method: index === 1 ? 'both' : 'both', confidence: 1 },
      approved: false,
      frame: null,
      ...(index > 0 ? { footage: film } : {}),
    })),
    beatMap: null,
    text: [],
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
    pacing: {
      shotCount: 3,
      meanShot: at(7),
      medianShot: at(8),
      shortestShot: at(4),
      longestShot: at(10),
      hookEnd: at(10),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: null,
    language: null,
  });
}

describe.skipIf(!media.binaries || !shell.path)(
  'a kept reel clip after the reel’s dissolve (MATCH1)',
  { timeout: 240_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('match1-kept-reel-dissolve');
    });
    afterAll(async () => work?.dispose());

    it('renders the person’s clip dissolving into the reel’s first clean frame, then the reel from it', async () => {
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
          pick: { assetId: mine, shotId, sourceStart: at(IN_POINT), syncPoint: null, score: 1, parts },
          confidence: 1,
          note: null,
        },
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
          name: 'Kept reel after a dissolve',
          now: 1,
        },
        { item: () => newId<'TimelineItem'>() },
      );
      if (!assembled.ok) throw new Error(assembled.error.code);
      const video = assembled.value.tracks[0]!.items;
      expect(video.map((item) => (item.type === 'clip' && item.holdFrame ? 'hold' : item.type))).toEqual([
        'clip',
        'transition',
        'hold',
        'clip',
        'clip',
      ]);

      const rendered = await renderVideo({
        timeline: assembled.value,
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
      expect(colours).toHaveLength(22);

      // Before the dissolve: the person's clip alone, frame for frame.
      const cut = SLOTS[1]!.start;
      for (let frame = 0; frame < cut - BLEND.before; frame++)
        expect(far(colours[frame]!, mineColour(IN_POINT + frame)), `frame ${frame}`).toBeLessThan(12);

      // The dissolve, as long as the reel's: each frame is the person's clip (running on) and the reel's first
      // clean frame, and nothing else; the reel's share only grows.
      const clean = reelColour(CLEAN);
      const shares: number[] = [];
      for (let frame = cut - BLEND.before; frame < cut + BLEND.after; frame++) {
        const mix = between(colours[frame]!, mineColour(IN_POINT + frame), clean);
        expect(mix.off, `frame ${frame} is the person's clip and reel ${CLEAN} only`).toBeLessThan(14);
        shares.push(mix.share);
      }
      for (const [index, share] of shares.entries()) {
        expect(share).toBeGreaterThan(-0.05);
        expect(share).toBeLessThan(1.05);
        if (index > 0) expect(share).toBeGreaterThan(shares[index - 1]! - 0.02);
      }
      expect(shares[0]!).toBeLessThan(0.4);
      expect(shares.at(-1)!).toBeGreaterThan(0.6);

      // After it: the reel from its first clean frame, exactly; the frames it blended (7 to 12) never show.
      for (let frame = cut + BLEND.after; frame < 22; frame++)
        expect(far(colours[frame]!, reelColour(frame)), `frame ${frame}`).toBeLessThan(12);
      for (const [frame, colour] of colours.entries())
        for (let blended = 7; blended < CLEAN; blended++)
          expect(far(colour, reelColour(blended)), `frame ${frame} is not reel ${blended}`).toBeGreaterThan(
            20,
          );
    });
  },
);
