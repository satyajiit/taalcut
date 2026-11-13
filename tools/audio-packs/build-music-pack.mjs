#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the `music-pack` component (packages/audio SPEC P3.5) from music-tracks.json: each track's file copied
 * byte for byte (no re-encode), its own licence text read and kept beside it, its length probed, and
 * `catalogue.json` written in the shape of packages/audio/src/music/library-catalogue.ts; then a reproducible
 * tar.zst, printing sha256, size and extractedSize for the component manifest.
 *
 *   node tools/audio-packs/build-music-pack.mjs --from <folder with the downloaded files> [--out <dir>]
 *        [--ffprobe <path>] [--tracks <json>]
 *
 * The product owner picks the tracks. Until then the list is empty and this refuses to build: an empty pack is
 * worth nothing to ship, and the app treats a missing pack as "no library" (audio.music_library_empty). Every
 * track must be CC0-1.0 on its own page, and its licence file must say so; anything else is refused. Beats are
 * not tracked here: the timeline tracks a track's beats on first use and caches them on the asset.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { writeArchive } from './pack-archive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXTENSIONS = ['.opus', '.ogg', '.mp3', '.flac', '.wav'];
const CC0_MARKS = [/publicdomain\/zero\/1\.0/i, /\bCC0\b/, /Creative Commons Zero/i];

function fail(message) {
  console.error(`build-music-pack: ${message}`);
  process.exit(1);
}

function checkTrack(track, from) {
  const where = `track '${track.id}'`;
  if (!/^[a-z0-9-]{1,64}$/.test(track.id ?? '')) fail(`${where}: id must be a-z, 0-9 and dashes`);
  if (typeof track.title !== 'string' || track.title.length === 0) fail(`${where}: no title`);
  if (!EXTENSIONS.includes(extname(track.file ?? '').toLowerCase()))
    fail(`${where}: file must be ${EXTENSIONS.join(', ')}`);
  if (!(track.bpm >= 40 && track.bpm <= 240)) fail(`${where}: bpm must be 40–240`);
  if (!Array.isArray(track.moods) || track.moods.some((m) => !/^[a-z][a-z-]{0,31}$/.test(m)))
    fail(`${where}: moods must be lowercase words`);
  for (const key of ['sourceUrl', 'dedicationUrl'])
    if (!/^https:\/\//.test(track[key] ?? '')) fail(`${where}: ${key} must be https`);
  for (const key of ['file', 'licenceFile'])
    if (!existsSync(join(from, track[key] ?? ''))) fail(`${where}: ${key} ${track[key]} is not in ${from}`);
  const licence = readFileSync(join(from, track.licenceFile), 'utf8');
  if (!CC0_MARKS.some((mark) => mark.test(licence))) fail(`${where}: its licence file does not say CC0`);
}

function secondsOf(ffprobe, path) {
  const out = execFileSync(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path,
  ]);
  const seconds = Number(out.toString().trim());
  if (!(seconds > 0)) fail(`${path}: ffprobe found no duration`);
  return Math.round(seconds * 1000) / 1000;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      out: { type: 'string' },
      ffprobe: { type: 'string' },
      tracks: { type: 'string' },
    },
  });
  const list = JSON.parse(readFileSync(values.tracks ?? join(HERE, 'music-tracks.json'), 'utf8'));
  if (!Array.isArray(list.tracks) || list.tracks.length === 0)
    fail(
      'music-tracks.json lists no tracks: the product owner picks the CC0 tracks first (packages/audio SPEC P3.5). Nothing built.',
    );
  if (!values.from) fail('--from <folder with the downloaded track and licence files> is required');
  const from = resolve(values.from);
  const ids = new Set();
  for (const track of list.tracks) {
    checkTrack(track, from);
    if (ids.has(track.id)) fail(`track '${track.id}' is listed twice`);
    ids.add(track.id);
  }
  const ffprobe = values.ffprobe ?? join(REPO, 'tools', 'ffmpeg', 'dist', 'ffprobe');
  const out = resolve(values.out ?? join(REPO, 'packages', 'audio', '.cache', 'packs', 'music-pack'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = [];
  const tracks = list.tracks.map((track) => {
    const file = `${track.id}${extname(track.file).toLowerCase()}`;
    copyFileSync(join(from, track.file), join(out, file));
    copyFileSync(join(from, track.licenceFile), join(out, `${track.id}.licence.txt`));
    files.push(file, `${track.id}.licence.txt`);
    return {
      id: track.id,
      title: track.title,
      file,
      bpm: track.bpm,
      seconds: secondsOf(ffprobe, join(out, file)),
      moods: track.moods,
      licence: 'CC0-1.0',
      sourceUrl: track.sourceUrl,
      dedicationUrl: track.dedicationUrl,
      ...(track.attribution ? { attribution: track.attribution } : {}),
    };
  });
  const catalogue = { version: 1, pack: 'music-pack', packVersion: list.packVersion, tracks };
  writeFileSync(join(out, 'catalogue.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
  files.push('catalogue.json');
  const archive = join(dirname(out), `music-pack-${list.packVersion}.tar.zst`);
  console.log(
    JSON.stringify(
      {
        version: list.packVersion,
        out,
        tracks: tracks.length,
        archive,
        ...writeArchive(out, files, archive),
      },
      null,
      2,
    ),
  );
}
