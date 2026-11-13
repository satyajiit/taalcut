// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T3: which read makes the filmstrip, and its arguments, with no FFmpeg.
 * The proxy's keyframes when each tile is at least one proxy GOP (half a
 * second) after the one before; the exact grid frames for an original, a
 * short clip and a decoder that can't skip to keyframes. On a Windows profile
 * the proxy decodes on NVDEC with `scale_cuda` (not run on Windows hardware).
 */
import { RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  filmstripLayout,
  keyframeTileSpacing,
  spriteRead,
  type NormalisationPlan,
  type ToneMapChoice,
} from '@taalcut/media';
import { videoPlan } from '../helpers/video-plan';

const none: ToneMapChoice = { method: 'none', backend: 'software' };

/** A 1280×720 30 fps plan of `seconds`. */
function proxyPlan(seconds: number, platform: NodeJS.Platform = 'darwin'): NormalisationPlan {
  const plan = videoPlan(
    {
      width: 1280,
      height: 720,
      displayWidth: 1280,
      displayHeight: 720,
      duration: { value: seconds, rate: 1 },
    },
    false,
    platform,
  );
  const frames = seconds * 30;
  return { ...plan, frames, duration: RationalTime.of(frames, plan.frameRate.output) };
}

const vfOf = (args: readonly string[]) => args[args.indexOf('-vf') + 1] ?? '';

describe('keyframeTileSpacing', () => {
  it('is the seconds between tiles when that is at least the proxy GOP', () => {
    const plan = proxyPlan(40);
    // 20 tiles over frames 0–1199: 63.1 frames apart.
    expect(keyframeTileSpacing(plan, filmstripLayout(plan))).toBeCloseTo(1199 / 19 / 30, 6);
  });

  it('is undefined for tiles closer than half a second, and for one tile', () => {
    const short = proxyPlan(3);
    // A 16:9 clip gets 20 frames however short: 3 s of them fall 0.16 s apart.
    expect(filmstripLayout(short).tiles).toHaveLength(20);
    expect(keyframeTileSpacing(short, filmstripLayout(short))).toBeUndefined();
    const one = { ...short, frames: 1 };
    expect(keyframeTileSpacing(one, filmstripLayout(one))).toBeUndefined();
  });
});

describe('spriteRead', () => {
  it('reads the proxy’s keyframes on VideoToolbox, onto the tiles’ grid, padded past the last keyframe', () => {
    const plan = proxyPlan(40);
    const layout = filmstripLayout(plan);
    const read = spriteRead('/cache/proxy.mp4', plan, none, layout, { proxy: true });
    expect(read.source).toBe('keyframes');
    expect(read.args.slice(0, 7)).toEqual([
      ...['-noautorotate', '-hwaccel', 'videotoolbox', '-hwaccel_output_format', 'videotoolbox_vld'],
      ...['-skip_frame', 'nokey'],
    ]);
    expect(read.args).not.toContain('-ss');
    expect(vfOf(read.args)).toBe(
      [
        'sidedata=mode=delete:type=DISPLAYMATRIX',
        `scale_vt=w=${layout.tileWidth}:h=${layout.tileHeight}`,
        'hwdownload',
        'format=nv12',
        'setpts=PTS-STARTPTS',
        'tpad=stop_mode=clone:stop=-1',
        // 19 tile gaps over 1199 frames of 30 fps: ticks on the tiles' own times.
        `fps=fps=${19 * 30}/${1199 * 1}:round=up`,
        'trim=end_frame=20',
        `tile=${layout.columns}x${layout.rows}`,
      ].join(','),
    );
    expect(read.args.slice(-4)).toEqual(['-frames:v', '1', '-fps_mode', 'passthrough']);
  });

  it('reads exact grid frames from an original, and from a proxy of a short clip', () => {
    const plan = proxyPlan(40);
    const original = spriteRead('/clips/clip.mov', plan, none, filmstripLayout(plan), { proxy: false });
    expect(original.source).toBe('exact');
    expect(original.args).not.toContain('-skip_frame');
    expect(vfOf(original.args)).toContain("select='eq(n\\,0)+");
    const short = proxyPlan(3);
    expect(spriteRead('/cache/proxy.mp4', short, none, filmstripLayout(short), { proxy: true }).source).toBe(
      'exact',
    );
  });

  it('Windows profile: the proxy’s keyframes on NVDEC, scale_cuda, no _npp', () => {
    const plan = proxyPlan(40, 'win32');
    const layout = filmstripLayout(plan);
    const read = spriteRead('C:/cache/proxy.mp4', plan, none, layout, {
      proxy: true,
      profile: { decoder: 'nvdec' },
    });
    expect(read.source).toBe('keyframes');
    expect(read.args.slice(0, 7)).toEqual([
      ...['-noautorotate', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      ...['-skip_frame', 'nokey'],
    ]);
    expect(vfOf(read.args)).toContain(`scale_cuda=w=${layout.tileWidth}:h=${layout.tileHeight}:interp_algo=bicubic,hwdownload`);
    expect(vfOf(read.args)).not.toMatch(/_npp|cuvid/);
  });
});
