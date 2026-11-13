// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HDR tone-map selection and the frame graph, with a fake runner: libplacebo
 * on Vulkan when its trial frame passes, CPU zscale + hable with the reason
 * when it can't, the bundled MoltenVK in the environment, and HDR frames
 * mapped to SDR on either decode route.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { err, ok } from '@taalcut/core';
import {
  extractFrame,
  LIBPLACEBO_TONEMAP,
  MediaCancelled,
  parseFilters,
  selectToneMap,
  toneMapFilters,
  ToneMapSelection,
  type BackendFallback,
  type MediaContext,
  type ProcessOutput,
  type ProcessRunner,
  type RunOptions,
} from '@taalcut/media';
import { pngHeader, probeOf, videoStream } from './helpers/probe-fixture';

const FILTERS = (names: readonly string[]) =>
  [
    'Filters:',
    '  T.. = Timeline support',
    '  | = Source or sink filter',
    '  ------',
    ...names.map((name) => ` .. ${name.padEnd(16)} V->V       A filter.`),
  ].join('\n');
const ALL = ['libplacebo', 'scale_vt', 'tonemap', 'transpose_vt', 'zscale'];
const VK_FAILED =
  '[libplacebo @ 0x1] Failed creating instance: VK_ERROR_INCOMPATIBLE_DRIVER\n' +
  '[libplacebo @ 0x1] Failed initializing vulkan instance\n[Parsed_libplacebo_2 @ 0x2] Failed creating Vulkan device!';

const output = (overrides: Partial<ProcessOutput> = {}): ProcessOutput => ({
  exitCode: 0,
  signal: null,
  stdout: Buffer.alloc(0),
  stderrTail: '',
  durationMs: 5,
  ...overrides,
});

interface Call {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
}

/** Answers `-filters`, the libplacebo trial and frame runs; records each call with its environment. */
function fakeFfmpeg(options: { filters?: readonly string[]; trial?: () => ReturnType<ProcessRunner> } = {}) {
  const calls: Call[] = [];
  const runner: ProcessRunner = async (_command, args, run?: RunOptions) => {
    calls.push({ args: [...args], env: run?.env });
    if (args.includes('-filters'))
      return ok(output({ stdout: Buffer.from(FILTERS(options.filters ?? ALL)) }));
    if (args.includes('lavfi')) return options.trial ? options.trial() : ok(output());
    return ok(output({ stdout: pngHeader(320, 240) }));
  };
  return { runner, calls };
}

const BINARIES = {
  ffmpeg: '/fake/ffmpeg',
  ffprobe: '/fake/ffprobe',
  source: 'dev-build',
  vulkanIcd: '/fake/lib/MoltenVK_icd.json',
} as const;

function context(runner: ProcessRunner, extra: Partial<MediaContext> = {}) {
  const fallbacks: BackendFallback[] = [];
  const ctx: MediaContext = {
    binaries: BINARIES,
    runner,
    platform: 'darwin',
    onBackendFallback: (f) => fallbacks.push(f),
    ...extra,
  };
  return { ctx, fallbacks };
}

const hlg = videoStream({
  codec: 'hevc',
  profile: 'Main 10',
  pixelFormat: 'yuv420p10le',
  bitDepth: 10,
  colour: { range: 'tv', space: 'bt2020nc', transfer: 'arib-std-b67', primaries: 'bt2020' },
  isHdr: true,
  hdrFormats: ['hlg'],
});

describe('parseFilters', () => {
  it('reads filter names below the legend', () => {
    expect([...parseFilters(FILTERS(['libplacebo', 'zscale']))]).toEqual(['libplacebo', 'zscale']);
    expect(parseFilters('no legend at all').size).toBe(0);
  });
});

