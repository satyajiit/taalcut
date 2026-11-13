// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HDR with the bundled FFmpeg build (tools/ffmpeg/dist, verified against its
 * BUILDINFO.json: on a Mac with MoltenVK, on Linux build-linux.sh's on the system
 * Vulkan loader): an HLG clip made by the build itself on the platform's HEVC
 * encoder, a real SDR picture converted to HLG, probed, then extracted the way
 * vision gets frames. Skips unless that build is present.
 *
 * "Not washed out" is measured against what extraction did before tone
 * mapping: the plain RGB conversion. On this clip that frame's mean
 * saturation (signalstats SATAVG) was 41; libplacebo bt.2446a gave 56 and
 * zscale + hable 74 (2026-10-12, M5 Max). The bar is 1.2× the plain frame.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDirectJobRunner,
  createMediaJobs,
  createMediaService,
  extractFrameJobOutputSchema,
  hardwareBackends,
  hardwareEncoderFor,
  mediaExtractFrameJob,
  probeMedia,
  runFfmpeg,
  selectToneMap,
  type BackendFallback,
  type ExtractedFrame,
  type MediaContext,
  type MediaService,
  type ResolvedFfmpeg,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';

const found = await findTestBinaries('media HDR integration');
/** The row this platform decodes and encodes on: videotoolbox on a Mac, cuda on Linux. */
const ROW = hardwareBackends(process.platform)[0];
const bundled: ResolvedFfmpeg | undefined =
  ROW && found.binaries?.verified && (process.platform !== 'darwin' || found.binaries.vulkanIcd)
    ? found.binaries
    : undefined;
const why = bundled ? '' : ' (needs the bundled build in tools/ffmpeg/dist)';
const H264 = ROW && hardwareEncoderFor(ROW, 'h264');
const HEVC = ROW && hardwareEncoderFor(ROW, 'hevc');

/** testsrc2 converted from SDR bt709 to HLG bt2020 (a real HDR signal, not a retag), HEVC Main 10. */
const HLG_ARGS = [
  ...['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1'],
  '-vf',
  'zscale=pin=bt709:tin=bt709:min=bt709:rin=full:p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv:npl=203,format=p010le',
  ...['-c:v', HEVC ?? 'hevc', '-profile:v', 'main10', '-tag:v', 'hvc1'],
  ...['-bsf:v', 'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9'],
  ...['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'],
];
const HALF_SECOND = { value: 15, rate: 30 };

