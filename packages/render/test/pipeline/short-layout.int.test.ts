// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrameRate, newId, RationalTime, type ClipVisualLayout, type Timeline } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFrame } from '../../src/engine/capture-frame';
import { openTextProbe, segmentColourSampler } from '../../src/engine/qa-probes';
import { renderVideo } from '../../src/engine/render-video';
import { planFramingWith } from '../../src/engine/stages/framing';
import { planTimeline } from '../../src/plan/render-plan';
import { presetFor } from '../../src/presets/presets.v1';
import { layoutSubjectCheck } from '../../src/qa/checks/visual-layout';
import { fakeWorld } from '../router/fixtures';
import { ffmpeg, findTestMedia, mediaContext, patchColour, tempDir } from '../support/media';
import { FIXTURE_H264 } from '../support/host-video';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('short-layout');
const shell = findTestShell('short-layout');
const rate = FrameRate.of(30);
const t = (frame: number) => RationalTime.of(frame, rate);
const layout: ClipVisualLayout = {
  regions: [0, 1].map((index) => ({
    id: `person-${index}`,
    fit: 'contain',
    viewport: { x: 0, y: index / 2, width: 1, height: 0.5 },
    keyframes: [{ at: t(0), crop: { x: index / 2, y: 0, width: 0.5, height: 1 } }],
  })),
};

describe.skipIf(!media.binaries || !shell.path)('native short layout pixels', { timeout: 240_000 }, () => {
  const ctx = media.binaries ? mediaContext(media.binaries) : null;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let timeline: Timeline;
  let source: string;
  beforeAll(async () => {
    work = await tempDir('short-layout');
    source = join(work.dir, 'two-panels.mp4');
    await ffmpeg(ctx!, [
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=960x1080:r=30:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=960x1080:r=30:d=1',
      '-filter_complex',
      '[0:v][1:v]hstack=inputs=2[v]',
      '-map',
      '[v]',
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '10M',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const assetId = newId<'Asset'>();
    const base = makeTimeline({
      rate,
      music: { path: 'none' },
      items: [0, 1].map(() => ({
        assetId,
        frames: 30,
        sourceStart: 0,
        mediaFrames: 30,
        muted: true,
        fit: 'contain',
      })),
    });
    timeline = {
      ...base,
      tracks: base.tracks.map((track) =>
        track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item, index) =>
                item.type === 'clip'
                  ? {
                      ...item,
                      visualLayout:
                        index === 0
                          ? layout
                          : {
                              regions: layout.regions.map((region) => ({
                                ...region,
                                keyframes: region.keyframes.map((key) => ({
                                  ...key,
                                  crop: { ...key.crop, x: 0.5 - key.crop.x },
                                })),
                              })),
                            },
                    }
                  : item,
              ),
            }
          : track,
      ),
    };
  });
  afterAll(async () => work?.dispose());

  it('renders both original source halves, matches preview, and verifies their DOM geometry', async () => {
    const plan = planTimeline(timeline);
    if (!plan.ok) throw new Error(plan.error.code);
    const visual = plan.value.visuals[0]!;
    const preset = presetFor('device');
    const framed = await planFramingWith(
      { media: ctx!, burnCaptions: false, trackMissing: false, conform: true },
      {
        timeline,
        plan: plan.value,
        preset,
        captionLayout: () => {
          throw new Error('No captions');
        },
        sources: new Map(plan.value.visuals.map((item) => [item.id, { path: source }])),
      },
    );
    if (!framed.ok || !framed.value) throw new Error('No framing');
    const info = await stat(source);
    const rendered = await renderVideo({
      timeline,
      preset,
      burnCaptions: false,
      source: () => ({ path: source, size: info.size, mtimeMs: info.mtimeMs }),
      ctx: ctx!,
      conformDir: join(work.dir, 'conform'),
      workDir: join(work.dir, 'render'),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 1,
      compose: framed.value.compose,
      geometry: framed.value.geometry,
    });
    if (!rendered.ok) throw new Error(`${rendered.error.code}: ${rendered.error.detail ?? ''}`);
    const sampleUnder = segmentColourSampler(
      plan.value,
      rendered.value.segments,
      ctx!,
      framed.value.compose.framing?.sourceSizes,
    );
    expect(await sampleUnder(10, { x: 500, y: 440, width: 80, height: 80 })).toMatch(
      /^#f[0-9a-f]0[0-9a-f]0[0-9a-f]$/,
    );
    expect(await sampleUnder(10, { x: 500, y: 1400, width: 80, height: 80 })).toMatch(
      /^#0[0-9a-f]0[0-9a-f]f[0-9a-f]$/,
    );
    const world = await fakeWorld(join(work.dir, 'world'), { ctx: ctx!, shell: shell.path! });
    world.originals.set(visual.assetId, source);
    world.timelines.set(timeline.id, timeline);
    for (const at of [10, 40]) {
      const captured = await captureFrame(world.deps, {
        projectId: timeline.projectId,
        timelineId: timeline.id,
        frame: at,
        source: { kind: 'preview' },
        maxDimension: 1920,
      });
      if (!captured.ok) throw new Error(`${captured.error.code}: ${captured.error.detail ?? ''}`);
      const preview = join(work.dir, `preview-${at}.jpg`);
      await writeFile(preview, Buffer.from(captured.value.dataBase64, 'base64'));
      for (const [y, channel] of [
        [480, at < 30 ? 0 : 2],
        [1440, at < 30 ? 2 : 0],
      ] as const) {
        const picture = await patchColour(ctx!, rendered.value.video, at, { x: 540, y, size: 16 });
        const still = await patchColour(ctx!, preview, 0, { x: 540, y, size: 16 });
        expect(picture[channel]).toBeGreaterThan(200);
        still.forEach((value, index) => expect(Math.abs(value - picture[index]!)).toBeLessThan(12));
      }
    }
    const probe = await openTextProbe({
      timeline,
      options: { ...framed.value.compose, preset, burnCaptions: false },
      dir: join(work.dir, 'probe'),
      ctx: ctx!,
      chromePath: shell.path!,
      browserGpu: 'hardware',
    });
    if (!probe.ok) throw new Error(probe.error.code);
    try {
      const readings = await probe.value.probeFrame([0, 29, 30, 59]);
      expect(readings.visuals).toHaveLength(16);
      expect(
        layoutSubjectCheck({
          clips: framed.value.qa.layouts!,
          canvas: { width: 1080, height: 1920 },
          rate,
          probed: readings.visuals,
        }).status,
      ).toBe('pass');
    } finally {
      await probe.value.close();
    }
  });
});
