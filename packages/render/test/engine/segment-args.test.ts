// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * segmentArgs without running FFmpeg: upright once on every route (VideoToolbox, NVDEC, the CPU), a ramp on its
 * exact curve, the NVDEC graph that never leaves the GPU when nothing needs the CPU (LNX1-RND), and the software
 * retry's route without hardware (IX3-K4). The routes are media's rows, so a Mac and a Linux host both check both.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime } from '@taalcut/core';
import { segmentArgs } from '../../src/engine/segment-args';
import { softwareVideoRoute, type VideoRoute } from '../../src/engine/video-route';
import { phoneStream as phone, plannedVisual as visualOf } from '../support/planned';

const rate = FrameRate.of(30);
const canvas = { rate, width: 1080, height: 1920 };
const out = { video: '/tmp/s.mp4', audio: '/tmp/s.wav' };

const GPU: VideoRoute = {
  decode: { backend: 'videotoolbox', surfaceFormat: 'nv12' },
  encoder: 'h264_videotoolbox',
};
/** The plan's software decode (the hardware can't take the file): the encode stays on VideoToolbox. */
const CPU_DECODE: VideoRoute = { decode: { backend: 'software' }, encoder: 'h264_videotoolbox' };
/** NVDEC and NVENC (an NVIDIA machine). */
const CUDA: VideoRoute = { decode: { backend: 'cuda', surfaceFormat: 'nv12' }, encoder: 'h264_nvenc' };
/** The software retry's route: no hardware at all. */
const SOFTWARE = softwareVideoRoute('linux');

const filterOf = (args: readonly string[]) => args[args.indexOf('-vf') + 1]!.split(',');

describe('segmentArgs orientation', () => {
  it('rotates on the GPU once and drops the display matrix', () => {
    const args = segmentArgs(visualOf(30), 'in.mov', phone(), GPU, [], false, out, canvas);
    expect(args.slice(0, args.indexOf('-i'))).toContain('-noautorotate');
    const chain = filterOf(args);
    expect(chain.slice(0, 5)).toEqual([
      'sidedata=mode=delete:type=DISPLAYMATRIX',
      'transpose_vt=dir=clock',
      'scale_vt=w=1080:h=1920',
      'hwdownload',
      'format=nv12',
    ]);
    expect(chain).not.toContain('hflip');
  });

  it('flips a mirrored matrix after the download, on both routes', () => {
    const vt = filterOf(
      segmentArgs(visualOf(30), 'in.mov', phone({ mirrored: true }), GPU, [], false, out, canvas),
    );
    expect(vt.indexOf('hflip')).toBe(vt.indexOf('hwdownload') + 2);
    const cpu = filterOf(
      segmentArgs(visualOf(30), 'in.mov', phone({ mirrored: true }), CPU_DECODE, [], false, out, canvas),
    );
    expect(cpu.slice(0, 4)).toEqual([
      'sidedata=mode=delete:type=DISPLAYMATRIX',
      'transpose=1',
      'scale=1080:1920:flags=bicubic',
      'hflip',
    ]);
  });

  it('rotates the software fallback itself, with autorotate off, so it matches the GPU route', () => {
    const args = segmentArgs(
      visualOf(30),
      'in.mov',
      phone({ rotation: 270 }),
      CPU_DECODE,
      [],
      false,
      out,
      canvas,
    );
    expect(args.slice(0, args.indexOf('-i'))).toEqual(expect.arrayContaining(['-noautorotate']));
    expect(args).not.toContain('-hwaccel');
    expect(filterOf(args).slice(0, 2)).toEqual(['sidedata=mode=delete:type=DISPLAYMATRIX', 'transpose=2']);
  });
});

describe('segmentArgs speed', () => {
  const speed = {
    curve: 'linear' as const,
    points: [
      { at: RationalTime.of(0, rate), speed: 0.5 },
      { at: RationalTime.of(60, rate), speed: 2 },
    ],
  };

  it('bakes a ramp on its curve, not one setpts and atempo of the mean', () => {
    const visual = visualOf(60, { speed, meanSpeed: 1.25 });
    const args = segmentArgs(visual, 'in.mov', phone({ rotation: 0 }), GPU, [], true, out, canvas);
    const chain = args[args.indexOf('-vf') + 1]!;
    expect(chain).toContain("setpts='st(0,T-STARTT);(if(lt(ld(0),");
    expect(chain).not.toContain('/1.25');
    // Source read: 75 frames of the ramp, then 2× for the held tail frame, plus a second of margin.
    expect(args[args.indexOf('-t') + 1]).toBe((77 / 30 + 1).toFixed(6));
    const audio = args[args.indexOf('-af') + 1]!;
    expect(audio).toContain('asplit=');
    expect(audio).not.toContain('atempo=1.25');
  });

  it('leaves real time alone', () => {
    const args = segmentArgs(visualOf(30), 'in.mov', phone(), GPU, [], true, out, canvas);
    expect(args[args.indexOf('-vf') + 1]).toContain(',setpts=PTS-STARTPTS,');
    expect(args[args.indexOf('-af') + 1]).toBe('asetpts=PTS-STARTPTS,aresample=48000');
  });
});

