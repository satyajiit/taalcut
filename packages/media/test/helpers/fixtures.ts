// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Makes small fixture clips with ffmpeg in a temp directory (never committed).
 * Encoders are picked from what the build has, so this works with Homebrew's
 * GPL build (x264, x265) and with the LGPL build (OpenH264, VideoToolbox).
 * A clip the build can't make is reported in `missing` and its tests skip.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectEncoders, runFfmpeg, type EncoderSupport, type MediaContext } from '@taalcut/media';

export type FixtureName = 'h264' | 'hevcHlg' | 'rotated' | 'vfr' | 'audio' | 'mjpeg' | 'mpeg4';

export interface Fixtures {
  readonly dir: string;
  readonly paths: Partial<Record<FixtureName, string>>;
  readonly missing: Partial<Record<FixtureName, string>>;
}

/** Apple QuickTime keys written into the rotated clip, as an iPhone does. */
export const PHONE_TAGS = {
  'com.apple.quicktime.make': 'Apple',
  'com.apple.quicktime.model': 'iPhone 17 Pro',
  'com.apple.quicktime.software': '26.0',
  'com.apple.quicktime.creationdate': '2026-10-01T15:30:00+0530',
  'com.apple.quicktime.location.ISO6709': '+19.0760+072.8777+010.000/',
} as const;

const CHAPTERS = `;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=1000
title=Intro
[CHAPTER]
TIMEBASE=1/1000
START=1000
END=2002
title=Main
`;

function h264Args(enc: EncoderSupport): string[] | undefined {
  if (!enc.preferredH264) return undefined;
  // Prefer a software encoder for deterministic fixtures; VideoToolbox is the last resort.
  const name = ['libx264', 'libopenh264', 'h264_videotoolbox'].find((n) =>
    enc.encoders.some((e) => e.name === n),
  );
  return name
    ? ['-c:v', name, '-pix_fmt', 'yuv420p', ...(name === 'libx264' ? [] : ['-b:v', '1M'])]
    : undefined;
}

function hevc10Args(enc: EncoderSupport): { codec: string[]; pixFmt: string } | undefined {
  if (enc.encoders.some((e) => e.name === 'libx265')) {
    return { codec: ['-c:v', 'libx265', '-x265-params', 'log-level=error'], pixFmt: 'yuv420p10le' };
  }
  if (enc.hevcVideoToolbox)
    return { codec: ['-c:v', 'hevc_videotoolbox', '-profile:v', 'main10'], pixFmt: 'p010le' };
  // NVENC on Linux: Main10 from P010, with the HLG VUI written into the bitstream as media's exports do.
  if (enc.hardware.cuda?.includes('hevc_nvenc'))
    return {
      codec: [
        '-c:v',
        'hevc_nvenc',
        '-profile:v',
        'main10',
        '-bsf:v',
        'hevc_metadata=colour_primaries=9:transfer_characteristics=18:matrix_coefficients=9',
      ],
      pixFmt: 'p010le',
    };
  return undefined;
}

export async function makeFixtures(ctx: MediaContext, wanted: readonly FixtureName[]): Promise<Fixtures> {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-media-'));
  const paths: Partial<Record<FixtureName, string>> = {};
  const missing: Partial<Record<FixtureName, string>> = {};
  const encoders = await detectEncoders(ctx);
  if (!encoders.ok) throw new Error(`ffmpeg -encoders failed: ${encoders.error.detail ?? ''}`);
  const h264 = h264Args(encoders.value);
  const hevc = hevc10Args(encoders.value);
  const need = new Set<FixtureName>(wanted);
  if (need.has('rotated')) need.add('h264');

  const make = async (name: FixtureName, file: string, args: string[] | undefined, why: string) => {
    if (!need.has(name)) return;
    if (!args) {
      missing[name] = why;
      return;
    }
    const out = join(dir, file);
    const result = await runFfmpeg(ctx, ['-y', ...args, out], { timeoutMs: 60_000 });
    if (result.ok) paths[name] = out;
    else missing[name] = `${result.error.code}: ${result.error.detail ?? ''}`;
  };

  const chapters = join(dir, 'chapters.txt');
  await writeFile(chapters, CHAPTERS);
  const lavfi = (graph: string) => ['-f', 'lavfi', '-i', graph];

  await make(
    'h264',
    'h264-29.97.mp4',
    h264 && [
      ...lavfi('testsrc2=size=320x240:rate=30000/1001'),
      ...lavfi('sine=frequency=440:sample_rate=48000'),
      ...['-i', chapters, '-map', '0:v', '-map', '1:a', '-map_metadata', '2', '-map_chapters', '2'],
      ...['-t', '2', ...h264, '-c:a', 'aac', '-metadata', 'creation_time=2026-10-01T10:00:00Z'],
    ],
    'no H.264 encoder in this build',
  );
  await make(
    'hevcHlg',
    'hevc-10bit-hlg.mp4',
    hevc && [
      ...lavfi('testsrc2=size=320x240:rate=25'),
      '-t',
      '1',
      '-vf',
      `setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,format=${hevc.pixFmt}`,
      ...hevc.codec,
      '-tag:v',
      'hvc1',
    ],
    'no 10-bit HEVC encoder in this build',
  );
  const phoneTags = Object.entries(PHONE_TAGS).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
  await make(
    'rotated',
    'rotated-portrait.mov',
    paths.h264
      ? [
          ...[
            '-display_rotation',
            '-90',
            '-i',
            paths.h264,
            '-map',
            '0:v',
            '-map',
            '0:a',
            '-map_chapters',
            '-1',
          ],
          ...['-c', 'copy', '-movflags', 'use_metadata_tags', ...phoneTags],
        ]
      : undefined,
    'needs the H.264 clip',
  );
  await make(
    'vfr',
    'vfr.mp4',
    // Keep the first second at 30 fps, then every third frame: r_frame_rate 30/1, avg far lower.
    h264 && [
      ...lavfi('testsrc2=size=320x240:rate=30'),
      '-t',
      '2',
      '-vf',
      "select='lt(n\\,30)+not(mod(n\\,3))'",
      '-fps_mode',
      'vfr',
      ...h264,
    ],
    'no H.264 encoder in this build',
  );
  await make(
    'audio',
    'audio-only.m4a',
    [...lavfi('sine=frequency=440:sample_rate=44100'), '-t', '1', '-ac', '2', '-c:a', 'aac'],
    'unreachable',
  );
  // FFmpeg's own encoders, in every build: codecs VideoToolbox lacks (MJPEG) or can't run on Apple silicon (MPEG-4 Part 2).
  const pattern = [...lavfi('testsrc2=size=320x240:rate=25'), '-t', '1'];
  await make('mjpeg', 'mjpeg.mov', [...pattern, '-c:v', 'mjpeg', '-pix_fmt', 'yuvj420p'], 'unreachable');
  await make('mpeg4', 'mpeg4.mp4', [...pattern, '-c:v', 'mpeg4'], 'unreachable');
  return { dir, paths, missing };
}

export async function removeFixtures(fixtures: Fixtures | undefined): Promise<void> {
  if (fixtures) await rm(fixtures.dir, { recursive: true, force: true });
}
