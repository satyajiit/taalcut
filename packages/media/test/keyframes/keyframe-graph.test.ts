// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T2/T4: the arguments of one keyframe-only read on every decode route.
 * VideoToolbox and the software route also run against real files
 * (test/integration/keyframe-thumbnail.test.ts); NVDEC and D3D11VA are
 * Windows routes no machine of this round runs, so their commands are
 * pinned here: `-skip_frame nokey` on an `-hwaccel` (never a `*_cuvid`
 * decoder, which ignores it), the pick before any picture work, the turn and
 * the scale on the device with LGPL filters only (`transpose_cuda`,
 * `scale_cuda`; never `_npp`), and HDR tone-mapped after a download.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeRouteFor,
  firstAtOrAfter,
  keyframeArgs,
  keyframeWindows,
  type DecodeProfile,
  type NormalisationPlan,
  type ToneMapChoice,
} from '@taalcut/media';
import { hdPlan, HLG_STREAM } from '../helpers/video-plan';

const none: ToneMapChoice = { method: 'none', backend: 'software' };
const placebo: ToneMapChoice = { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' };
const HLG = HLG_STREAM;
const portrait = { rotation: 90 as const, displayWidth: 1080, displayHeight: 1920 };
const nvdec: DecodeProfile = { decoder: 'nvdec' };
const d3d11va: DecodeProfile = { decoder: 'd3d11va' };

const plan = hdPlan;

const [WINDOW] = keyframeWindows([0.5, 1.5], { duration: 2 });

/** The input options before `-i` and the `-vf` chain of a 400 px poster read. */
function argsOf(source: NormalisationPlan, profile?: DecodeProfile, toneMap = none) {
  if (!WINDOW) throw new Error('no window');
  const args = keyframeArgs('/clips/clip.mov', source, {
    route: decodeRouteFor(source, profile),
    toneMap,
    size: { longSide: 400 },
    window: WINDOW,
    pick: [firstAtOrAfter(WINDOW.targets)],
  });
  const at = args.indexOf('-i');
  return { input: args.slice(0, at), rest: args.slice(at), vf: args[args.indexOf('-vf') + 1] ?? '' };
}

const PICK = /^select='[^']+',/;

describe('keyframeArgs', () => {
  it('VideoToolbox: skip_frame before the seek, the pick on the GPU, turn and scale_vt, one download', () => {
    const { input, rest, vf } = argsOf(plan(portrait));
    expect(input.slice(0, 7)).toEqual([
      ...['-noautorotate', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'],
      ...['-skip_frame', 'nokey'],
    ]);
    expect(input.slice(7, 11)).toEqual(['-ss', '0.499000', '-t', '1.501000']);
    expect(input).toContain('-format_whitelist');
    expect(rest.slice(0, 6)).toEqual(['-i', 'file:/clips/clip.mov', '-map', '0:V:0', '-an', '-vf']);
    expect(vf).toMatch(PICK);
    expect(vf.replace(PICK, '')).toBe(
      'sidedata=mode=delete:type=DISPLAYMATRIX,transpose_vt=dir=clock,scale_vt=w=224:h=400,hwdownload,format=nv12',
    );
    // No frame-rate conform: keyframes keep their own timestamps.
    expect(vf).not.toContain('fps=');
  });

  it('VideoToolbox HDR: the picked keyframes download as p010le, tone-map, then scale on the CPU', () => {
    const { vf } = argsOf(plan(HLG), undefined, placebo);
    const body = vf.replace(PICK, '');
    expect(body.startsWith('sidedata=mode=delete:type=DISPLAYMATRIX,hwdownload,format=p010le,')).toBe(true);
    expect(body.indexOf('libplacebo')).toBeLessThan(body.indexOf('scale=400:224:flags=bicubic'));
    expect(body).not.toContain('scale_vt');
  });

  it('software: no hwaccel, FFmpeg turns the picture, the scale is exact', () => {
    const { input, vf } = argsOf(plan({ ...portrait, codec: 'theora' }));
    expect(input).not.toContain('-hwaccel');
    expect(input.slice(0, 2)).toEqual(['-skip_frame', 'nokey']);
    expect(vf.replace(PICK, '')).toBe('scale=224:400:flags=bicubic');
  });

  it('NVDEC (Windows profile): -hwaccel cuda with skip_frame, transpose_cuda and scale_cuda, no _npp or cuvid', () => {
    const { input, vf } = argsOf(plan({ ...portrait, mirrored: true }, 'win32'), nvdec);
    expect(input.slice(0, 7)).toEqual([
      ...['-noautorotate', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      ...['-skip_frame', 'nokey'],
    ]);
    expect(input.join(' ')).not.toMatch(/cuvid|-c:v/);
    expect(vf.replace(PICK, '')).toBe(
      'sidedata=mode=delete:type=DISPLAYMATRIX,transpose_cuda=dir=clock,scale_cuda=w=224:h=400:interp_algo=bicubic,hwdownload,format=nv12,hflip',
    );
    expect(vf).not.toMatch(/_npp/);
  });

  it('NVDEC HDR and 10-bit: p010le downloads; HDR tone-maps before a CPU scale', () => {
    const tenBit = argsOf(plan({ bitDepth: 10, pixelFormat: 'yuv420p10le' }, 'win32'), nvdec).vf;
    expect(tenBit).toContain('scale_cuda=w=400:h=224:interp_algo=bicubic,hwdownload,format=p010le');
    const hdr = argsOf(plan(HLG, 'win32'), nvdec, placebo).vf.replace(PICK, '');
    expect(hdr).toContain('hwdownload,format=p010le,');
    expect(hdr.indexOf('libplacebo')).toBeLessThan(hdr.indexOf('scale=400:224:flags=bicubic'));
    expect(hdr).not.toContain('scale_cuda');
  });

  it('D3D11VA (Windows profile): skip_frame on the hwaccel, one download, scale and turn on the CPU', () => {
    const { input, vf } = argsOf(plan({ ...portrait, mirrored: true }, 'win32'), d3d11va);
    expect(input.slice(0, 7)).toEqual([
      ...['-noautorotate', '-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11'],
      ...['-skip_frame', 'nokey'],
    ]);
    expect(vf.replace(PICK, '')).toBe(
      'sidedata=mode=delete:type=DISPLAYMATRIX,hwdownload,format=nv12,scale=400:224:flags=bicubic,transpose=1,hflip',
    );
  });

  it('reads the whole file without a window, and runs finishing filters on the small frames', () => {
    const source = plan();
    const args = keyframeArgs('/clips/clip.mov', source, {
      route: decodeRouteFor(source),
      toneMap: none,
      size: { width: 160, height: 90 },
      finish: ['fps=fps=1/2:round=up', 'tile=3x3'],
    });
    expect(args).not.toContain('-ss');
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'sidedata=mode=delete:type=DISPLAYMATRIX,scale_vt=w=160:h=90,hwdownload,format=nv12,fps=fps=1/2:round=up,tile=3x3',
    );
  });

  it('every route this package has honours skip_frame', () => {
    const windows = plan({}, 'win32');
    for (const profile of [nvdec, d3d11va, { decoder: 'none' as const }]) {
      expect(decodeRouteFor(windows, profile).honoursSkipFrame).toBe(true);
    }
    expect(decodeRouteFor(plan()).honoursSkipFrame).toBe(true);
  });
});
