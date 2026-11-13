// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX: 10-bit and turned sources on the CUDA row, with no FFmpeg. An iPhone's 4K HEVC Main 10 HLG clip, turned
 * by its display matrix, downloads as P010 from the original (`hwdownload,format=p010le`, the decoder's own format,
 * which CUDA can't convert on the way down). Its proxy is 8-bit H.264 that media wrote: every read of it downloads
 * NV12. Keeping the original's P010 there made the filmstrip exit 234 ("Invalid output format p010le for hwframe
 * download"), on CUDA only: VideoToolbox converts on the way down.
 */
import { RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  decodeRouteFor,
  filmstripLayout,
  keyframeArgs,
  planNormalisation,
  proxyRate,
  settledPlan,
  spriteRead,
  type NormalisationPlan,
  type ToneMapChoice,
} from '@taalcut/media';
import { normalisationGraph } from '../../src/normalise/graph';
import { probeOf, videoStream } from '../helpers/probe-fixture';

const none: ToneMapChoice = { method: 'none', backend: 'software' };
const placebo: ToneMapChoice = {
  method: 'libplacebo',
  backend: 'vulkan',
  curve: 'bt.2446a',
} as ToneMapChoice;

const HLG = {
  codec: 'hevc',
  isHdr: true,
  hdrFormats: ['hlg'],
  bitDepth: 10,
  pixelFormat: 'yuv420p10le',
  colour: { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc', range: 'tv' },
};

/** The owner's clip: 3840×2160 HEVC Main 10 at 60 fps, turned a quarter (shown 2160×3840), `seconds` long. */
function phonePlan(
  seconds: number,
  overrides: Record<string, unknown> = HLG,
  platform: NodeJS.Platform = 'linux',
): NormalisationPlan {
  const frames = seconds * 60;
  const result = planNormalisation(
    probeOf(
      '/clips/98475.mp4',
      videoStream({
        width: 3840,
        height: 2160,
        displayWidth: 2160,
        displayHeight: 3840,
        rotation: 90,
        frameRate: { num: 60, den: 1 },
        averageFrameRate: { num: 60, den: 1 },
        frameCount: frames,
        duration: { value: seconds, rate: 1 },
        ...overrides,
      } as never),
    ),
    { platform },
  );
  if (!result.ok) throw new Error(result.error.code);
  return { ...result.value, frames, duration: RationalTime.of(frames, result.value.frameRate.output) };
}

const vfOf = (args: readonly string[]) => args[args.indexOf('-vf') + 1] ?? '';

describe('a 10-bit HLG turned original on CUDA', () => {
  it('plans NVDEC with P010 frames, turned and tone-mapped', () => {
    const plan = phonePlan(10);
    expect(plan.decode).toEqual({ backend: 'cuda', surfaceFormat: 'p010le' });
    expect([plan.rotation, plan.toneMap]).toEqual([90, 'required']);
  });

  it('turns on the GPU, then downloads P010 into the tone-map and scales on the CPU', () => {
    const plan = phonePlan(10);
    const graph = normalisationGraph(plan, {
      route: plan.decode,
      toneMap: placebo,
      size: { longSide: 1280 },
    });
    expect(graph.videoFilter).toMatch(
      /^sidedata=mode=delete:type=DISPLAYMATRIX,transpose_cuda=dir=clock,hwdownload,format=p010le,libplacebo=.*,scale=720:1280:/,
    );
    expect(graph.videoFilter).not.toContain('scale_cuda');
  });

  it('a 10-bit SDR original scales on the GPU too and downloads P010', () => {
    const sdr = {
      ...HLG,
      isHdr: false,
      hdrFormats: [],
      colour: { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' },
    };
    const plan = phonePlan(10, sdr);
    expect(plan.toneMap).not.toBe('required');
    const graph = normalisationGraph(plan, { route: plan.decode, toneMap: none, size: { longSide: 1280 } });
    expect(graph.videoFilter).toContain(
      'transpose_cuda=dir=clock,scale_cuda=w=720:h=1280:interp_algo=bicubic,hwdownload,format=p010le',
    );
    // Into NVENC: not zero copy (P010 isn't what an SDR output is tagged), the CPU converts.
    const encoded = normalisationGraph(plan, { route: plan.decode, toneMap: none, encoder: 'h264_nvenc' });
    expect(encoded.videoFilter).toContain('hwdownload,format=p010le');
    expect(encoded.deviceFrames).toBeUndefined();
  });
});

describe('its proxy (settledPlan) on CUDA', () => {
  it('decodes the 8-bit proxy as NV12 on every hardware row; the software route is left alone', () => {
    expect(settledPlan(phonePlan(10)).decode).toEqual({ backend: 'cuda', surfaceFormat: 'nv12' });
    expect(settledPlan(phonePlan(10, HLG, 'darwin')).decode).toEqual({
      backend: 'videotoolbox',
      surfaceFormat: 'nv12',
    });
    const software = {
      ...phonePlan(10),
      decode: { backend: 'software', fallbackReason: { code: 'x' } },
    } as never;
    expect(settledPlan(software).decode).toEqual({ backend: 'software', fallbackReason: { code: 'x' } });
  });

  it('the filmstrip of a short clip reads the proxy’s exact frames, scaled on the GPU and downloaded as NV12', () => {
    const plan = settledPlan(phonePlan(2.5), proxyRate(phonePlan(2.5)));
    const layout = filmstripLayout(plan);
    const read = spriteRead('/cache/proxy.mp4', plan, none, layout, { proxy: true });
    expect(read.source).toBe('exact');
    expect(vfOf(read.args)).toMatch(
      /^sidedata=mode=delete:type=DISPLAYMATRIX,scale_cuda=w=108:h=192:interp_algo=bicubic,hwdownload,format=nv12,/,
    );
    expect(vfOf(read.args)).not.toMatch(/p010|transpose|libplacebo/);
  });

  it('the filmstrip of a long clip reads the proxy’s keyframes, downloaded as NV12', () => {
    const original = phonePlan(60);
    const plan = settledPlan(original, proxyRate(original));
    const layout = filmstripLayout(plan);
    const read = spriteRead('/cache/proxy.mp4', plan, none, layout, { proxy: true });
    expect(read.source).toBe('keyframes');
    expect(read.args).toContain('-skip_frame');
    expect(vfOf(read.args)).toContain('scale_cuda=w=108:h=192:interp_algo=bicubic,hwdownload,format=nv12');
    expect(vfOf(read.args)).not.toContain('p010');
  });

  it('keyframes of the original download P010 before the tone-map; of the proxy, NV12', () => {
    const original = phonePlan(10);
    const fromOriginal = keyframeArgs('/clips/98475.mp4', original, {
      route: decodeRouteFor(original),
      toneMap: placebo,
      size: { longSide: 256 },
    });
    expect(vfOf(fromOriginal)).toContain('transpose_cuda=dir=clock,hwdownload,format=p010le,libplacebo');
    const proxy = settledPlan(original, proxyRate(original));
    const fromProxy = keyframeArgs('/cache/proxy.mp4', proxy, {
      route: decodeRouteFor(proxy),
      toneMap: none,
      size: { longSide: 256 },
    });
    expect(vfOf(fromProxy)).toContain('hwdownload,format=nv12');
    expect(vfOf(fromProxy)).not.toMatch(/p010|transpose/);
  });
});
