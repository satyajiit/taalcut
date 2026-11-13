// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The site's media, made from the owner's footage (WEB1 lane L5; re-encoded for quality by the WEB2 foundation).
 * Re-runnable: pnpm --filter @taalcut/website media.
 *
 *   ~/taalcut-site-footage/reels/*.mp4      saved reels (or $TAALCUT_SITE_FOOTAGE)
 *   ~/taalcut-site-footage/clips/*.mp4      raw clips for the sample camera roll
 *   ~/taalcut-site-footage/templates/<id>.json   Taalcut's breakdown of a reel: { beats: [s], cuts?: [s] }
 *   ~/taalcut-site-footage/exports/<id>.mp4      the video Taalcut made from the roll
 *
 * For each reel, into public/media/reels/<id>/: poster.webp (1080×1920) and poster-540.webp (540×960), WebP at
 * quality 82; reference.mp4, 1080×1920 H.264 at about 7 Mbps and 30 fps, clean on a Retina screen (no audio, no
 * metadata). Its shots (FFmpeg scene cuts) become the roll's clips: a loop each in public/media/roll/, 720×1280 at
 * about 3 Mbps, up to 2 s (a shorter shot loops whole: a loop never crosses a cut), and frames in the roll's sprite
 * atlas (16 columns of 252×448 cells, twice the 126 px a roll thumbnail shows at). Nothing is made larger than its
 * source. Beats come from the template JSON when there is one (timing 'breakdown'); otherwise a grid estimated from
 * the reel's audio and cuts ('estimated'). Writes src/content/media.gen.ts, every file with its size, and every video
 * with its frame size, rate and bitrate. Sources are never copied; every output drops metadata, chapters and GPS.
 *
 * Encoders, GPU first: VideoToolbox H.264 for MP4 (libx264, then OpenH264, in its absence); a WebM (AV1 or VP9) only
 * when this FFmpeg has a software encoder for one. The repo's FFmpeg (the LGPL build) has no WebP encoder, so stills go
 * through cwebp ($TAALCUT_CWEBP or PATH). FFmpeg: $TAALCUT_FFMPEG (the binary), $TAALCUT_FFMPEG_DIR (its folder), else
 * the repo's tools/ffmpeg/dist (in this checkout or the main one when run from a worktree). */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateTiming } from './media-template.mjs';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const OUT = join(site, 'public/media');
const GEN = join(site, 'src/content/media.gen.ts');
const FOOTAGE = process.env.TAALCUT_SITE_FOOTAGE ?? join(homedir(), 'taalcut-site-footage');

/** WEB2 raised the budget for quality (the owner: "the demo clips are low quality"): a 1080p reel at about 7 Mbps is
 * about 12 MB for 14 s, and a 720p loop at about 3 Mbps under 1 MB. WEB3: a 60 fps source (the owner's 4K60 exports)
 * keeps 60 fps at about 10 Mbps, so pans stay smooth, and a second reel: 48 MB in all. WEB4: a third reel, played whole
 * (21 s), and its raw clips in the roll: 80 MB. */
const BUDGET = { total: 80 * 1024 * 1024, loop: 4 * 1024 * 1024, reason: 'WEB4: a third reel (21 s) and its 15 raw clips; 1080p reels at ~7 Mbps (30 fps) or ~10 Mbps (60 fps), 720p loops at ~3 Mbps' };
const REFERENCE = { width: 1080, height: 1920, fps: 30, kbps: 7000, maxSec: 14 };
const smooth = (info) => (info.fps >= 50 ? { ...REFERENCE, fps: 60, kbps: 10000 } : REFERENCE);
const LOOP = { width: 720, height: 1280, fps: 30, kbps: 3000, maxSec: 2 };
const POSTER = [
  { name: 'poster.webp', width: 1080, height: 1920 },
  { name: 'poster-540.webp', width: 540, height: 960 },
];
const POSTER_QUALITY = 82;
const ATLAS = { columns: 16, cell: [252, 448], every: 0.2, quality: 80 };
/** Scene cuts: scdet's score threshold, the gap under which two cuts are one, and the score a cut is sure above. */
const SCENES = { threshold: 10, minGap: 0.15, sure: 17 };
const VIDEO = /\.(mp4|mov|m4v)$/i;

// ---------- tools ----------

