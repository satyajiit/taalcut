// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns the loop's render into the README's GIF: 960 px wide, 15 frames a second, one palette made from the whole
 * loop. Render first (`npm run render` in how-it-works/); FFmpeg must be on the PATH.
 *
 *   node design/readme/gif.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const source = join(here, 'how-it-works/renders/how-it-works.mp4');
const media = join(here, '../../.github/media');
mkdirSync(media, { recursive: true });
const target = join(media, 'how-it-works.gif');

// `diff` weighs the palette toward what moves and `rectangle` stores only the part of each frame that changed,
// which is most of why a ten-second loop with photographs in it stays small.
const filter = [
  'fps=15,scale=960:-2:flags=lanczos,split[a][b]',
  '[a]palettegen=max_colors=200:stats_mode=diff[p]',
  '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
].join(';');
execFileSync('ffmpeg', [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  source,
  '-filter_complex',
  filter,
  '-loop',
  '0',
  target,
]);

const size = statSync(target).size;
process.stdout.write(`how-it-works.gif ${(size / 1048576).toFixed(2)} MB\n`);
if (size > 4 * 1048576)
  throw new Error('The GIF is over 4 MB: lower the frame rate, the width or the colours.');
