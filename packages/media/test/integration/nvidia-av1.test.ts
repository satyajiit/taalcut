// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-AV1 on the Linux build with an NVIDIA GPU: `hardwareEncoders` names the working encoders, and the export
 * flags (videoEncodeFlags, purpose 'export') write AV1 Main 8-bit BT.709 and 10-bit BT.2020 HLG on av1_nvenc, HEVC
 * Main (hvc1) and Main 10 on hevc_nvenc, and AV1 on SVT-AV1 (the CPU fallback), each probed: codec, profile, sample
 * entry, pixel format and colour, in the container and, for AV1, in the sequence header alone (the raw OBUs).
 * The AV1 encodes skip on a GPU whose AV1 trial fails (before Ada); everything skips off Linux, without the
 * verified build, or when no NVIDIA GPU opens.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  colourBitstreamFilter,
  hardwareEncoders,
  hwVideoBackend,
  runFfmpeg,
  runProcess,
  SDR_COLOR,
  videoEncodeFlags,
  type HardwareEncoders,
  type HdrTransfer,
  type MediaContext,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { renderClip } from '../helpers/clip';

const found = await findTestBinaries('NVENC AV1 and HEVC on Linux');
const binaries = process.platform === 'linux' && found.binaries?.verified ? found.binaries : undefined;
const gpu =
  binaries !== undefined &&
  (await runFfmpeg({ binaries }, hwVideoBackend('cuda').deviceTrial ?? [], { timeoutMs: 60_000 })).ok;