function findFfmpeg() {
  const fromDir = process.env.TAALCUT_FFMPEG_DIR ? join(process.env.TAALCUT_FFMPEG_DIR, 'ffmpeg') : undefined;
  const candidates = [process.env.TAALCUT_FFMPEG, fromDir, join(repo, 'tools/ffmpeg/dist/ffmpeg')];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
    candidates.push(join(dirname(common), 'tools/ffmpeg/dist/ffmpeg'));
  } catch {
    // Not a git checkout: only the environment and this checkout.
  }
  const ffmpeg = candidates.find((c) => c && existsSync(c));
  if (!ffmpeg) throw new Error('No FFmpeg: build tools/ffmpeg (docs) or set TAALCUT_FFMPEG to the ffmpeg binary.');
  const ffprobe = join(dirname(ffmpeg), 'ffprobe');
  if (!existsSync(ffprobe)) throw new Error(`No ffprobe beside ${ffmpeg}`);
  return { ffmpeg, ffprobe };
}

function findCwebp() {
  const named = process.env.TAALCUT_CWEBP;
  if (named && existsSync(named)) return named;
  const found = spawnSync('which', ['cwebp'], { encoding: 'utf8' });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  throw new Error('No WebP encoder: this FFmpeg has none, so install cwebp (libwebp) or set TAALCUT_CWEBP.');
}

const { ffmpeg, ffprobe } = findFfmpeg();
const cwebp = findCwebp();

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { maxBuffer: 1024 * 1024 * 512, ...options });
  if (result.status !== 0) throw new Error(`${basename(bin)} ${args.join(' ')}\n${String(result.stderr).slice(-2000)}`);
  return result;
}

const encoders = String(run(ffmpeg, ['-hide_banner', '-encoders']).stdout);
const has = (name) => new RegExp(`^\\s*V\\S*\\s+${name}\\s`, 'm').test(encoders);
const H264 = ['h264_videotoolbox', 'libx264', 'libopenh264'].find(has);
if (!H264) throw new Error('No H.264 encoder in this FFmpeg');
const WEBM = [
  ['libsvtav1', 'video/webm; codecs=av01'],
  ['libaom-av1', 'video/webm; codecs=av01'],
  ['libvpx-vp9', 'video/webm'],
].find(([name]) => has(name));

/** No metadata, chapters, GPS or encoder tags in anything the site serves. */
const STRIP = ['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-metadata:s:v', 'handler_name=', '-metadata:s:v', 'encoder='];
/** The source's colours, said again on the output, so a browser shows BT.709 as BT.709. */
const COLOUR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** A target size that never upscales: the source's own size when it is smaller (same aspect, even numbers). */
function noUpscale(size, source) {
  if (!source.width || (source.width >= size.width && source.height >= size.height)) return size;
  const k = Math.min(source.width / size.width, source.height / size.height);
  const even = (n) => Math.max(2, Math.floor((n * k) / 2) * 2);
  return { ...size, width: even(size.width), height: even(size.height) };
}

function cover(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1`;
}

/** Encodes [start, start + seconds) of a file as silent MP4 (and WebM when there is an encoder for it). */
function encodeVideo(input, start, seconds, wanted, target, source) {
  const size = noUpscale(wanted, source);
  const sources = [];
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start.toFixed(3), '-t', seconds.toFixed(3), '-i', input, '-an', '-sn', '-dn'];
  const vf = `${cover(size.width, size.height)},fps=${size.fps},format=yuv420p`;
  const rate = ['-b:v', `${size.kbps}k`, '-maxrate', `${Math.round(size.kbps * 1.5)}k`, '-bufsize', `${size.kbps * 2}k`];
  const mp4 = `${target}.mp4`;
  const tuned = H264 === 'h264_videotoolbox' ? ['-profile:v', 'high', '-realtime', '0'] : H264 === 'libx264' ? ['-preset', 'slow', '-profile:v', 'high'] : [];
  run(ffmpeg, [...common, '-vf', vf, '-c:v', H264, ...tuned, ...rate, ...COLOUR, '-g', String(size.fps * 2), '-tag:v', 'avc1', '-movflags', '+faststart', ...STRIP, mp4]);
  const shape = { width: size.width, height: size.height, fps: size.fps, kbps: size.kbps };
  if (WEBM) {
    const webm = `${target}.webm`;
    run(ffmpeg, [...common, '-vf', vf, '-c:v', WEBM[0], ...rate, ...STRIP, webm]);
    sources.push({ file: webm, type: WEBM[1], ...shape });
  }
  sources.push({ file: mp4, type: 'video/mp4', ...shape });
  return sources;
}

/**
 * A raster's provenance (impeccable embed-prompt): where it came from, in the sidecar the tool reads for WebP
 * (`<file>.json`). The footage's file name only, never a path on this machine.
 */
function provenance(file, source) {
  const prompt = `origin: frames of the owner's own footage (${source}), cut by scripts/media.mjs with FFmpeg and cwebp; not generated`;
  writeFileSync(`${file}.json`, `${JSON.stringify({ prompt, createdAt: new Date().toISOString() }, null, 2)}\n`);
}

