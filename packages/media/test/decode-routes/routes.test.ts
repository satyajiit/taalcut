// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D1: the decode routes' arguments. VideoToolbox and the software route
 * are also run against real files (test/frame-sets); NVDEC and D3D11VA are
 * Windows routes no machine of this round runs, so their arguments are
 * pinned here: the right hwaccel, the turn and scale on the device where
 * FFmpeg has a filter for it (and only LGPL ones: `scale_cuda`,
 * `transpose_cuda`, never the nonfree `_npp` filters), the download format,
 * and the HDR tone-map before the split.
 */
import { describe, expect, it } from 'vitest';
import {
  branchGraph,
  decodeRouteFor,
  type DecodeProfile,
  type NormalisationPlan,
  type ToneMapChoice,
} from '@taalcut/media';
import { hdPlan, HLG_STREAM } from '../helpers/video-plan';

const none: ToneMapChoice = { method: 'none', backend: 'software' };
const placebo: ToneMapChoice = { method: 'libplacebo', backend: 'vulkan', curve: 'bt.2446a' };
const HLG = HLG_STREAM;

/** A 1920×1080 30 fps plan (two seconds) for the platform's decoder. */
const plan = hdPlan;

/** The conform to the plan's 30 fps grid every route runs before the split. */
const CONFORM = 'setpts=PTS-STARTPTS,fps=fps=30/1:round=near';
const portrait = { rotation: 90 as const, displayWidth: 1080, displayHeight: 1920 };
const nvdec: DecodeProfile = { decoder: 'nvdec' };
const d3d11va: DecodeProfile = { decoder: 'd3d11va' };

/** The `-filter_complex` value and the input options of a two-branch graph (256 px and an exact 224×224). */
function graphOf(source: NormalisationPlan, profile?: DecodeProfile, toneMap = none) {
  const graph = branchGraph('/clips/clip.mov', source, {
    route: decodeRouteFor(source, profile),
    toneMap,
    branches: [
      { size: { longSide: 256 }, filters: ['scdet=threshold=0:sc_pass=1'] },
      { size: { width: 224, height: 224, exact: true }, pick: { every: 30 } },
    ],
  });
  const at = graph.args.indexOf('-filter_complex');
  return { input: graph.args.slice(0, at), filter: graph.args[at + 1] ?? '', outputs: graph.outputs };
}

describe('decodeRouteFor', () => {
  it('takes the plan’s VideoToolbox route on a Mac, whatever the profile says', () => {
    expect(decodeRouteFor(plan()).id).toBe('videotoolbox');
    expect(decodeRouteFor(plan(), nvdec).id).toBe('videotoolbox');
  });

  it('takes the profile’s decoder only when no hardware decoder was wired for the platform', () => {
    const windows = plan({}, 'win32');
    expect(decodeRouteFor(windows).id).toBe('software');
    expect(decodeRouteFor(windows, nvdec).id).toBe('cuda');
    expect(decodeRouteFor(windows, d3d11va).id).toBe('d3d11va');
    expect(decodeRouteFor(windows, { decoder: 'none' }).id).toBe('software');
    // The hardware can't take the codec: software, even with a GPU in the profile.
    expect(decodeRouteFor(plan({ codec: 'theora' }), nvdec).id).toBe('software');
  });
});