const SDR = { color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', color_range: 'tv' };
const HLG = {
  color_primaries: 'bt2020',
  color_transfer: 'arib-std-b67',
  color_space: 'bt2020nc',
  color_range: 'tv',
};

describe.skipIf(!binaries || !gpu)('NVENC AV1 and HEVC exports on Linux', { timeout: 180_000 }, () => {
  const ctx: MediaContext = { binaries: binaries!, platform: 'linux' };
  let dir: string;
  let clip: string;
  let encoders: HardwareEncoders;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-nvidia-av1-'));
    clip = join(dir, 'clip.mp4');
    // Two seconds of a portrait 1080×1920 picture at 30 fps, tagged BT.709 limited range.
    const made = await renderClip({ binaries: binaries! }, clip, [
      ...['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=2'],
      ...['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-g', '30', '-b:v', '20M'],
      ...SDR_COLOR,
      ...['-bsf:v', colourBitstreamFilter('h264')],
    ]);
    if (!made) throw new Error('fixture clip');
    const asked = await hardwareEncoders(ctx);
    if (!asked.ok) throw new Error(asked.error.code);
    encoders = asked.value;
  }, 120_000);
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  /** The clip encoded with `encoder`'s export flags at 8 Mb/s, a one-second GOP; 10-bit when `hdr`. */
  async function encode(encoder: string, name: string, hdr?: HdrTransfer): Promise<string> {
    const out = join(dir, name);
    const picture = hdr
      ? // A real HLG signal from the SDR picture, not a retag (as media's HDR test makes one).
        `zscale=pin=bt709:tin=bt709:min=bt709:rin=tv:p=bt2020:t=${hdr === 'hlg' ? 'arib-std-b67' : 'smpte2084'}:m=bt2020nc:r=tv:npl=203,format=${encoder === 'libsvtav1' ? 'yuv420p10le' : 'p010le'}`
      : 'format=yuv420p';
    const ran = await runFfmpeg(
      ctx,
      [
        ...['-y', '-i', clip, '-map', '0:v:0', '-vf', picture],
        ...videoEncodeFlags(encoder, 8_000_000, 30, { purpose: 'export', ...(hdr ? { hdr } : {}) }),
        ...['-an', out],
      ],
      { timeoutMs: 120_000 },
    );
    if (!ran.ok) throw new Error(`${encoder}: ${ran.error.detail ?? ran.error.code}`);
    return out;
  }

  /** ffprobe's first video stream of `path`. */
  async function stream(path: string): Promise<Record<string, unknown>> {
    const ran = await runProcess(binaries!.ffprobe, [
      ...['-v', 'error', '-select_streams', 'v:0', '-count_packets'],
      ...['-show_entries', 'stream', '-of', 'json', path],
    ]);
    if (!ran.ok) throw new Error(ran.error.code);
    return (JSON.parse(ran.value.stdout.toString()) as { streams: Record<string, unknown>[] }).streams[0]!;
  }

  /** The AV1 OBUs alone (no MP4 `colr` box): what the sequence header says. */
  async function sequenceHeader(path: string): Promise<Record<string, unknown>> {
    const obu = `${path}.obu`;
    const ran = await runFfmpeg(ctx, ['-y', '-i', path, '-map', '0:v:0', '-c', 'copy', '-f', 'obu', obu]);
    if (!ran.ok) throw new Error(ran.error.code);
    return stream(obu);
  }

  it('names a working hardware encoder for each codec this GPU has', () => {
    expect(encoders.h264).toBe('h264_nvenc');
    expect(encoders.hevc).toBe('hevc_nvenc');
    // av1_nvenc is compiled into the build everywhere; its trial passes on Ada (RTX 40) and newer only.
    expect([undefined, 'av1_nvenc']).toContain(encoders.av1);
  });

  it('AV1 Main 8-bit on av1_nvenc: av01, BT.709 limited in the container and the sequence header', async (test) => {
    if (!encoders.av1) return test.skip();
    const out = await encode('av1_nvenc', 'nvenc.mp4');
    expect(await stream(out)).toMatchObject({
      codec_name: 'av1',
      profile: 'Main',
      codec_tag_string: 'av01',
      pix_fmt: 'yuv420p',
      width: 1080,
      height: 1920,
      nb_read_packets: '60',
      ...SDR,
    });
    expect(await sequenceHeader(out)).toMatchObject({ codec_name: 'av1', ...SDR });
  });

  it('AV1 10-bit HLG on av1_nvenc: BT.2020 and HLG in the sequence header', async (test) => {
    if (!encoders.av1) return test.skip();
    const out = await encode('av1_nvenc', 'nvenc-hlg.mp4', 'hlg');
    expect(await stream(out)).toMatchObject({
      codec_name: 'av1',
      profile: 'Main',
      codec_tag_string: 'av01',
      pix_fmt: 'yuv420p10le',
      ...HLG,
    });
    expect(await sequenceHeader(out)).toMatchObject({ pix_fmt: 'yuv420p10le', ...HLG });
  });

  it('HEVC Main in hvc1 and Main 10 HLG on hevc_nvenc', async () => {
    expect(await stream(await encode('hevc_nvenc', 'hevc.mp4'))).toMatchObject({
      codec_name: 'hevc',
      profile: 'Main',
      codec_tag_string: 'hvc1',
      pix_fmt: 'yuv420p',
      ...SDR,
    });
    expect(await stream(await encode('hevc_nvenc', 'hevc-hlg.mp4', 'hlg'))).toMatchObject({
      codec_name: 'hevc',
      profile: 'Main 10',
      codec_tag_string: 'hvc1',
      pix_fmt: 'yuv420p10le',
      ...HLG,
    });
  });

  it('SVT-AV1, the fallback when a hardware AV1 encode fails, writes the same AV1 Main', async () => {
    const out = await encode('libsvtav1', 'svt.mp4');
    expect(await stream(out)).toMatchObject({
      codec_name: 'av1',
      profile: 'Main',
      codec_tag_string: 'av01',
      pix_fmt: 'yuv420p',
      ...SDR,
    });
    expect(await sequenceHeader(out)).toMatchObject(SDR);
    expect(await stream(await encode('libsvtav1', 'svt-hlg.mp4', 'hlg'))).toMatchObject({
      pix_fmt: 'yuv420p10le',
      ...HLG,
    });
  });
});