describe('segmentArgs encoders', () => {
  const encoder = (args: readonly string[]) => args[args.indexOf('-c:v') + 1];

  it('encodes on VideoToolbox with no software fallback of its own, unless the route says OpenH264', () => {
    for (const route of [GPU, CPU_DECODE]) {
      const args = segmentArgs(visualOf(30), 'in.mov', phone(), route, [], false, out, canvas);
      expect(encoder(args)).toBe('h264_videotoolbox');
      // A refused session fails into the logged OpenH264 retry (IX3-F5, M5).
      expect(args).not.toContain('-allow_sw');
    }
    const software = segmentArgs(visualOf(30), 'in.mov', phone(), SOFTWARE, [], false, out, canvas);
    expect(encoder(software)).toBe('libopenh264');
    expect(software).not.toContain('-allow_sw');
    expect(software).not.toContain('-hwaccel');
    expect(software.some((arg) => arg.includes('_vt'))).toBe(false);
    expect(software[software.indexOf('-b:v') + 1]).toBe('40000000');
  });

  it("takes NVENC with media's conform flags on an NVIDIA route", () => {
    const args = segmentArgs(visualOf(30), 'in.mov', phone({ mirrored: true }), CUDA, [], false, out, canvas);
    expect(encoder(args)).toBe('h264_nvenc');
    expect(args.join(' ')).toContain('-preset p5 -tune hq');
    expect(args[args.indexOf('-bf') + 1]).toBe('0');
    expect(args).toContain('yuv420p');
  });
});

describe('segmentArgs on NVDEC (LNX1-RND)', () => {
  const bt709 = { colour: { space: 'bt709', range: 'tv' } };

  it('turns and scales on CUDA and hands NVENC the CUDA frames when nothing needs the CPU (zero copy)', () => {
    const args = segmentArgs(visualOf(30), 'in.mov', phone(bt709), CUDA, [], false, out, canvas);
    expect(args.slice(0, args.indexOf('-i'))).toEqual(
      expect.arrayContaining(['-noautorotate', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']),
    );
    const chain = filterOf(args);
    expect(chain.slice(0, 3)).toEqual([
      'sidedata=mode=delete:type=DISPLAYMATRIX',
      'transpose_cuda=dir=clock',
      'scale_cuda=w=1080:h=1920:interp_algo=bicubic',
    ]);
    expect(chain).not.toContain('hwdownload');
    expect(chain).not.toContain('format=yuv420p');
    // Device frames carry their own format: no -pix_fmt that would ask for a download.
    expect(args).not.toContain('-pix_fmt');
  });

  it('downloads after the scale when the CPU has work: a mirror, a crop, a tone-map, a colour to convert', () => {
    // Untagged (FFmpeg reads it as BT.601) or full range: the CPU format step converts it to the segment's colour.
    for (const colour of [{}, { space: 'bt709', range: 'pc' }, { space: 'smpte170m', range: 'tv' }]) {
      const chain = filterOf(
        segmentArgs(visualOf(30), 'in.mov', phone({ colour }), CUDA, [], false, out, canvas),
      );
      expect(chain.slice(3, 5)).toEqual(['hwdownload', 'format=nv12']);
      expect(chain.at(-1)).toBe('format=yuv420p');
    }
    const mirrored = filterOf(
      segmentArgs(visualOf(30), 'in.mov', phone({ mirrored: true, ...bt709 }), CUDA, [], false, out, canvas),
    );
    expect(mirrored.slice(3, 6)).toEqual(['hwdownload', 'format=nv12', 'hflip']);
    expect(mirrored.at(-1)).toBe('format=yuv420p');
    // A landscape clip covering the portrait canvas: crop after the download (NVENC ignores a crop on CUDA frames).
    const landscape = phone({ rotation: 0, displayWidth: 1920, displayHeight: 1080, ...bt709 });
    const cropped = filterOf(segmentArgs(visualOf(30), 'in.mov', landscape, CUDA, [], false, out, canvas));
    expect(cropped.indexOf('hwdownload')).toBeLessThan(cropped.findIndex((step) => step.startsWith('crop=')));
    const toneMapped = filterOf(
      segmentArgs(visualOf(30), 'in.mov', phone(bt709), CUDA, ['tonemap'], false, out, canvas),
    );
    expect(toneMapped.indexOf('hwdownload')).toBeLessThan(toneMapped.indexOf('tonemap'));
  });
});