describe('multi-branch graphs per route', () => {
  it('VideoToolbox: one turn on the GPU before the split, a scale_vt and download per branch', () => {
    const { input, filter, outputs } = graphOf(plan(portrait));
    expect(input.slice(0, 5)).toEqual([
      ...['-noautorotate', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'],
    ]);
    expect(input.slice(-2)).toEqual(['-i', 'file:/clips/clip.mov']);
    expect(outputs).toEqual(['[o0]', '[o1]']);
    // The frames reach the CPU at their size and only convert there: on one thread, so they repeat (IX2-F15).
    const [options, shared, first, second] = filter.split(';');
    expect(options).toBe('sws_flags=bicubic:threads=1');
    expect(shared).toBe(
      `[0:V:0]sidedata=mode=delete:type=DISPLAYMATRIX,transpose_vt=dir=clock,${CONFORM},split=2[s0][s1]`,
    );
    expect(first).toBe('[s0]scale_vt=w=144:h=256,hwdownload,format=nv12,scdet=threshold=0:sc_pass=1[o0]');
    expect(second).toBe(
      "[s1]select='not(mod(n\\,30))',setpts=N/FRAME_RATE/TB,scale_vt=w=224:h=224,hwdownload,format=nv12[o1]",
    );
  });

  it('taps a branch’s frames in colour on the CPU, with no second device scale, labelled after every branch', () => {
    const source = plan();
    const graph = branchGraph('/clips/clip.mov', source, {
      route: decodeRouteFor(source),
      toneMap: none,
      branches: [
        {
          size: { longSide: 256 },
          filters: ['scdet=threshold=0:sc_pass=1'],
          taps: [{ pick: { every: 2 }, filters: ['scale=48:27:flags=bicubic', 'format=rgb24'] }],
        },
        { size: { width: 224, height: 224, exact: true }, pick: { every: 30 } },
      ],
    });
    const filter = graph.args[graph.args.indexOf('-filter_complex') + 1] ?? '';
    const [, , first, own, , tap] = filter.split(';');
    expect(graph.outputs).toEqual(['[o0]', '[o1]', '[o2]']);
    expect(first).toBe('[s0]scale_vt=w=256:h=144,hwdownload,format=nv12,split=2[b0][t0_0]');
    // A gray output converts on its own path, after the split, so the tap still sees nv12; on one thread (IX2-F15).
    expect(own).toBe('[b0]scale=threads=1,scdet=threshold=0:sc_pass=1[o0]');
    expect(tap).toBe(
      "[t0_0]select='not(mod(n\\,2))',setpts=N/FRAME_RATE/TB,scale=48:27:flags=bicubic,format=rgb24[o2]",
    );
    expect(filter.match(/scale_vt/g)).toHaveLength(2);
  });

  it('VideoToolbox HDR: downloads and tone-maps every frame once, then scales on the CPU per branch', () => {
    const { filter } = graphOf(plan(HLG), undefined, placebo);
    const [shared, first] = filter.split(';');
    // Its scales are the CPU's, full-size frames: they keep their threads (a conversion that scales repeats).
    expect(filter).not.toContain('threads=1');
    expect(shared).toContain('hwdownload,format=p010le,');
    expect(shared).toContain('libplacebo');
    expect(shared?.indexOf('libplacebo')).toBeLessThan(shared?.indexOf('split=2') ?? -1);
    expect(first).toContain('scale=256:144:flags=bicubic');
    expect(first).not.toContain('scale_vt');
  });

  it('HDR downloads in the depth it has (LIB1-FIX): 8-bit HLG as nv12, 10-bit HLG or PQ and unknown depth as p010le', () => {
    const shared = (source: NormalisationPlan, profile?: DecodeProfile) =>
      graphOf(source, profile, placebo).filter.split(';')[0] ?? '';
    /** The plan with its source's depth not known. */
    const depthUnknown = (known: NormalisationPlan): NormalisationPlan => {
      const { bitDepth: _known, ...source } = known.source;
      return { ...known, source };
    };
    // Some phones record 8-bit HLG: its VideoToolbox surface is nv12, and hwdownload can't convert to p010le.
    const eightBit = { ...HLG, bitDepth: 8, pixelFormat: 'yuv420p' };
    expect(shared(plan(eightBit))).toContain('hwdownload,format=nv12,');
    expect(shared(plan(eightBit))).toContain('libplacebo');
    expect(shared(plan(HLG))).toContain('hwdownload,format=p010le,');
    const pq = { ...HLG, hdrFormats: ['pq' as const], colour: { ...HLG.colour, transfer: 'smpte2084' } };
    expect(shared(plan(pq))).toContain('hwdownload,format=p010le,');
    // Depth unknown: HDR is nearly always 10-bit, and naming nv12 for a p010 surface fails the same way.
    expect(shared(depthUnknown(plan(eightBit)))).toContain('hwdownload,format=p010le,');
    // D3D11VA, pinned here (no Windows hardware this round): the same three.
    expect(shared(plan(eightBit, 'win32'), d3d11va)).toContain('hwdownload,format=nv12,');
    expect(shared(plan(HLG, 'win32'), d3d11va)).toContain('hwdownload,format=p010le,');
    expect(shared(depthUnknown(plan(eightBit, 'win32')), d3d11va)).toContain('hwdownload,format=p010le,');
    // An SDR stream of unknown depth downloads its surface, as before.
    expect(graphOf(depthUnknown(plan({}, 'win32')), d3d11va).filter).not.toContain('p010le');
  });

  it('NVDEC: CUDA decode, transpose_cuda before the split, scale_cuda and a download per branch', () => {
    const { input, filter } = graphOf(plan({ ...portrait, mirrored: true }, 'win32'), nvdec);
    expect(input.slice(0, 5)).toEqual([
      '-noautorotate',
      '-hwaccel',
      'cuda',
      '-hwaccel_output_format',
      'cuda',
    ]);
    const [options, shared, first, second] = filter.split(';');
    expect(options).toBe('sws_flags=bicubic:threads=1');
    expect(shared).toContain('sidedata=mode=delete:type=DISPLAYMATRIX,transpose_cuda=dir=clock');
    expect(first).toContain('scale_cuda=w=144:h=256:interp_algo=bicubic,hwdownload,format=nv12,hflip,scdet');
    expect(second).toContain('scale_cuda=w=224:h=224:interp_algo=bicubic,hwdownload,format=nv12,hflip');
    expect(filter).not.toMatch(/_npp/);
  });

  it('NVDEC: 10-bit SDR downloads as p010le; HDR downloads before the split and scales on the CPU', () => {
    const tenBit = graphOf(plan({ bitDepth: 10, pixelFormat: 'yuv420p10le' }, 'win32'), nvdec).filter;
    expect(tenBit).toContain('scale_cuda=w=256:h=144:interp_algo=bicubic,hwdownload,format=p010le');
    const hdr = graphOf(plan(HLG, 'win32'), nvdec, placebo).filter;
    const [shared, first] = hdr.split(';');
    expect(shared).toContain('hwdownload,format=p010le,');
    expect(shared).toContain('libplacebo');
    expect(first).toContain('scale=256:144:flags=bicubic');
    expect(first).not.toContain('scale_cuda');
  });

  it('D3D11VA: one download before the split, then the scale sideways and the turn on the CPU per branch', () => {
    const { input, filter } = graphOf(plan({ ...portrait, mirrored: true }, 'win32'), d3d11va);
    expect(input.slice(0, 5)).toEqual([
      ...['-noautorotate', '-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11'],
    ]);
    const [shared, first, second] = filter.split(';');
    expect(shared).toBe(
      `[0:V:0]sidedata=mode=delete:type=DISPLAYMATRIX,hwdownload,format=nv12,${CONFORM},split=2[s0][s1]`,
    );
    // 144×256 upright is 256×144 before the turn.
    expect(first).toBe('[s0]scale=256:144:flags=bicubic,transpose=1,hflip,scdet=threshold=0:sc_pass=1[o0]');
    expect(second).toContain('scale=224:224:flags=bicubic,transpose=1,hflip[o1]');
  });

  it('scales a long side exactly to the size its frames are read at (1920×1080 at 400 is 400×224)', () => {
    const graph = branchGraph('/clips/clip.mov', plan(HLG), {
      route: decodeRouteFor(plan(HLG)),
      toneMap: placebo,
      branches: [{ size: { longSide: 400 } }],
    });
    const filter = graph.args[graph.args.indexOf('-filter_complex') + 1] ?? '';
    // A fit-inside scale gives 398×224 there, and a frame file indexed at 400×224 reads nothing.
    expect(filter).toContain('scale=400:224:flags=bicubic');
  });

  it('software: FFmpeg turns the video, the branch only scales', () => {
    const { input, filter } = graphOf(plan({ ...portrait, codec: 'theora' }));
    expect(input).not.toContain('-hwaccel');
    expect(filter.split(';')[1]).toBe('[s0]scale=144:256:flags=bicubic,scdet=threshold=0:sc_pass=1[o0]');
  });
});
