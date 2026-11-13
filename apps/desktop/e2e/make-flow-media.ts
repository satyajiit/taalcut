// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The make flow e2e's media, made at test time with the FFmpeg the app uses
 * (nothing large is committed): the reference reel to copy (five still
 * shots of one colour each, 8 s, a click track at 120 BPM over a bed under
 * -40 dB, so the test build's onset beat stand-in hears every click; every
 * cut on a beat) and the user's trip (24 moving portrait clips of 3 s).
 * Shapes and themes are in @taalcut/gate-demo's make-flow-fixtures.ts, which
 * the stand-in model reads.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIBRARY_CLIP_SECONDS,
  LIBRARY_CLIPS,
  MEDIA_SIZE,
  REFERENCE_BPM,
  REFERENCE_RATE,
  REFERENCE_SHOTS,
} from '@taalcut/gate-demo';
import { unwrap } from '@taalcut/core';
import { detectEncoders, runFfmpeg, type ResolvedFfmpeg } from '@taalcut/media';

const SIZE = `${MEDIA_SIZE.width}x${MEDIA_SIZE.height}`;

async function videoCodec(binaries: ResolvedFfmpeg): Promise<string[]> {
  const encoders = unwrap(await detectEncoders({ binaries }));
  const has = (name: string) => encoders.encoders.some((e) => e.name === name);
  if (has('h264_videotoolbox')) return ['-c:v', 'h264_videotoolbox', '-b:v', '6M'];
  if (has('libopenh264')) return ['-c:v', 'libopenh264', '-b:v', '6M'];
  return ['-c:v', 'mpeg4', '-q:v', '3'];
}

/** The reel: its shots back to back, a click on every beat. Returns its path. */
export async function makeReferenceReel(
  binaries: ResolvedFfmpeg,
  dir: string,
  name: string,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const frames = REFERENCE_SHOTS.reduce((sum, shot) => sum + shot.frames, 0);
  const seconds = frames / REFERENCE_RATE;
  const beat = 60 / REFERENCE_BPM;
  const inputs = REFERENCE_SHOTS.flatMap((shot) => [
    '-f',
    'lavfi',
    '-t',
    String(shot.frames / REFERENCE_RATE),
    '-i',
    shot.lavfi(SIZE, REFERENCE_RATE),
  ]);
  const click = `aevalsrc=0.7*sin(2*PI*1000*t)*lt(mod(t\\,${beat})\\,0.03)+0.004*sin(2*PI*110*t):s=48000:d=${seconds}`;
  const graph = [
    ...REFERENCE_SHOTS.map((_, i) => `[${i}:v]format=yuv420p,setsar=1[v${i}]`),
    `${REFERENCE_SHOTS.map((_, i) => `[v${i}]`).join('')}concat=n=${REFERENCE_SHOTS.length}:v=1:a=0[v]`,
  ].join(';');
  unwrap(
    await runFfmpeg({ binaries }, [
      '-y',
      ...inputs,
      ...['-f', 'lavfi', '-i', click],
      ...['-filter_complex', graph, '-map', '[v]', '-map', `${REFERENCE_SHOTS.length}:a`],
      ...(await videoCodec(binaries)),
      ...['-pix_fmt', 'yuv420p', '-r', String(REFERENCE_RATE), '-c:a', 'aac', '-b:a', '128k'],
      ...['-t', String(seconds), '-movflags', '+faststart', path],
    ]),
  );
  return path;
}

/** The trip's clips, in capture order. Returns their paths. */
export async function makeLibraryClips(binaries: ResolvedFfmpeg, dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const codec = await videoCodec(binaries);
  const paths: string[] = [];
  for (const clip of LIBRARY_CLIPS) {
    const path = join(dir, clip.file);
    unwrap(
      await runFfmpeg({ binaries }, [
        '-y',
        ...['-f', 'lavfi', '-t', String(LIBRARY_CLIP_SECONDS), '-i', clip.lavfi(SIZE, REFERENCE_RATE)],
        ...['-vf', 'format=yuv420p,setsar=1'],
        ...codec,
        // 24 clips share 6 sources, and OpenH264 encodes the same frames to the same bytes; the library
        // refuses a second file with the same content (library.conflict), so each carries its own name.
        ...['-metadata', `title=${clip.file}`],
        ...['-pix_fmt', 'yuv420p', '-r', String(REFERENCE_RATE), '-an', '-movflags', '+faststart', path],
      ]),
    );
    paths.push(path);
  }
  return paths;
}
