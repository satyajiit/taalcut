// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cuts the stills the README images use from the demonstration footage (MEDIA-LICENSE.md): one frame per clip of the
 * website's camera roll, the three reels' posters and a few frames along the Vietnam reel. FFmpeg must be
 * on the PATH. Output goes to build/stills (gitignored) and is copied into the loop's assets folder, with the font,
 * GSAP and Kaatu's sheet that the loop borrows from the workspace.
 *
 *   node design/readme/stills.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = import.meta.dirname;
const media = join(here, '../../website/public/media');
const out = join(here, 'build/stills');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/** One frame of a video at `at` seconds, scaled to `width` and saved as a JPEG. */
function frame(source, at, width, target) {
  ffmpeg([
    '-ss',
    String(at),
    '-i',
    source,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-2:flags=lanczos,format=yuvj420p`,
    '-q:v',
    '3',
    target,
  ]);
}

const roll = readdirSync(join(media, 'roll'))
  .filter((name) => name.endsWith('.mp4'))
  .sort();
// Some clips are under a second long, so the frame is taken near the start.
for (const name of roll)
  frame(join(media, 'roll', name), 0.2, 540, join(out, `roll-${name.replace('.mp4', '')}.jpg`));

const reels = ['vietnam', 'repeat', 'airport'];
for (const reel of reels) {
  ffmpeg([
    '-i',
    join(media, 'reels', reel, 'poster.webp'),
    '-vf',
    'scale=720:-2:flags=lanczos,format=yuvj420p',
    '-q:v',
    '3',
    join(out, `reel-${reel}.jpg`),
  ]);
}

// Frames along the Vietnam reel: the "saved reel" the loop reads, and the cut it ends on.
const beats = [0.4, 1.5, 2.6, 3.7, 4.8, 5.9, 7.0, 8.1, 9.2, 10.3, 11.4, 12.5];
beats.forEach((at, index) => {
  frame(
    join(media, 'reels/vietnam/reference.mp4'),
    at,
    540,
    join(out, `reel-vietnam-${String(index + 1).padStart(2, '0')}.jpg`),
  );
});

const files = readdirSync(out).sort();
writeFileSync(join(out, 'index.json'), `${JSON.stringify(files, null, 2)}\n`);
// The loop is a HyperFrames project: everything it shows has to sit inside its own folder.
const assets = join(here, 'how-it-works/assets');
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
for (const file of files) cpSync(join(out, file), join(assets, file));
const root = join(here, '../..');
// GSAP keeps its package's own `dist/` folder, which the workspace's linter already leaves alone.
const borrowed = {
  'onest.woff2': 'apps/renderer/node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
  'gsap/dist/gsap.min.js': 'apps/desktop/node_modules/gsap/dist/gsap.min.js',
  'kaatu.webp': 'website/public/kaatu/kaatu-web-creator.webp',
};
for (const [name, source] of Object.entries(borrowed)) {
  mkdirSync(dirname(join(assets, name)), { recursive: true });
  cpSync(join(root, source), join(assets, name));
}
process.stdout.write(`${files.length} stills in ${out}\n`);
