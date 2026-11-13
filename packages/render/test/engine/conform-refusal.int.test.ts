// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K4: conform's segment encode and still on the shared software retry. The machine's hardware (VideoToolbox on
 * a Mac, NVDEC/NVENC on NVIDIA) refusing its decoder, or only its encoder, runs the segment once more with no
 * hardware at all (software decode, OpenH264), reported once as `accelerator_failed` with FFmpeg's reason; a still
 * decode refused runs again on the CPU scale. The refusal is played (test/support/refusing.ts); every run here is
 * software. A machine with no hardware route has nothing to refuse: those tests skip.
 */
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId, type ComputeFallbackEvent } from '@taalcut/core';
import { HardwareFailures, probeMedia, type MediaContext } from '@taalcut/media';
import { conformVisual } from '../../src/engine/conform';
import { hostVideo, type HostVideo } from '../support/host-video';
import { refusingHardware } from '../support/refusing';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { plannedVisual } from '../support/planned';

const media = await findTestMedia('conform refusal');
const rate = FrameRate.of(30);

describe.skipIf(!media.binaries)('conform when the hardware refuses', { timeout: 240_000 }, () => {
  let ctx: MediaContext;
  let host: HostVideo;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let clip: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    // The machine's rows and encoder, proven on the real runner: the refusal comes at run time, as under load.
    host = await hostVideo(ctx);
    work = await tempDir('conform-refusal');
    clip = join(work.dir, 'clip.mp4');
    // Software-encoded, so the fixture never touches VideoToolbox.
    await ffmpeg(ctx, [
      ...['-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=30:d=1'],
      ...[...softwareH264FixtureFlags(), '-b:v', '2M', '-pix_fmt', 'yuv420p', clip],
    ]);
  });
  afterAll(async () => work?.dispose());

  const conform = async (context: MediaContext, kind: 'video' | 'image' = 'video') => {
    const fallbacks: [string, string, string][] = [];
    const onFallback = (event: ComputeFallbackEvent) =>
      fallbacks.push([event.operation, event.reason, event.detail ?? '']);
    const info = await stat(clip);
    const result = await conformVisual(
      plannedVisual(6, { kind }),
      { path: clip, size: info.size, mtimeMs: info.mtimeMs },
      {
        dir: join(work.dir, `conform-${newId()}`),
        rate,
        // Past NVENC's smallest frame (146×50), so an NVIDIA machine's first route is its hardware.
        width: 216,
        height: 384,
        ctx: context,
        onFallback,
      },
    );
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    expect((await stat(result.value.file)).size).toBeGreaterThan(0);
    return { segment: result.value, fallbacks };
  };

  it('runs a refused segment again with no hardware at all, reported once', async (test) => {
    if (!host.decode || !host.hardwareEncode) return test.skip();
    const refusing = refusingHardware();
    const { segment, fallbacks } = await conform({ ...ctx, runner: refusing.runner });
    expect(segment.decode).toBe('software');
    expect(fallbacks).toEqual([
      ['render.conformDecode', 'accelerator_failed', expect.stringMatching(/decoder would not start/)],
    ]);
    const ffmpegRuns = refusing.calls.filter((args) => args.includes('-frames:v'));
    expect(ffmpegRuns).toHaveLength(2);
    expect(ffmpegRuns[0]).toContain('-hwaccel');
    const retry = ffmpegRuns[1] ?? [];
    expect(retry).not.toContain('-hwaccel');
    expect(retry.join(' ')).toContain(softwareH264FixtureFlags().join(' '));
    expect(retry.join(' ')).not.toMatch(/_vt|_cuda|nvenc/);
  });

  it('runs a segment whose encoder alone is refused on OpenH264 too, after a planned software decode', async (test) => {
    if (!host.hardwareEncode) return test.skip();
    const probe = await probeMedia(clip, ctx);
    if (!probe.ok || !probe.value.video) throw new Error('probe failed');
    const failures = new HardwareFailures();
    failures.remember(probe.value.video, {
      code: 'hardware_failed',
      detail: 'test forces software decode',
    });
    const refusing = refusingHardware({ decode: false });
    const { segment, fallbacks } = await conform({
      ...ctx,
      hardwareFailures: failures,
      runner: refusing.runner,
    });
    expect(segment.decode).toBe('software');
    // The remembered failure is media's `hardware_failed`: core's `accelerator_failed`, as media reports it.
    expect(fallbacks.map(([operation, reason]) => [operation, reason])).toEqual([
      ['render.conformDecode', 'accelerator_failed'],
      ['render.conformDecode', 'accelerator_failed'],
    ]);
    expect(fallbacks[0]?.[2]).toMatch(/test forces software decode/);
    expect(fallbacks[1]?.[2]).toMatch(/encoder would not start \((-12902|incompatible client key)/);
    expect(segment.fallback).toMatch(/encoder would not start/);
  });

  it('decodes a refused still again on the CPU scale', async (test) => {
    // NVDEC decodes no stills (media's row): its stills never take a hardware route to be refused on.
    if (!host.decodesStills) return test.skip();
    const refusing = refusingHardware();
    const { segment, fallbacks } = await conform({ ...ctx, runner: refusing.runner }, 'image');
    expect(segment.decode).toBe('software');
    expect(fallbacks).toEqual([
      ['render.conformStill', 'accelerator_failed', expect.stringMatching(/decoder would not start/)],
    ]);
  });
});