describe('toneMapFilters', () => {
  const zscale = { method: 'zscale', backend: 'software', curve: 'hable' } as const;

  it('is one libplacebo filter on the GPU', () => {
    expect(toneMapFilters({ method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' }, hlg)).toEqual([
      LIBPLACEBO_TONEMAP,
    ]);
    expect(LIBPLACEBO_TONEMAP).toContain('tonemapping=bt.2446a');
    expect(LIBPLACEBO_TONEMAP).toContain('apply_dolbyvision=1');
  });

  it('on the CPU, linearises from the probed transfer, maps with hable and lands on bt709', () => {
    expect(toneMapFilters(zscale, hlg)).toEqual([
      'zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:t=linear:npl=100',
      'format=gbrpf32le',
      'tonemap=tonemap=hable:desat=0',
      'zscale=p=bt709:t=bt709:m=bt709:r=tv',
      'format=yuv420p',
    ]);
    const pq = videoStream({ colour: { transfer: 'smpte2084', primaries: 'bt2020', space: 'bt2020nc' } });
    expect(toneMapFilters(zscale, pq)[0]).toMatch(/^zscale=tin=smpte2084:/);
  });

  it('uses the Dolby Vision base layer when the transfer is missing, and only known colour names', () => {
    const dv84 = videoStream({ colour: {}, dolbyVision: { profile: 8, compatibilityId: 4 } });
    expect(toneMapFilters(zscale, dv84)[0]).toBe(
      'zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:t=linear:npl=100',
    );
    const hostile = videoStream({
      colour: { transfer: 'x,movie=/etc/passwd', primaries: 'bt2020:a=b', space: '' },
    });
    expect(toneMapFilters(zscale, hostile)[0]).toBe(
      'zscale=tin=smpte2084:pin=bt2020:min=bt2020nc:t=linear:npl=100',
    );
    expect(toneMapFilters({ method: 'none', backend: 'software' }, hlg)).toEqual([]);
  });
});

describe('selectToneMap', () => {
  it('picks libplacebo when its trial frame runs, with the bundled MoltenVK as the only Vulkan driver', async () => {
    const { runner, calls } = fakeFfmpeg();
    const { ctx, fallbacks } = context(runner);
    expect(await selectToneMap(ctx)).toEqual(
      ok({ method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' }),
    );
    const trial = calls.find((c) => c.args.includes('lavfi'))!;
    expect(trial.args.join(' ')).toContain(LIBPLACEBO_TONEMAP);
    expect(trial.env).toMatchObject({
      VK_ICD_FILENAMES: BINARIES.vulkanIcd,
      VK_DRIVER_FILES: BINARIES.vulkanIcd,
      MVK_CONFIG_LOG_LEVEL: '1',
    });
    expect(fallbacks).toEqual([]);
  });

  it('falls back to zscale when Vulkan cannot start, reporting the reason key', async () => {
    const { runner } = fakeFfmpeg({
      trial: async () => ok(output({ exitCode: 187, stderrTail: VK_FAILED })),
    });
    const { ctx, fallbacks } = context(runner);
    const choice = await selectToneMap(ctx);
    expect(choice).toMatchObject({
      ok: true,
      value: {
        method: 'zscale',
        backend: 'software',
        curve: 'hable',
        fallbackReason: { code: 'vulkan_unavailable' },
      },
    });
    expect(choice.ok && choice.value.fallbackReason?.detail).toContain('VK_ERROR_INCOMPATIBLE_DRIVER');
    expect(fallbacks).toEqual([
      { operation: 'tonemap', subject: 'hdr', reason: choice.ok ? choice.value.fallbackReason : undefined },
    ]);
  });

  it.each([
    ['no bundled MoltenVK', { binaries: { ...BINARIES, vulkanIcd: undefined } }, ALL, 'vulkan_unavailable'],
    ['a build without libplacebo', {}, ['zscale', 'tonemap'], 'filter_missing'],
  ] as const)('falls back without a trial for %s', async (_, extra, filters, code) => {
    const { runner, calls } = fakeFfmpeg({ filters });
    const { ctx } = context(runner, extra as Partial<MediaContext>);
    expect(await selectToneMap(ctx)).toMatchObject({ value: { method: 'zscale', fallbackReason: { code } } });
    expect(calls.some((c) => c.args.includes('lavfi'))).toBe(false);
  });

  it('tries libplacebo on Linux without a bundled driver: the system Vulkan loader, no VK_ICD_FILENAMES', async () => {
    const { runner, calls } = fakeFfmpeg();
    const { ctx } = context(runner, { platform: 'linux', binaries: { ...BINARIES, vulkanIcd: undefined } });
    expect(await selectToneMap(ctx)).toEqual(ok({ method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' }));
    const trial = calls.find((c) => c.args.includes('lavfi'));
    expect(trial?.env?.['VK_ICD_FILENAMES']).toBeUndefined();
    expect(trial?.env?.['VK_DRIVER_FILES']).toBeUndefined();
  });

  it('runs on the CPU when asked, and maps nothing when the build has neither route', async () => {
    const { runner } = fakeFfmpeg();
    expect(await selectToneMap(context(runner).ctx, { software: true })).toMatchObject({
      value: { method: 'zscale', fallbackReason: { code: 'requested' } },
    });
    const bare = fakeFfmpeg({ filters: ['scale_vt'] });
    expect(await selectToneMap(context(bare.runner).ctx)).toMatchObject({
      value: { method: 'none', backend: 'software', fallbackReason: { code: 'filter_missing' } },
    });
  });

  it('is proven once per selection; a cancelled trial is not remembered', async () => {
    let trials = 0;
    let cancel = true;
    const { runner } = fakeFfmpeg({
      trial: async () => {
        trials++;
        return cancel ? err(MediaCancelled()) : ok(output());
      },
    });
    const { ctx } = context(runner);
    const selection = new ToneMapSelection();
    expect(await selection.get(ctx)).toMatchObject({ ok: false, error: { code: 'media.cancelled' } });
    cancel = false;
    expect(await selection.get(ctx)).toMatchObject({ value: { method: 'libplacebo' } });
    expect(await selection.get(ctx)).toMatchObject({ value: { method: 'libplacebo' } });
    expect(trials).toBe(2);
  });
});

describe('extractFrame of an HDR source', () => {
  let dir: string;
  let clip: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-tonemap-'));
    clip = join(dir, 'hlg.mov');
    await writeFile(clip, 'not decoded: the runner is fake');
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const at = { value: 1, rate: 2 };
  const frameCall = (calls: readonly Call[]) => calls.find((c) => c.args.includes('image2pipe'))!;
  const filtersOf = (call: Call) => call.args[call.args.indexOf('-vf') + 1]?.split(',');

  it('decodes on VideoToolbox, then maps to SDR with libplacebo on Vulkan', async () => {
    const { runner, calls } = fakeFfmpeg();
    const { ctx } = context(runner);
    const frame = await extractFrame(clip, at, ctx, { probe: probeOf(clip, hlg), format: 'png' });
    expect(frame.ok && frame.value).toMatchObject({
      backend: 'videotoolbox',
      toneMap: { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' },
    });
    const call = frameCall(calls);
    expect(call.args).toContain('videotoolbox_vld');
    expect(filtersOf(call)?.slice(-4)).toEqual([
      'hwdownload',
      'format=p010le',
      ...LIBPLACEBO_TONEMAP.split(','),
      'format=rgb24',
    ]);
    expect(call.env).toMatchObject({ VK_ICD_FILENAMES: BINARIES.vulkanIcd });
  });

  it('uses the CPU tone-map after a software decode when told to, and says why', async () => {
    const { runner, calls } = fakeFfmpeg();
    const { ctx } = context(runner);
    const frame = await extractFrame(clip, at, ctx, {
      probe: probeOf(clip, hlg),
      decode: 'software',
      toneMap: 'software',
      maxDimension: 160,
    });
    expect(frame.ok && frame.value.toneMap).toMatchObject({
      method: 'zscale',
      fallbackReason: { code: 'requested' },
    });
    // Scale first (fewer pixels to map), then the CPU tone-map. The scale has commas inside quotes.
    const graph = frameCall(calls).args.at(frameCall(calls).args.indexOf('-vf') + 1) ?? '';
    const cpu = toneMapFilters({ method: 'zscale', backend: 'software', curve: 'hable' }, hlg).join(',');
    expect(graph).toMatch(/^scale='min\(160,iw\)'/);
    expect(graph.endsWith(`,${cpu}`)).toBe(true);
  });

  it('leaves SDR frames alone and never looks for a tone-map', async () => {
    const { runner, calls } = fakeFfmpeg();
    const frame = await extractFrame(clip, at, context(runner).ctx, { probe: probeOf(clip, videoStream()) });
    expect(frame.ok && frame.value.toneMap).toBeUndefined();
    expect(calls.map((c) => c.args.includes('-filters'))).toEqual([false]);
  });
});
