// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-REV: makes the kept reels the fake's templates play in the review, and each one's contact sheet, from
 * generated footage only (no real reel, no frame of one). A reel is cut hard at its template's slot boundaries, a
 * look per slot with a bright square crossing it so playback shows, over a kick on every beat at 120 a minute; its
 * sheet is the frame at each slot's middle, tiled as the fake's contact sheet is (template-data.ts: six columns).
 *
 *   reel-golden     Golden hour market (template-plans.ts), portrait, 12 slots, 15 s
 *   reel-portrait   Rainy market walk (template-review-plans.ts), portrait, 10 slots, 10 s: slots 4 and 5 are one
 *                   shot (the false cut), and the last fades to black
 *   reel-landscape  Coast road trip (template-review-plans.ts), landscape, 15 slots, 15 s
 *
 * The slots' beats below are the plans'; change both together. Uses the repo's FFmpeg (tools/ffmpeg/dist).
 *
 *   node apps/renderer/e2e/sample-media/make-reels.mjs
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const FFMPEG = process.env.TAALCUT_FFMPEG_DIR
  ? join(process.env.TAALCUT_FFMPEG_DIR, 'ffmpeg')
  : join(repo, 'tools/ffmpeg/dist/ffmpeg');
const FPS = 30;
const BEAT = 0.5;
const COLUMNS = 6;

/** A look per slot: hue turns round the wheel, two textures alternate. */
const look = (w, h, s, i) => {
  const hue = (i * 47) % 360;
  const base =
    i % 2 === 0
      ? `gradients=s=${w}x${h}:r=${FPS}:d=${s}:c0=0xff9a3c:c1=0xd9486a:c2=0x4a2a78:nb_colors=3:speed=0.02:type=linear`
      : `perlin=s=${w}x${h}:r=${FPS}:octaves=4:persistence=0.55:xscale=1.2:yscale=1.6:tscale=0.4:random_mode=seed:seed=${i + 3},trim=duration=${s},format=rgb24,colorchannelmixer=rr=0.3:gg=0.55:bb=0.8,curves=preset=increase_contrast`;
  const box = Math.round(Math.min(w, h) / 6);
  return `${base},hue=h=${hue},drawbox=x='mod(t*${Math.round(w / 2)},${w})':y=${Math.round(h * 0.62)}:w=${box}:h=${box}:color=white@0.85:t=fill,vignette=PI/5`;
};

/** Golden hour market (n 1), Rainy market walk (n 6), Coast road trip (n 7): each slot's beats. */
const REELS = {
  'reel-golden': { w: 360, h: 640, tile: [90, 160], beats: [3, 2, 2, 2, 3, 2, 2, 3, 2, 3, 2, 4] },
  'reel-portrait': {
    w: 360,
    h: 640,
    tile: [90, 160],
    beats: [3, 2, 2, 2, 1, 3, 2, 2, 2, 1],
    /** Slot 5 goes on from slot 4's shot: no cut there. */
    sameShot: [4],
    fadeLast: true,
  },
  'reel-landscape': {
    w: 640,
    h: 360,
    tile: [160, 90],
    beats: [3, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2],
  },
};

const MUSIC =
  '0.75*sin(2*PI*52*t)*exp(-13*mod(t,0.5))+0.14*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.4*t))+0.06*sin(2*PI*3520*t)*exp(-60*mod(t+0.25,0.5))';

function ffmpeg(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

for (const [name, reel] of Object.entries(REELS)) {
  const { w, h, beats } = reel;
  const same = new Set(reel.sameShot ?? []);
  // Shots: a slot that goes on from the one before it joins that shot.
  const shots = [];
  beats.forEach((count, i) => {
    const seconds = count * BEAT;
    if (same.has(i) && shots.length > 0) shots[shots.length - 1].seconds += seconds;
    else shots.push({ seconds, index: i });
  });
  const length = beats.reduce((sum, count) => sum + count * BEAT, 0);
  const parts = shots.map(({ seconds, index }, k) => {
    const last = k === shots.length - 1;
    const fade = last && reel.fadeLast ? `,fade=t=out:st=${Math.max(0, seconds - 0.4)}:d=0.4` : '';
    return `${look(w, h, seconds, index)}${fade},setsar=1,format=yuv420p[s${k}]`;
  });
  const graph = `${parts.join(';')};${shots.map((_, k) => `[s${k}]`).join('')}concat=n=${shots.length}:v=1:a=0[v]`;
  const file = join(here, `${name}.mp4`);
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=exprs='${MUSIC}':s=48000:d=${length}`,
    '-filter_complex',
    graph,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-c:a',
    'aac',
    '-b:a',
    '48k',
    '-ac',
    '1',
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    '300k',
    '-maxrate',
    '400k',
    '-g',
    String(FPS / 2),
    '-bf',
    '0',
    '-r',
    String(FPS),
    '-t',
    String(length),
    '-movflags',
    '+faststart',
    file,
  ]);
  // The sheet: each slot's middle frame, tiled six across, as the fake's contact sheet lays it out.
  let start = 0;
  const middles = beats.map((count) => {
    const frames = Math.round(count * BEAT * FPS);
    const middle = start + Math.floor(frames / 2);
    start += frames;
    return middle;
  });
  const columns = Math.min(COLUMNS, beats.length);
  const rows = Math.ceil(beats.length / columns);
  const select = middles.map((n) => `eq(n\\,${n})`).join('+');
  const sheet = join(here, `${name}-sheet.jpg`);
  ffmpeg([
    '-i',
    file,
    '-vf',
    `select='${select}',scale=${reel.tile[0]}:${reel.tile[1]},tile=${columns}x${rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '5',
    '-fps_mode',
    'passthrough',
    sheet,
  ]);
  process.stdout.write(
    `${name}: ${length} s, ${shots.length} shots, ${statSync(file).size} B; sheet ${statSync(sheet).size} B\n`,
  );
}
