// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-F2: the deliverable is tagged BT.709 (primaries, transfer, matrix, limited range) on every finishing path, as
 * QA's codec check reads it. Under load the producer's own VideoToolbox probe times out, the render takes the CPU
 * route (an untagged ProRes mezzanine), and the re-encode used to leave primaries and transfer unset: FFmpeg takes
 * them from the frames, not from `-color_primaries`. Each path is forced here: the mezzanine through the machine's encoder,
 * the hardware encoder refused so OpenH264 takes over, HEVC, and a copied picture whose source left its colour unset. The
 * refusal is FFmpeg's own line (test/support/refusing.ts), read by the shared software retry (IX3-K4).
 */
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, type ComputeFallbackEvent } from '@taalcut/core';
import {
  backendOfEncoder,
  selectWorkingEncoder,
  softwareEncoderFor,
  type MediaContext,
} from '@taalcut/media';
import { finishRender } from '../../src/engine/finish';
import { presetFor } from '../../src/presets/presets.v1';
import { codecCheck } from '../../src/qa/checks/format';
import { readStreamFacts } from '../../src/qa/measure/stream-facts';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { hostVideo, type HostVideo } from '../support/host-video';
import { refusingHardware } from '../support/refusing';

const media = await findTestMedia('finish colour');
const RATE = FrameRate.of(30);
const COLOUR_FINDINGS = ['colorPrimaries', 'colorTransfer', 'colorSpace', 'colorRange'];

/** The codec check's colour findings for a delivered file (empty: tagged BT.709, limited range). */
async function colourFindings(ctx: MediaContext, path: string, preset: ReturnType<typeof presetFor>) {
  const facts = await readStreamFacts(ctx, path);
  if (!facts.ok) throw new Error(`stream facts: ${facts.error.code}`);
  return codecCheck(facts.value, preset)
    .findings.flatMap((finding) => (finding.target ? [finding.target.id] : []))
    .filter((id) => COLOUR_FINDINGS.includes(id));
}

describe.skipIf(!media.binaries)('finishing tags BT.709 on every path (IX-F2)', { timeout: 300_000 }, () => {
  let ctx: MediaContext;
  let host: HostVideo;
  let hevc: string | undefined;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let mezzanine: string;
  let untaggedH264: string;
  let mix: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    // The machine's encoders, proven on the real runner: a refusal below comes at run time, as under load.
    host = await hostVideo(ctx);
    const hevcChoice = await selectWorkingEncoder(ctx, 'hevc');
    hevc = hevcChoice.ok ? hevcChoice.value.encoder : undefined;
    work = await tempDir('finish-colour');
    mezzanine = join(work.dir, 'video.mov');
    untaggedH264 = join(work.dir, 'video.mp4');
    mix = join(work.dir, 'mix.m4a');
    const pattern = ['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30', '-frames:v', '30'];
    // What the producer's CPU route writes: ProRes with no colour of its own.
    await ffmpeg(ctx, [
      ...pattern,
      '-c:v',
      'prores_ks',
      '-profile:v',
      '3',
      '-pix_fmt',
      'yuv422p10le',
      mezzanine,
    ]);
    // A software-encoded H.264 picture without primaries or transfer (fixtures stay off VideoToolbox).
    await ffmpeg(ctx, [
      ...pattern,
      ...softwareH264FixtureFlags(),
      '-b:v',
      '4M',
      '-pix_fmt',
      'yuv420p',
      untaggedH264,
    ]);
    await ffmpeg(ctx, ['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=1', '-c:a', 'aac', '-b:a', '192k', mix]);
  });
  afterAll(() => work?.dispose());

  it("the CPU route: the mezzanine re-encoded on the machine's encoder", async () => {
    const preset = presetFor('device');
    const out = join(work.dir, 'cpu-route.mp4');
    const finished = await finishRender({ video: mezzanine, audio: mix, out, preset, rate: RATE, ctx });
    if (!finished.ok) throw new Error(finished.error.code);
    expect(finished.value.video).toBe(host.encoder);
    expect(await colourFindings(ctx, out, preset)).toEqual([]);
  });

  it('the hardware encoder refused: OpenH264 takes over, reported, and tags the same', async (test) => {
    if (!host.hardwareEncode) return test.skip();
    const preset = presetFor('device');
    const out = join(work.dir, 'openh264.mp4');
    const fallbacks: ComputeFallbackEvent[] = [];
    const refusing = refusingHardware();
    const finished = await finishRender({
      video: mezzanine,
      audio: mix,
      out,
      preset,
      rate: RATE,
      ctx: { ...ctx, runner: refusing.runner },
      onFallback: (event) => fallbacks.push(event),
    });
    if (!finished.ok) throw new Error(finished.error.code);
    expect(finished.value.video).toBe(softwareEncoderFor('h264'));
    expect(fallbacks).toEqual([
      {
        operation: 'render.encode',
        wanted: [backendOfEncoder(host.encoder)!.compute.encode],
        reason: 'accelerator_failed',
        detail: expect.stringMatching(
          /^the (VideoToolbox|NVENC) encoder would not start \((-12902|incompatible)/,
        ),
      },
    ]);
    expect(await colourFindings(ctx, out, preset)).toEqual([]);
  });

  it("HEVC: the picture re-encoded on the machine's HEVC encoder", async (test) => {
    if (!hevc) return test.skip();
    const preset = presetFor('deviceHevc');
    const out = join(work.dir, 'hevc.mp4');
    const finished = await finishRender({ video: mezzanine, audio: mix, out, preset, rate: RATE, ctx });
    if (!finished.ok) throw new Error(finished.error.code);
    expect(await colourFindings(ctx, out, preset)).toEqual([]);
  });

  it('HEVC refused: no software HEVC encoder, so the encode fails once, with no retry and no fallback', async (test) => {
    if (!hevc) return test.skip();
    const fallbacks: ComputeFallbackEvent[] = [];
    const refusing = refusingHardware();
    const finished = await finishRender({
      video: mezzanine,
      audio: mix,
      out: join(work.dir, 'hevc-refused.mp4'),
      preset: presetFor('deviceHevc'),
      rate: RATE,
      ctx: { ...ctx, runner: refusing.runner },
      onFallback: (event) => fallbacks.push(event),
    });
    expect(finished.ok).toBe(false);
    if (finished.ok) return;
    expect(finished.error.code).toBe('render.encode_failed');
    expect(finished.error.detail).toMatch(
      /Cannot create compression session: -12902|OpenEncodeSessionEx failed/,
    );
    expect(refusing.calls.filter((args) => args.includes(hevc!))).toHaveLength(1);
    expect(refusing.calls.some((args) => args.includes('libopenh264'))).toBe(false);
    expect(fallbacks).toEqual([]);
  });

  it('a copied picture whose source left primaries and transfer unset', async () => {
    const preset = presetFor('device');
    const out = join(work.dir, 'copied.mp4');
    const finished = await finishRender({ video: untaggedH264, audio: mix, out, preset, rate: RATE, ctx });
    if (!finished.ok) throw new Error(finished.error.code);
    expect(finished.value.video).toBe('copied');
    expect(await colourFindings(ctx, out, preset)).toEqual([]);
  });
});
