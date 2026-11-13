// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Makes the fake backend's sample media (UX2, the clip page): small H.264 proxies with sound, each a few "shots" of
 * generated footage cut hard, a JPEG of each shot and of the clip, the filmstrip sprite media.filmstrip would make
 * from the proxy (recipe 2, round 2), and `sample-media.gen.ts` beside the fake library with their shots, the
 * sprite's grid and frames and the sound's peaks, so the fake's clips match their files. Uses the repo's FFmpeg
 * (tools/ffmpeg/dist). With `--originals <dir>` it also writes full-size originals to import into the app by hand:
 * a 1080×1920 HEVC phone clip, a 1920×1080 H.264 one, a rotated one, one without sound and one small enough to be
 * its own proxy.
 *
 *   node apps/renderer/e2e/sample-media/make.mjs [--originals <dir>]
 *   node apps/renderer/e2e/sample-media/make.mjs --strips   (the sprites and the generated file only, from the
 *                                                           proxies already here: they stay byte for byte)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const FFMPEG = join(repo, 'tools/ffmpeg/dist/ffmpeg');
const OUT = here;
const GENERATED = resolve(here, '../../src/backend/fake/library/sample-media.gen.ts');
const FPS = 30;
const PEAKS_PER_SECOND = 50;

/** A look per shot: a source filter chain that fills `w`×`h` for `seconds`. */
const LOOKS = {
  sky: (w, h, s) =>
    `gradients=s=${w}x${h}:r=${FPS}:d=${s}:c0=0xff9a3c:c1=0xd9486a:c2=0x4a2a78:nb_colors=3:speed=0.015:type=linear,vignette=PI/5`,
  sea: (w, h, s) =>
    `perlin=s=${w}x${h}:r=${FPS}:octaves=5:persistence=0.55:xscale=0.5:yscale=1.6:tscale=0.35:random_mode=seed:seed=7,trim=duration=${s},format=rgb24,colorchannelmixer=rr=0.18:gg=0.58:bb=0.78:gb=0.08,curves=preset=increase_contrast,vignette=PI/5`,
  city: (w, h, s) =>
    `perlin=s=${w}x${h}:r=${FPS}:octaves=3:persistence=0.5:xscale=3:yscale=3:tscale=0.7:random_mode=seed:seed=3,trim=duration=${s},format=rgb24,curves=preset=strong_contrast,colorchannelmixer=rr=0.98:rg=0.1:gg=0.42:bb=0.72:br=0.2,curves=preset=darker,vignette=PI/4`,
  dusk: (w, h, s) =>
    `gradients=s=${w}x${h}:r=${FPS}:d=${s}:c0=0x231a3d:c1=0xe0703a:c2=0xffd27a:nb_colors=3:speed=0.03:type=radial,vignette=PI/4`,
  moss: (w, h, s) =>
    `perlin=s=${w}x${h}:r=${FPS}:octaves=4:persistence=0.6:xscale=1.2:yscale=1.2:tscale=0.5:random_mode=seed:seed=21,trim=duration=${s},format=rgb24,colorchannelmixer=rr=0.34:rg=0.1:gg=0.62:bb=0.28,curves=preset=increase_contrast,vignette=PI/5`,
  dunes: (w, h, s) =>
    `gradients=s=${w}x${h}:r=${FPS}:d=${s}:c0=0xf2b26b:c1=0xa8553a:c2=0x4e2622:nb_colors=3:speed=0.008:type=linear:x0=0:y0=${Math.round(h * 0.2)}:x1=${w}:y1=${h},vignette=PI/5`,
};

/** Sound: a kick on every half second (120 bpm), a soft pad, a tick off the beat; quiet in the given stretches. */
const MUSIC =
  '0.75*sin(2*PI*52*t)*exp(-13*mod(t,0.5))+0.16*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.4*t))+0.08*sin(2*PI*3520*t)*exp(-60*mod(t+0.25,0.5))';

/** The fake's sample clips: name → frame size, shots ([look, seconds]) and whether it has sound. */
const SAMPLES = {
  portrait: { w: 540, h: 960, sound: true, shots: [['sky', 1.5], ['sea', 1.7], ['city', 1.4], ['dusk', 1.5]] },
  landscape: { w: 960, h: 540, sound: true, shots: [['sea', 2.6], ['dunes', 2.8], ['sky', 2.6]] },
  rotated: { w: 540, h: 960, sound: true, shots: [['moss', 2.2], ['dusk', 2.8]] },
  silent: { w: 540, h: 960, sound: false, shots: [['dunes', 2.4], ['moss', 2.6]] },
};