/** One frame as WebP, covering the size (through a PNG: this FFmpeg can't write WebP). */
function still(input, at, width, height, target, quality = 80) {
  const png = `${target}.png`;
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(3), '-i', input, '-frames:v', '1', '-vf', cover(width, height), png]);
  run(cwebp, ['-quiet', '-q', String(quality), '-metadata', 'none', png, '-o', target]);
  rmSync(png);
  provenance(target, basename(input));
}

// ---------- analysis ----------

function probe(file) {
  const json = JSON.parse(String(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).stdout));
  const video = json.streams.find((s) => s.codec_type === 'video');
  const [n, d] = String(video?.avg_frame_rate ?? '30/1').split('/').map(Number);
  const created = json.format.tags?.creation_time ?? video?.tags?.creation_time;
  return {
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    codec: String(video?.codec_name ?? ''),
    duration: Number(json.format.duration),
    fps: d ? n / d : 30,
    hasAudio: json.streams.some((s) => s.codec_type === 'audio'),
    // The day it was shot when the file says so; otherwise the file's own date (flagged in the manifest).
    day: created ? String(created).slice(0, 10) : statSync(file).mtime.toISOString().slice(0, 10),
    dayFrom: created ? 'creation_time' : 'file date',
  };
}

/** FFmpeg's scene detector on a small copy: the cut times and how sure each is. */
function sceneCuts(file, duration) {
  const log = String(run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=270:480,scdet=threshold=${SCENES.threshold}:sc_pass=0`, '-f', 'null', '-']).stderr);
  const cuts = [];
  for (const m of log.matchAll(/lavfi\.scd\.score: ([\d.]+).*?lavfi\.scd\.time: ([\d.]+)/gs)) {
    const at = Number(m[2]);
    const score = Number(m[1]);
    if (at < SCENES.minGap || duration - at < SCENES.minGap) continue;
    const last = cuts.at(-1);
    if (last && at - last.at < SCENES.minGap) {
      if (score > last.score) Object.assign(last, { at, score });
    } else cuts.push({ at, score });
  }
  return cuts.map((c) => ({ at: round(c.at), score: round(c.score, 1) }));
}

/** The audio as an onset curve: half-wave rectified rise in log energy, about 11.6 ms a step. */
function onsetCurve(file) {
  const rate = 11025;
  const hop = 128;
  const raw = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']).stdout;
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const energy = [];
  for (let i = 0; i + 1024 <= pcm.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + 1024; j++) sum += pcm[j] * pcm[j];
    energy.push(Math.log(1e-9 + sum));
  }
  const rise = energy.map((e, i) => (i === 0 ? 0 : Math.max(0, e - energy[i - 1])));
  const mean = rise.reduce((a, b) => a + b, 0) / Math.max(1, rise.length);
  return { curve: rise.map((v) => Math.max(0, v - mean)), step: hop / rate };
}

/**
 * An estimated beat grid: the tempo from the onset curve's autocorrelation (weighted toward 120 music beats a minute,
 * so it doesn't halve or double), the phase that puts the most onsets and cuts on the grid.
 */
function estimateBeats(file, duration, cuts, hasAudio) {
  const { curve, step } = hasAudio ? onsetCurve(file) : { curve: [], step: 0.01 };
  const at = (t) => curve[Math.round(t / step)] ?? 0;
  // The gaps between cuts: an edit on the beat cuts a whole number of beats apart.
  const gaps = cuts.slice(1).map((c, i) => c.at - cuts[i].at);
  let best = { period: 0.5, score: -1 };
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const lag = Math.round(60 / bpm / step);
    let r = 0;
    for (let i = 0; i + lag < curve.length; i++) r += curve[i] * curve[i + lag];
    const cutFit = gaps.filter((g) => near(g, 60 / bpm) < 0.04).length / Math.max(1, gaps.length);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.6) ** 2);
    const score = (r / Math.max(1, curve.length) + cutFit * 0.2 * (curve.length ? 1 : 10)) * prior;
    if (score > best.score) best = { period: 60 / bpm, score };
  }
  const { period } = best;
  let phase = { at: 0, score: -1 };
  for (let p = 0; p < period; p += 0.005) {
    let score = 0;
    for (let t = p; t < duration; t += period) score += at(t);
    score += cuts.filter((c) => Math.abs(((c.at - p) % period + period) % period) < 0.04 || period - (((c.at - p) % period + period) % period) < 0.04).length * 0.5;
    if (score > phase.score) phase = { at: p, score };
  }
  const beats = [];
  for (let t = phase.at; t < duration; t += period) beats.push(round(t));
  return { tempo: round(60 / period, 1), beats };
}

/** How far t is from the nearest multiple of a period, in seconds. */
function near(t, period) {
  const r = t % period;
  return Math.min(r, period - r);
}

function round(n, places = 3) {
  const k = 10 ** places;
  return Math.round(n * k) / k;
}

function slug(stem) {
  return stem.toLowerCase().replace(/[-_ ]?(reel|clip)?[-_ ]?(\d+k|\d{3,4}p)?[-_ ]?(\d+fps|\d+)?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reel';
}

// ---------- build ----------

const files = [];
/** Records a served file (path under public/) with its size; a video also keeps its frame size, rate and bitrate. */
function served(file, video) {
  const bytes = statSync(file).size;
  const src = `/${file.slice(join(site, 'public').length + 1).split('\\').join('/')}`;
  files.push({ src, bytes });
  return video ? { src, type: video.type, bytes, width: video.width, height: video.height, fps: video.fps, kbps: video.kbps } : { src, bytes };
}

// Only what this script makes: public/media also holds files made by hand (the launch film's posters in film/).
for (const dir of ['reels', 'roll']) rmSync(join(OUT, dir), { recursive: true, force: true });
mkdirSync(join(OUT, 'roll'), { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'taalcut-media-'));
const frames = [];
const roll = [];
const reels = [];
/** The footage files the atlas's frames come from, for its provenance. */
const sources = [];

function addFrames(input, clipId, from, to) {
  for (let t = from; t < to - 0.01; t += ATLAS.every) {
    const sprite = frames.length;
    const png = join(scratch, `cell-${String(sprite).padStart(4, '0')}.png`);
    // 8-bit RGB always: a 10-bit cell (HLG phone footage) changes the PNGs' format mid-sequence, and the tile filter
    // then starts over and keeps only the cells after it. HLG is made to show on SDR screens as it is, so no tone map.
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(3), '-i', input, '-frames:v', '1', '-vf', `${cover(...ATLAS.cell)},format=rgb24`, png]);
    frames.push({ sprite, clipId, at: round(t, 2) });
    sources.push(basename(input));
  }
}

function addClip(input, id, reelId, from, to, day, source) {
  const length = Math.min(to - from, LOOP.maxSec);
  const start = to - length; // the end of the shot: past any opening caption, into the move
  const [loop] = encodeVideo(input, start, length, LOOP, join(OUT, 'roll', id), source).slice(-1);
  const first = frames.length;
  addFrames(input, id, start, to);
  const sprite = first + Math.floor((frames.length - first) / 2);
  roll.push({ id, reelId, day, sprite, durationSec: round(to - from, 2), loopStart: round(start, 2), loop: [served(loop.file, loop)] });
}

for (const name of existsSync(join(FOOTAGE, 'reels')) ? readdirSync(join(FOOTAGE, 'reels')).filter((f) => VIDEO.test(f)).sort() : []) {
  const input = join(FOOTAGE, 'reels', name);
  const id = slug(basename(name, extname(name)));
  const info = probe(input);
  const dir = join(OUT, 'reels', id);
  mkdirSync(dir, { recursive: true });
  console.log(`reel ${id}: ${info.duration.toFixed(2)} s`);

  const fromTemplate = templateTiming(FOOTAGE, id);
  const cuts = fromTemplate?.cuts ?? sceneCuts(input, info.duration);
  const timing = fromTemplate ? { tempo: 0, beats: fromTemplate.beats } : estimateBeats(input, info.duration, cuts, info.hasAudio);
  if (fromTemplate) {
    const gaps = timing.beats.slice(1).map((b, i) => b - timing.beats[i]).sort((a, b) => a - b);
    timing.tempo = round(60 / (gaps[Math.floor(gaps.length / 2)] || 0.5), 1);
  }
  const bounds = [0, ...cuts.map((c) => c.at), round(info.duration)];
  const shots = bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1], cutScore: i === 0 ? null : cuts[i - 1].score }));

  const lastShot = shots.at(-1);
  const coverAt = (lastShot.start + lastShot.end) / 2;
  const poster = POSTER.map((p) => {
    const file = join(dir, p.name);
    const size = noUpscale(p, info);
    still(input, coverAt, size.width, size.height, file, POSTER_QUALITY);
    return { ...served(file), width: size.width, height: size.height };
  });
  const length = Math.min(info.duration, fromTemplate?.seconds ?? REFERENCE.maxSec);
  const reference = encodeVideo(input, 0, length, smooth(info), join(dir, 'reference'), info).map((s) => served(s.file, s));
  const exported = join(FOOTAGE, 'exports', `${id}.mp4`);
  const exportInfo = existsSync(exported) ? probe(exported) : null;
  const made = exportInfo ? encodeVideo(exported, 0, Math.min(exportInfo.duration, REFERENCE.maxSec), smooth(exportInfo), join(dir, 'made'), exportInfo).map((s) => served(s.file, s)) : [];

  const raw = fromTemplate?.roll;
  if (raw && raw.length !== shots.length) throw new Error(`templates/${id}.json: ${raw.length} roll sources for ${shots.length} shots`);
  shots.forEach((shot, i) => {
    const clipId = `${id}-${String(i + 1).padStart(2, '0')}`;
    const src = raw?.[i];
    if (!src) return addClip(input, clipId, id, shot.start, shot.end, info.day, info);
    const srcInfo = probe(src.file);
    return addClip(src.file, clipId, id, src.start, Math.min(src.end, srcInfo.duration), srcInfo.day, srcInfo);
  });
  reels.push({
    id,
    source: name,
    sourceSize: { width: info.width, height: info.height, fps: round(info.fps, 2), codec: info.codec },
    durationSec: round(length, 2),
    fps: round(info.fps, 2),
    day: info.day,
    dayFrom: info.dayFrom,
    timing: fromTemplate ? 'breakdown' : 'estimated',
    tempo: timing.tempo,
    beats: timing.beats.filter((b) => b < length),
    shots: shots.filter((s) => s.start < length).map((s) => ({ ...s, end: Math.min(s.end, round(length)) })),
    sureCutScore: SCENES.sure,
    poster,
    reference,
    made,
  });
}

for (const name of existsSync(join(FOOTAGE, 'clips')) ? readdirSync(join(FOOTAGE, 'clips')).filter((f) => VIDEO.test(f)).sort() : []) {
  const input = join(FOOTAGE, 'clips', name);
  const info = probe(input);
  console.log(`clip ${name}: ${info.duration.toFixed(2)} s`);
  addClip(input, `clip-${slug(basename(name, extname(name)))}`, null, 0, info.duration, info.day, info);
}

let atlas = null;
if (frames.length > 0) {
  const rows = Math.ceil(frames.length / ATLAS.columns);
  const png = join(scratch, 'atlas.png');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-i', join(scratch, 'cell-%04d.png'), '-vf', `tile=${ATLAS.columns}x${rows}`, '-frames:v', '1', png]);
  const file = join(OUT, 'roll', 'atlas.webp');
  run(cwebp, ['-quiet', '-q', String(ATLAS.quality), '-metadata', 'none', png, '-o', file]);
  provenance(file, [...new Set(sources)].join(', '));
  atlas = { ...served(file), columns: ATLAS.columns, rows, cell: ATLAS.cell };
}
rmSync(scratch, { recursive: true, force: true });

const total = files.reduce((sum, f) => sum + f.bytes, 0);
const overLoop = roll.flatMap((c) => c.loop).filter((l) => l.bytes > BUDGET.loop);
if (total > BUDGET.total || overLoop.length > 0) {
  throw new Error(`Over budget: ${(total / 1048576).toFixed(2)} MB in all (≤ ${BUDGET.total / 1048576}), loops over ${BUDGET.loop / 1048576} MB: ${overLoop.map((l) => l.src).join(', ') || 'none'}`);
}

const manifest = {
  encoders: { mp4: H264, webm: WEBM?.[0] ?? null, image: 'cwebp' },
  budget: BUDGET,
  totalBytes: total,
  reels,
  roll: { atlas, clips: roll, frames },
};
writeFileSync(
  GEN,
  `// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors\n` +
    `// Generated by scripts/media.mjs from the owner's footage. Don't edit: run \`pnpm --filter @taalcut/website media\`.\n` +
    `import type { MediaManifest } from './reels';\n\n` +
    `export const MEDIA: MediaManifest = ${JSON.stringify(manifest, null, 2)};\n`,
);
console.log(`${reels.length} reel(s), ${roll.length} clip(s), ${frames.length} atlas cells, ${(total / 1048576).toFixed(2)} MB (${H264}${WEBM ? ` + ${WEBM[0]}` : ''}, cwebp)`);
