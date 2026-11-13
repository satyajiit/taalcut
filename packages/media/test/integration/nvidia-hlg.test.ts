// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX on the Linux build with an NVIDIA GPU: a phone's 10-bit HLG clip turned by its display matrix, as an
 * iPhone writes it (HEVC Main 10, BT.2020 HLG, rotation −90), made here on hevc_nvenc. The library's pipeline runs
 * on it as the jobs process does: media.normalise, media.proxy, then the filmstrip (both reads: a short clip's exact
 * frames and a long clip's proxy keyframes), the thumbnail, frame sets, keyframes, a frame grab and a conform, every
 * one decoding on NVDEC with no fallback. The original downloads P010 into the tone-map; the proxy, 8-bit H.264,
 * downloads NV12 (before UX3-IDX its reads kept the original's P010 and exited 234). The coded picture's left half is
 * white: turned clockwise, the upright frame's top half is, so each filmstrip cell shows which way up it is. Skips
 * off Linux, without the verified Linux build, or when no NVIDIA GPU opens.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newId,
  ok,
  unwrap,
  type AssetIndexView,
  type ComputeFallbackEvent,
  type IndexStageDefinition,
  type IndexStageJob,
} from '@taalcut/core';
import {
  conform,
  createDerivedCache,
  createMediaIndexStages,
  createMediaService,
  decodeFrameSets,
  decodeKeyframes,
  extractFrame,
  hwVideoBackend,
  mediaMakeFilmstripJob,
  mediaMakeProxyJob,
  mediaMakeThumbnailJob,
  mediaNormaliseJob,
  runFfmpeg,
  runProcess,
  VideoBackendSelection,
  type MediaContext,
  type MediaService,
  type ProcessRunner,
} from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTestBinaries } from '../helpers/binaries';
import { planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('10-bit HLG on NVDEC');
const binaries = process.platform === 'linux' && found.binaries?.verified ? found.binaries : undefined;
const gpu =
  binaries !== undefined &&
  (await runFfmpeg({ binaries }, hwVideoBackend('cuda').deviceTrial ?? [], { timeoutMs: 60_000 })).ok;

/** Coded 640×360, left half white; an SDR picture converted to HLG BT.2020 (a real HDR signal), HEVC Main 10. */
const hlgArgs = (seconds: number) => [
  ...['-f', 'lavfi', '-i', `color=c=0x202020:size=640x360:rate=30:duration=${seconds}`],
  '-vf',
  [
    'drawbox=x=0:y=0:w=320:h=360:color=white:t=fill',
    'zscale=pin=bt709:tin=bt709:min=bt709:rin=tv:p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv:npl=203',
    'format=p010le',
  ].join(','),
  ...['-c:v', 'hevc_nvenc', '-profile:v', 'main10', '-tag:v', 'hvc1', '-g', '30', '-bf', '0', '-b:v', '2M'],
  ...['-bsf:v', 'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9'],
  ...['-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc'],
];

describe.skipIf(!binaries || !gpu)('10-bit HLG turned clips on NVDEC', { timeout: 240_000 }, () => {
  let dir: string;
  let media: MediaService;
  let cacheRoot: string;
  const runs: string[] = [];
  const events: ComputeFallbackEvent[] = [];
  const clips: Record<'short' | 'long', string> = { short: '', long: '' };

  const runner: ProcessRunner = async (command, args, options) => {
    if (command === binaries?.ffmpeg) runs.push(args.join(' '));
    return runProcess(command, args, options);
  };
  const ctx = (): MediaContext => ({
    binaries: binaries!,
    runner,
    videoBackends: new VideoBackendSelection(async () => ({ backends: ['cuda'] })),
    onComputeFallback: (event) => events.push(event),
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-nvidia-hlg-'));
    cacheRoot = join(dir, 'cache');
    for (const [name, seconds] of [
      ['short', 3],
      ['long', 34],
    ] as const) {
      const coded = join(dir, `${name}-coded.mov`);
      clips[name] = join(dir, `${name}.mov`);
      const made =
        (await renderClip({ binaries: binaries! }, coded, hlgArgs(seconds))) &&
        (await renderClip({ binaries: binaries! }, clips[name], [
          ...['-display_rotation', '-90', '-i', coded, '-c', 'copy'],
        ]));
      if (!made) throw new Error(`fixture ${name}`);
    }
    media = createMediaService({
      resolver: { resolve: async () => ok(binaries!) },
      runner,
      cache: createDerivedCache({ root: cacheRoot, capBytes: 2_000_000_000 }),
      videoBackends: async () => ({ backends: ['cuda'] }),
      onComputeFallback: (event) => events.push(event),
    });
  }, 240_000);
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  const stages = createMediaIndexStages();
  const stage = (name: string) => stages.find((s) => s.stage === name) as IndexStageDefinition;
  function jobOf(name: string, asset: AssetIndexView): IndexStageJob {
    const job = stage(name).job(asset);
    if ('skip' in job) throw new Error(`${name} skipped: ${job.skip}`);
    return job;
  }

  /** media.normalise, media.proxy, media.filmstrip and media.thumbnail, each job built by its stage. */
  async function index(path: string, contentHash: string) {
    const { size } = await stat(path);
    const outputs: Record<string, unknown> = {};
    const asset = (): AssetIndexView => ({
      assetId: newId<'Asset'>(),
      generation: 1,
      kind: 'video',
      path,
      contentHash,
      sizeBytes: size,
      sourceId: newId<'Source'>(),
      capturedAt: null,
      facts: null,
      derived: [],
      shots: [],
      transcript: null,
      outputs,
    });
    const keep = (name: string, value: unknown) => (outputs[name] = JSON.parse(JSON.stringify(value)));
    const normalised = unwrap(
      await media.normalise(mediaNormaliseJob.input.parse(jobOf('media.normalise', asset()).input)),
    );
    keep('media.normalise', normalised);
    keep(
      'media.proxy',
      unwrap(await media.makeProxy(mediaMakeProxyJob.input.parse(jobOf('media.proxy', asset()).input))),
    );
    const strip = await media.makeFilmstrip(
      mediaMakeFilmstripJob.input.parse(jobOf('media.filmstrip', asset()).input),
    );
    const thumb = await media.makeThumbnail(
      mediaMakeThumbnailJob.input.parse(jobOf('media.thumbnail', asset()).input),
    );
    return { normalised, strip, thumb };
  }

  /** Mean luma of the top and bottom thirds of each filmstrip cell. */
  async function cellHalves(key: string, columns: number, cells: number, w: number, h: number) {
    const gray = unwrap(
      await runProcess(binaries!.ffmpeg, [
        '-v',
        'error',
        '-i',
        join(cacheRoot, key),
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ]),
    ).stdout;
    const width = columns * w;
    const mean = (left: number, top: number, rows: number) => {
      let sum = 0;
      for (let y = top; y < top + rows; y++)
        for (let x = left; x < left + w; x++) sum += gray[y * width + x] ?? 0;
      return sum / (rows * w);
    };
    return Array.from({ length: cells }, (_, cell) => {
      const left = (cell % columns) * w;
      const top = Math.floor(cell / columns) * h;
      return {
        top: mean(left, top, Math.floor(h / 3)),
        bottom: mean(left, top + h - Math.floor(h / 3), Math.floor(h / 3)),
      };
    });
  }

  it('plans NVDEC with P010 frames, turned clockwise and tone-mapped', async () => {
    const plan = unwrap(await planClip(clips.short, ctx()));
    expect(plan.decode).toEqual({ backend: 'cuda', surfaceFormat: 'p010le' });
    expect([plan.rotation, plan.toneMap, plan.source.bitDepth]).toEqual([90, 'required', 10]);
  });

  it.each(['short', 'long'] as const)(
    'indexes the %s clip on NVDEC: an upright filmstrip from its proxy',
    async (name) => {
      runs.length = 0;
      events.length = 0;
      const made = await index(clips[name], (name === 'short' ? 'a7' : 'b8').repeat(32));
      expect(made.strip.ok ? 'ok' : `${made.strip.error.code}: ${made.strip.error.detail ?? ''}`).toBe('ok');
      expect(made.thumb.ok ? 'ok' : `${made.thumb.error.code}: ${made.thumb.error.detail ?? ''}`).toBe('ok');
      if (!made.strip.ok) return;
      const { filmstrip, source } = made.strip.value;
      expect(source).toBe(name === 'short' ? 'exact' : 'keyframes');
      expect([filmstrip.tileWidth, filmstrip.tileHeight]).toEqual([108, 192]);
      // Every cell is upright: the coded left half, turned clockwise, is the top.
      const halves = await cellHalves(
        filmstrip.file.key,
        filmstrip.columns,
        filmstrip.times.length,
        108,
        192,
      );
      for (const [cell, { top, bottom }] of halves.entries()) {
        expect(top, `cell ${cell}`).toBeGreaterThan(180);
        expect(bottom, `cell ${cell}`).toBeLessThan(80);
      }
      const reads = runs.filter((run) => run.includes('-hwaccel'));
      for (const run of reads) expect(run).toContain('-hwaccel cuda -hwaccel_output_format cuda');
      const proxyReads = reads.filter((run) => run.includes('/proxies/'));
      expect(proxyReads.length).toBeGreaterThan(0);
      for (const run of proxyReads) {
        expect(run).toContain('hwdownload,format=nv12');
        expect(run).not.toMatch(/p010|transpose_cuda|libplacebo/);
      }
      const originalReads = reads.filter((run) => run.includes(`file:${clips[name]}`));
      for (const run of originalReads)
        expect(run).toContain('transpose_cuda=dir=clock,hwdownload,format=p010le,libplacebo=');
      expect(events.filter((event) => event.operation === 'media.decode')).toEqual([]);
    },
  );

  it('reads frame sets, keyframes, a frame and a conform of the original on NVDEC', async () => {
    runs.length = 0;
    events.length = 0;
    const context = ctx();
    const plan = unwrap(await planClip(clips.short, context));
    const sets = await decodeFrameSets(clips.short, plan, context, {
      sets: [{ set: 'ocr', size: { longSide: 640 }, format: 'gray8', frames: [0, 30, 60] }],
      dir,
    });
    const keyframes = await decodeKeyframes(clips.short, plan, context, {
      targets: [0.2, 1.5],
      size: { longSide: 256 },
      dir,
    });
    const frame = await extractFrame(clips.short, { value: 1, rate: 1 }, context, {
      maxDimension: 320,
      format: 'png',
    });
    const conformed = await conform(clips.short, plan, context, {
      out: join(dir, 'conform.mp4'),
      codec: 'h264',
    });
    for (const result of [sets, keyframes, frame, conformed])
      expect(result.ok ? 'ok' : `${result.error.code}: ${result.error.detail ?? ''}`).toBe('ok');
    expect(frame.ok && frame.value).toMatchObject({ backend: 'cuda', width: 180, height: 320 });
    expect(conformed.ok && conformed.value).toMatchObject({ width: 360, height: 640 });
    const reads = runs.filter((run) => run.includes(`file:${clips.short}`));
    expect(reads.length).toBeGreaterThanOrEqual(4);
    for (const run of reads) {
      expect(run).toContain('-hwaccel cuda -hwaccel_output_format cuda');
      // The frame grab scales on the GPU before its download; the rest scale after the tone-map.
      expect(run).toMatch(
        /transpose_cuda=dir=clock,(scale_cuda=[^,]+,)?hwdownload,format=p010le,libplacebo=/,
      );
    }
    expect(events.filter((event) => event.operation === 'media.decode')).toEqual([]);
  });
});
