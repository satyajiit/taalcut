// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fixture films' picture, encoded with FFmpeg at fixture-build time: flat colour cards as MPEG-4 part 2 in an
 * MP4 with bit-exact flags (an LGPL encoder every FFmpeg build has). Picture only; the soundtrack is its own WAV.
 */
import { spawn } from 'node:child_process';
import { FPS, frameRgb, HEIGHT, WIDTH } from './film.mjs';

export function writeFilmVideo({ ffmpeg = 'ffmpeg', truth, path }) {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    `${WIDTH}x${HEIGHT}`,
    '-r',
    String(FPS),
    '-i',
    '-',
    '-an',
    '-c:v',
    'mpeg4',
    '-q:v',
    '2',
    '-g',
    String(FPS * 10),
    '-pix_fmt',
    'yuv420p',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-map_metadata',
    '-1',
    path,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(path) : reject(new Error(`ffmpeg ${code}: ${err}`))));
    let frame = 0;
    const pump = () => {
      while (frame < truth.frames) {
        const ok = child.stdin.write(frameRgb(truth.cards, frame));
        frame += 1;
        if (!ok) return child.stdin.once('drain', pump);
      }
      child.stdin.end();
    };
    pump();
  });
}