describe.skipIf(!bundled)(`HDR on the bundled FFmpeg${why}`, { timeout: 120_000 }, () => {
  let dir: string;
  let hlg: string;
  let portrait: string;
  let ctx: MediaContext;
  let media: MediaService;
  let fallbacks: BackendFallback[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-hdr-'));
    ctx = { binaries: bundled! };
    hlg = join(dir, 'hlg.mov');
    portrait = join(dir, 'hlg-portrait.mov');
    for (const args of [
      [...HLG_ARGS, hlg],
      ['-display_rotation', '-90', '-i', hlg, '-c', 'copy', portrait],
    ]) {
      const made = await runFfmpeg(ctx, ['-y', ...args], { timeoutMs: 90_000 });
      if (!made.ok) throw new Error(`fixture: ${made.error.detail ?? made.error.code}`);
    }
    fallbacks = [];
    media = createMediaService({
      resolver: { resolve: async () => ({ ok: true, value: bundled! }) },
      onBackendFallback: (f) => fallbacks.push(f),
    });
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** signalstats of an image: mean luma and mean saturation, 8-bit scale. */
  async function stats(image: Buffer | string, name: string): Promise<{ yavg: number; satavg: number }> {
    const path = typeof image === 'string' ? image : join(dir, `${name}.png`);
    if (typeof image !== 'string') await writeFile(path, image);
    const graph = 'format=yuv444p,signalstats,metadata=print:file=-';
    const out = await runFfmpeg(ctx, ['-i', path, '-vf', graph, '-f', 'null', '-'], { timeoutMs: 60_000 });
    if (!out.ok) throw new Error(out.error.detail);
    const text = out.value.stdout.toString('utf8');
    const read = (key: string) => Number(new RegExp(`signalstats\\.${key}=([0-9.]+)`).exec(text)?.[1]);
    return { yavg: read('YAVG'), satavg: read('SATAVG') };
  }

  /** What extraction gave before tone-mapping: the frame converted to RGB as is. */
  async function plainFrame(): Promise<{ yavg: number; satavg: number }> {
    const path = join(dir, 'plain.png');
    const args = ['-y', '-ss', '0.5', '-i', hlg, '-frames:v', '1', '-vf', 'format=rgb24', path];
    const out = await runFfmpeg(ctx, args, { timeoutMs: 60_000 });
    if (!out.ok) throw new Error(out.error.detail);
    return stats(path, 'plain');
  }

  const expectNotWashedOut = async (frame: ExtractedFrame, name: string, plain: { satavg: number }) => {
    const mapped = await stats(frame.data, name);
    expect(mapped.satavg).toBeGreaterThan(plain.satavg * 1.2);
    expect(mapped.yavg).toBeGreaterThan(60);
    expect(mapped.yavg).toBeLessThan(200);
  };

  it('probes the clip the build made as 10-bit HLG HEVC', async () => {
    const probe = await probeMedia(hlg, ctx);
    expect(probe.ok && probe.value.video).toMatchObject({
      codec: 'hevc',
      bitDepth: 10,
      isHdr: true,
      hdrFormats: ['hlg'],
      colour: { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc' },
    });
  });

  it('selects the hardware encoders and the libplacebo tone-map on Vulkan', async () => {
    expect(await media.selectEncoder('h264')).toMatchObject({ value: { encoder: H264 } });
    expect(await media.selectEncoder('hevc')).toMatchObject({ value: { encoder: HEVC } });
    expect(await media.selectToneMap()).toEqual({
      ok: true,
      value: { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' },
    });
    expect(fallbacks).toEqual([]);
  });

  it('falls back to the CPU tone-map, with the reason, when Vulkan cannot start', async () => {
    const seen: BackendFallback[] = [];
    const noDriver = { binaries: { ...bundled!, vulkanIcd: join(dir, 'missing_icd.json') } };
    const choice = await selectToneMap({ ...noDriver, onBackendFallback: (f) => seen.push(f) });
    expect(choice).toMatchObject({
      value: {
        method: 'zscale',
        backend: 'software',
        curve: 'hable',
        fallbackReason: { code: 'vulkan_unavailable' },
      },
    });
    expect(choice.ok && choice.value.fallbackReason?.detail).toContain('VK_ERROR_INCOMPATIBLE_DRIVER');
    expect(seen).toMatchObject([{ operation: 'tonemap', reason: { code: 'vulkan_unavailable' } }]);
  });

  it('extracts HDR frames on the hardware decoder, tone-mapped on Vulkan, not washed out', async () => {
    const plain = await plainFrame();
    const frame = await media.extractFrame(hlg, HALF_SECOND, { format: 'png' });
    if (!frame.ok) throw new Error(frame.error.detail);
    expect(frame.value).toMatchObject({
      backend: ROW,
      width: 640,
      height: 360,
      toneMap: { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' },
    });
    expect(frame.value.fallbackReason).toBeUndefined();
    await expectNotWashedOut(frame.value, 'gpu', plain);

    const cpu = await media.extractFrame(hlg, HALF_SECOND, { format: 'png', toneMap: 'software' });
    if (!cpu.ok) throw new Error(cpu.error.detail);
    expect(cpu.value.toneMap).toMatchObject({ method: 'zscale', fallbackReason: { code: 'requested' } });
    await expectNotWashedOut(cpu.value, 'cpu', plain);
  });

  it('rotates a portrait HDR clip on the GPU and tone-maps it, also through the media.extractFrame job', async () => {
    const jobs = createDirectJobRunner(createMediaJobs(media));
    const result = await jobs.run(mediaExtractFrameJob, {
      path: portrait,
      at: HALF_SECOND,
      maxDimension: 320,
    });
    if (!result.ok) throw new Error(result.error.detail);
    expect(extractFrameJobOutputSchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({
      backend: ROW,
      width: 180,
      height: 320,
      mimeType: 'image/jpeg',
      toneMap: { method: 'libplacebo', backend: 'vulkan' },
    });
  });
});