function ffmpeg(args, options = {}) {
  return execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

/** The shots cut hard into one stream, labelled [v]. */
function picture(sample, w = sample.w, h = sample.h) {
  const parts = sample.shots.map(([look, seconds], i) => `${LOOKS[look](w, h, seconds)},setsar=1,format=yuv420p[s${i}]`);
  const inputs = sample.shots.map((_, i) => `[s${i}]`).join('');
  return `${parts.join(';')};${inputs}concat=n=${sample.shots.length}:v=1:a=0[v]`;
}

function seconds(sample) {
  return sample.shots.reduce((sum, [, s]) => sum + s, 0);
}

/** The proxy the fake plays: H.264 with a half-second GOP, as media.proxy writes, and AAC sound. */
function makeProxy(name, sample) {
  const length = seconds(sample);
  const file = join(OUT, `${name}.mp4`);
  const audio = sample.sound
    ? ['-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=${length}`]
    : [];
  ffmpeg([
    ...audio,
    '-filter_complex', picture(sample),
    '-map', '[v]',
    ...(sample.sound ? ['-map', '0:a', '-c:a', 'aac', '-b:a', '64k'] : []),
    '-c:v', 'h264_videotoolbox', '-b:v', '700k', '-maxrate', '900k', '-g', String(FPS / 2), '-bf', '0',
    '-profile:v', 'high', '-r', String(FPS), '-t', String(length), '-movflags', '+faststart',
    file,
  ]);
  return file;
}

/** A JPEG of each shot's middle and one of the clip (its first shot), as the library's thumbnails. */
function makeStills(name, sample, file) {
  const tall = sample.h > sample.w;
  const scale = tall ? 'scale=180:320' : 'scale=320:180';
  let at = 0;
  sample.shots.forEach(([, s], i) => {
    ffmpeg(['-ss', String(at + s / 2), '-i', file, '-frames:v', '1', '-vf', scale, '-q:v', '5', join(OUT, `${name}-${i + 1}.jpg`)]);
    at += s;
  });
  ffmpeg(['-ss', '0.4', '-i', file, '-frames:v', '1', '-vf', scale, '-q:v', '5', join(OUT, `${name}.jpg`)]);
}

const even = (n) => {
  const v = Math.max(2, Math.floor(n));
  return v - (v % 2);
};

/**
 * The filmstrip's layout as media makes it (packages/media/src/previews/filmstrip.ts, recipe 2): one frame per slot
 * of the widest strip (1,920 px of slots 56 px high, at least 24 px wide), at most 80 and never more than the clip
 * has, 192 px high, evenly from the first frame to the last, in a near-square grid.
 */
function filmstripLayout(w, h, frames) {
  const aspect = w / h;
  const count = Math.max(1, Math.min(frames, 80, Math.ceil(1920 / Math.max(24, 56 * aspect))));
  const tileHeight = Math.min(192, even(h));
  const tileWidth = even(Math.min(w, aspect * tileHeight));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const picks = Array.from({ length: count }, (_, i) =>
    count === 1 ? 0 : Math.round((i * (frames - 1)) / (count - 1)),
  );
  return { columns, rows, tileWidth, tileHeight, frames: picks };
}

/** The sprite, from the proxy's exact frames (the fake's proxies are short), as `<name>-strip.jpg`. */
function makeFilmstrip(name, sample, file, frames) {
  const layout = filmstripLayout(sample.w, sample.h, frames);
  const select = layout.frames.map((n) => `eq(n,${n})`).join('+');
  const out = join(OUT, `${name}-strip.jpg`);
  ffmpeg([
    '-i', file,
    '-vf', `select='${select}',scale=${layout.tileWidth}:${layout.tileHeight},tile=${layout.columns}x${layout.rows}`,
    '-fps_mode', 'passthrough', '-frames:v', '1', '-q:v', '3', '-update', '1', out,
  ]);
  return { ...layout, bytes: statSync(out).size };
}

/** The loudest sample of each 1/50 s, from 0 to 1, as the library's waveform summary would give it. */
function peaksOf(file) {
  const pcm = ffmpeg(['-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-']);
  const per = 8000 / PEAKS_PER_SECOND;
  const peaks = [];
  for (let start = 0; start + 1 < pcm.length; start += per * 2) {
    let loudest = 0;
    for (let i = start; i < Math.min(pcm.length - 1, start + per * 2); i += 2)
      loudest = Math.max(loudest, Math.abs(pcm.readInt16LE(i)) / 32768);
    peaks.push(Math.round(Math.min(1, loudest) * 1000) / 1000);
  }
  return peaks;
}

function writeGenerated(entries) {
  const lines = [
    '// SPDX-License-Identifier: AGPL-3.0-or-later',
    '// Copyright (C) 2026 Taalcut contributors',
    '/* eslint-disable lingui/no-unlocalized-strings -- generated sample-media names: data, never shown */',
    '',
    '/** Generated by apps/renderer/e2e/sample-media/make.mjs: the fake sample clips\' files. Do not edit. */',
    'export interface SampleMedia {',
    '  readonly width: number;',
    '  readonly height: number;',
    '  /** Frames at 30 fps. */',
    '  readonly frames: number;',
    '  /** Each shot\'s first frame and frame count. */',
    '  readonly shots: readonly (readonly [number, number])[];',
    '  readonly bytes: number;',
    '  /** 50 a second, 0 to 1; null without sound. */',
    '  readonly peaks: readonly number[] | null;',
    '  /** The filmstrip sprite (`<name>-strip.jpg`): its grid, cell size and each cell\'s frame. */',
    '  readonly strip: {',
    '    readonly columns: number;',
    '    readonly rows: number;',
    '    readonly tileWidth: number;',
    '    readonly tileHeight: number;',
    '    readonly frames: readonly number[];',
    '    readonly bytes: number;',
    '  };',
    '}',
    '',
    'export const SAMPLE_MEDIA = {',
  ];
  for (const [name, entry] of Object.entries(entries)) {
    lines.push(`  ${name}: {`);
    lines.push(`    width: ${entry.width},`);
    lines.push(`    height: ${entry.height},`);
    lines.push(`    frames: ${entry.frames},`);
    lines.push(`    shots: ${JSON.stringify(entry.shots)},`);
    lines.push(`    bytes: ${entry.bytes},`);
    lines.push(`    peaks: ${entry.peaks ? `[${entry.peaks.join(', ')}]` : 'null'},`);
    const { frames, ...grid } = entry.strip;
    lines.push(`    strip: { ${Object.entries(grid).map(([k, v]) => `${k}: ${v}`).join(', ')}, frames: [${frames.join(', ')}] },`);
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<string, SampleMedia>;', '', 'export type SampleName = keyof typeof SAMPLE_MEDIA;', '');
  writeFileSync(GENERATED, lines.join('\n'));
}

/** Full-size originals for the app (not committed): what a phone, a drone and an Android camera write. */
function makeOriginals(dir) {
  mkdirSync(dir, { recursive: true });
  const portrait = SAMPLES.portrait;
  const length = seconds(portrait);
  const sound = ['-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=${length}`];
  ffmpeg([...sound, '-filter_complex', picture(portrait, 1080, 1920), '-map', '[v]', '-map', '0:a', '-c:a', 'aac', '-b:a', '128k',
    '-c:v', 'hevc_videotoolbox', '-tag:v', 'hvc1', '-b:v', '12M', '-r', String(FPS), '-t', String(length), join(dir, 'IMG_4471.MOV')]);
  const landscape = SAMPLES.landscape;
  const wide = seconds(landscape);
  ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=${wide}`, '-filter_complex', picture(landscape, 1920, 1080), '-map', '[v]', '-map', '0:a',
    '-c:a', 'aac', '-b:a', '128k', '-c:v', 'h264_videotoolbox', '-b:v', '16M', '-r', String(FPS), '-t', String(wide), join(dir, 'DJI_0412.MP4')]);
  // Recorded on its side: a landscape stream the player turns upright (display matrix, 90° counter-clockwise).
  const side = join(dir, 'side.mp4');
  ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=5`, '-filter_complex', picture(SAMPLES.rotated, 1920, 1080), '-map', '[v]', '-map', '0:a',
    '-c:a', 'aac', '-c:v', 'h264_videotoolbox', '-b:v', '10M', '-r', String(FPS), '-t', '5', side]);
  ffmpeg(['-display_rotation', '90', '-i', side, '-c', 'copy', join(dir, 'VID_20260412_rotated.mp4')]);
  ffmpeg(['-filter_complex', picture(SAMPLES.silent, 1080, 1920), '-map', '[v]', '-c:v', 'h264_videotoolbox', '-b:v', '8M',
    '-r', String(FPS), '-t', '5', join(dir, 'IMG_4502_silent.MOV')]);
  // Small and plain enough that media.proxy keeps it as its own proxy (under the 0.4 Mb/s floor of its budget).
  ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=6`, '-filter_complex', picture(SAMPLES.portrait, 720, 1280), '-map', '[v]', '-map', '0:a',
    '-c:a', 'aac', '-b:a', '96k', '-c:v', 'h264_videotoolbox', '-b:v', '1200k', '-r', String(FPS), '-t', '6', '-movflags', '+faststart',
    join(dir, 'WA_small_own_proxy.mp4')]);
}

const entries = {};
const stripsOnly = process.argv.includes('--strips');
for (const [name, sample] of Object.entries(SAMPLES)) {
  const file = stripsOnly ? join(OUT, `${name}.mp4`) : makeProxy(name, sample);
  if (!stripsOnly) makeStills(name, sample, file);
  let start = 0;
  const shots = sample.shots.map(([, s]) => {
    const frames = Math.round(s * FPS);
    const shot = [start, frames];
    start += frames;
    return shot;
  });
  entries[name] = {
    width: sample.w,
    height: sample.h,
    frames: start,
    shots,
    bytes: statSync(file).size,
    peaks: sample.sound ? peaksOf(file) : null,
    strip: makeFilmstrip(name, sample, file, start),
  };
  process.stdout.write(`${name}: ${(statSync(file).size / 1024).toFixed(0)} KB, ${start} frames\n`);
}
writeGenerated(entries);

const at = process.argv.indexOf('--originals');
if (at > 0 && process.argv[at + 1]) {
  makeOriginals(resolve(process.argv[at + 1]));
  process.stdout.write(`originals in ${process.argv[at + 1]}\n`);
}
