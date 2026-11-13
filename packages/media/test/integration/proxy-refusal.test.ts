// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K4 with the real FFmpeg: a proxy whose hardware encoder (VideoToolbox, NVENC) gets no session is made on
 * software decode and the platform CPU encoder, and keeps the proxy's contract (H.264, a closed 0.5 s GOP with no B-frames, the
 * 1280 rung's size, BT.709 tags). The runner plays the refusal with FFmpeg's own line (VideoToolbox's
 * `Cannot create compression session`, NVENC's `OpenEncodeSessionEx failed` when every session is taken), and
 * answers the encoder's trial encode, so nothing here reaches the hardware encoder: every run that does run is
 * software.
 */
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import {
  hardwareBackends,
  hardwareEncoderFor,
  makeProxy,
  probeMedia,
  runProcess,
  type MediaContext,
  type NormalisationPlan,
  type ProcessRunner,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { planClip, renderClip } from '../helpers/clip';
import { keyframeTimes } from '../helpers/keyframe-clips';

const found = await findTestBinaries('proxy on a refused hardware encoder');
const binaries = found.binaries;
const ROW = hardwareBackends(process.platform)[0];
const ENCODER = ROW && hardwareEncoderFor(ROW, 'h264');
/** FFmpeg's line for the refusal, and media's reading of it. */
const REFUSAL: Partial<Record<string, { readonly line: string; readonly detail: string }>> = {
  h264_videotoolbox: {
    line: '[h264_videotoolbox @ 0x1] Cannot create compression session: -12902\n',
    detail: 'the VideoToolbox encoder would not start (-12902)',
  },
  h264_nvenc: {
    line: '[h264_nvenc @ 0x1] OpenEncodeSessionEx failed: out of memory (10): (no details)\n',
    detail: 'the NVENC encoder would not start (out of memory (10): (no details))',
  },
};
const refusal = ENCODER ? REFUSAL[ENCODER] : undefined;

describe.skipIf(!binaries || !refusal)('a proxy whose hardware encoder refuses', () => {
  let dir: string;
  let clip: string;
  let plan: NormalisationPlan;

  beforeAll(async () => {
    if (!binaries) throw new Error('no FFmpeg');
    dir = await mkdtemp(join(tmpdir(), 'taalcut-proxy-refused-'));
    clip = join(dir, 'clip.mp4');
    // Two seconds of 1080p, software-encoded, so the proxy scales to its 1280 rung.
    const made = await renderClip({ binaries }, clip, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=2'],
      ...[...softwareH264FixtureFlags(), '-pix_fmt', 'yuv420p', '-g', '30'],
    ]);
    if (!made) throw new Error('fixture clip');
    const planned = await planClip(clip, { binaries });
    if (!planned.ok) throw new Error(planned.error.code);
    plan = planned.value;
  }, 120_000);

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('makes it on software decode and the platform CPU encoder, with the same contract, and says so', async () => {
    if (!binaries) throw new Error('no FFmpeg');
    expect(plan.decode.backend).toBe(ROW);
    const proxyRuns: string[] = [];
    const runner: ProcessRunner = async (command, args, options) => {
      const text = args.join(' ');
      const hardware = text.includes(ENCODER!) && !text.includes('-require_sw 1');
      // The encoder's trial encode, answered: the encoder opens for it.
      if (hardware && text.includes('testsrc2'))
        return ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 });
      if (text.includes(`file:${clip}`) && text.includes(' -c:v ')) proxyRuns.push(text);
      if (hardware)
        return ok({
          exitCode: 1,
          signal: null,
          stdout: Buffer.alloc(0),
          stderrTail: refusal!.line,
          durationMs: 1,
        });
      return runProcess(command, args, options);
    };
    const events: ComputeFallbackEvent[] = [];
    const ctx: MediaContext = { binaries, runner, onComputeFallback: (event) => events.push(event) };
    const out = join(dir, 'proxy.mp4');
    const sizeBytes = Math.max((await stat(clip)).size, 50_000_000);
    const made = await makeProxy(clip, plan, ctx, { out, sizeBytes, contentHash: 'ab'.repeat(32) });
    expect(made.ok && made.value.reusedOriginal).toBe(false);
    expect(made.ok && made.value.file).toMatchObject({ width: 1280, height: 720 });
    expect(proxyRuns).toHaveLength(2);
    expect(proxyRuns[0]).toContain(`-hwaccel ${ROW}`);
    expect(proxyRuns[0]).toContain(`-c:v ${ENCODER}`);
    expect(proxyRuns[1]).not.toContain('-hwaccel');
    expect(proxyRuns[1]).toContain(softwareH264FixtureFlags().join(' '));
    expect(events).toContainEqual(
      expect.objectContaining({
        operation: 'media.encode',
        reason: 'accelerator_failed',
        detail: refusal!.detail,
      }),
    );

    const probed = await probeMedia(out, ctx);
    expect(probed.ok && probed.value.video).toMatchObject({
      codec: 'h264',
      width: 1280,
      height: 720,
      pixelFormat: 'yuv420p',
      colour: { primaries: 'bt709', transfer: 'bt709', space: 'bt709', range: 'tv' },
    });
    expect(await keyframeTimes(ctx, out)).toEqual([0, 0.5, 1, 1.5]);
    const bFrames = await runProcess(binaries.ffprobe, [
      ...['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=has_b_frames'],
      ...['-of', 'csv=p=0', out],
    ]);
    expect(bFrames.ok && bFrames.value.stdout.toString('utf8').trim()).toBe('0');
  }, 120_000);
});
