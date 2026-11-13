// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** File-format checks on fixtures made with the bundled FFmpeg (docs/qa-gate.md, "File format"). */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import { presetFor } from '../../src/presets/presets.v1';
import {
  aspectRatioCheck,
  bitrateCheck,
  codecCheck,
  containerCheck,
  formatChecks,
  frameRateCheck,
  resolutionCheck,
} from '../../src/qa/checks/format';
import { parseStreamFacts, readStreamFacts } from '../../src/qa/measure/stream-facts';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { PASS_AUDIO, passFixture, qaPlan, target } from './support';

const media = await findTestMedia('qa format');
const plan = qaPlan({ durationFrames: 60 });
const device = presetFor('device');

describe.skipIf(!media.binaries)('format checks', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  const path = (name: string) => join(work.dir, `${name}.mp4`);
  const read = async (name: string) => {
    const result = await readStreamFacts(ctx, path(name));
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('qa-format');
    await passFixture(ctx, path('pass'));
    await passFixture(ctx, path('noFaststart'), { faststart: false });
    await passFixture(ctx, path('square'), { size: '1080x1080' });
    await passFixture(ctx, path('sampleRate'), { extra: ['-ar', '44100'] });
    await passFixture(ctx, path('rate25'), { rate: '25', seconds: 2.4 });
    await passFixture(ctx, path('lowBitrate'), { extra: ['-b:v', '2M'] });
    await ffmpeg(ctx, [
      '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=2',
      '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', ...PASS_AUDIO, '-movflags', '+faststart', path('mpeg4'),
    ]);
    await passFixture(ctx, path('landscape'), { size: '1920x1080' });
    await ffmpeg(ctx, ['-display_rotation:v:0', '90', '-i', path('landscape'), '-c', 'copy', path('rotated')]);
    await passFixture(ctx, path('dropped'), {
      extra: ['-vf', "select='not(eq(n,10))',setpts=N/30/TB", '-fps_mode', 'vfr'],
    });
  });
  afterAll(() => work.dispose());

  it('passes every format check on the pass recipe', async () => {
    const results = formatChecks(await read('pass'), plan, device, target);
    expect(results.map((check) => [check.id, check.status])).toEqual([
      ['container', 'pass'],
      ['codec', 'pass'],
      ['resolution', 'pass'],
      ['aspectRatio', 'pass'],
      ['frameRate', 'pass'],
      ['duration', 'pass'],
      ['bitrate', 'pass'],
    ]);
  });

  it('fails the container without faststart, and remuxes', async () => {
    const result = containerCheck(await read('noFaststart'));
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.target?.id)).toEqual(['faststart']);
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'remux' }]);
    expect(result.overridable).toBe(false);
  });

  it('fails the codec for MPEG-4 Part 2 and for 44.1 kHz audio, and re-encodes', async () => {
    const mpeg4 = codecCheck(await read('mpeg4'), device);
    expect(mpeg4.status).toBe('fail');
    expect(mpeg4.findings.map((finding) => finding.target?.id)).toContain('videoCodec');
    const audio = codecCheck(await read('sampleRate'), device);
    expect(audio.findings.map((finding) => finding.target?.id)).toEqual(['sampleRate']);
    expect(audio.fixes).toEqual([{ kind: 'auto', action: 'reencode' }]);
  });

  it('fails resolution and aspect ratio for a square file', async () => {
    const square = await read('square');
    expect(resolutionCheck(square, plan).status).toBe('fail');
    const aspect = aspectRatioCheck(square, plan);
    expect(aspect.status).toBe('fail');
    expect(aspect.fixes).toEqual([{ kind: 'auto', action: 'rerender' }]);
  });

  it('fails the aspect ratio for a landscape file carrying rotation side data', async () => {
    const rotated = await read('rotated');
    expect(rotated.video[0]!.rotation).not.toBe(0);
    const result = aspectRatioCheck(rotated, plan);
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.target?.id)).toContain('rotation');
  });

  it('fails the frame rate at 25 fps and for a file missing a frame', async () => {
    expect(frameRateCheck(await read('rate25'), plan).status).toBe('fail');
    const dropped = frameRateCheck(await read('dropped'), plan);
    expect(dropped.status).toBe('fail');
    expect(dropped.findings).toContainEqual(expect.objectContaining({ measured: { value: 59, unit: 'frames' } }));
  });

  it('warns, never fails, on a bitrate far from the preset', async () => {
    const result = bitrateCheck(await read('lowBitrate'), device, plan);
    expect(result.status).toBe('warn');
    expect(result.threshold).toEqual({ min: 6000, max: 10000, unit: 'kbps' });
    expect(result.fixes).toEqual([{ kind: 'auto', action: 'reencode' }]);
  });

  it('parses recorded ffprobe output without a file', () => {
    const parsed = parseStreamFacts(
      { streams: [{ codec_type: 'video', codec_name: 'hevc', profile: 'Main', codec_tag_string: 'hev1' }], format: {} },
      ['ftyp', 'mdat', 'moov'],
    );
    expect(parsed.faststart).toBe(false);
    const hevc = codecCheck(parsed, presetFor('deviceHevc'));
    expect(hevc.findings.map((finding) => finding.target?.id)).toContain('tag');
  });
});
