#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the renderer's interface sounds (apps/renderer/src/features/sounds/assets) from interface-sounds.json:
 * WAV sources rendered locally with Tone.Offline by tools/audio-packs/generate-interface-sounds.mjs.
 * Each is cut to its length with a quarter-sine fade, high-passed at 100 Hz (nothing a laptop speaker plays, and
 * it would only eat headroom), turned down to the target loudness or until its true peak meets the ceiling,
 * whichever is quieter, and encoded with the bundled LGPL FFmpeg's native AAC into a bit-exact .m4a.
 *
 *   pnpm --filter @taalcut/renderer sounds:build
 *
 * Loudness is BS.1770 integrated loudness of the sound with 400 ms of silence after it (a short sound then fills
 * whole 400 ms blocks), the true peak 4× oversampled; both measured on the encoded file.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SPEC = JSON.parse(readFileSync(join(HERE, 'interface-sounds.json'), 'utf8'));
const RATE = SPEC.authoring.sampleRate;
/** AAC-LC per channel: transparent for a short chime, and a few kilobytes a sound. */
const KBPS_PER_CHANNEL = 96;

function run(ffmpeg, args) {
  return execFileSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file, 400 ms of silence appended. */
export function loudnessOf(ffmpeg, path) {
  const { stderr: log, status } = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-i',
      path,
      '-af',
      'apad=pad_dur=0.4,ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (status !== 0) throw new Error(`${path}: ffmpeg could not measure it`);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const truePeak = Number(/Peak:\s+(-?[\d.inf]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak))
    throw new Error(`${path}: no loudness summary`);
  return { integrated, truePeak };
}

function channelsOf(ffmpeg, path) {
  const probe = execFileSync(ffmpeg.replace(/ffmpeg$/, 'ffprobe'), [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=channels,duration',
    '-of',
    'json',
    path,
  ]);
  const stream = JSON.parse(probe.toString('utf8')).streams[0];
  return { channels: Number(stream.channels), seconds: Number(stream.duration) };
}

/** The authoring harness supplies one locally synthesised WAV per manifest entry. */
function sourceFile(sound, generated) {
  if (!generated) throw new Error('Run pnpm --filter @taalcut/renderer sounds:build to render Tone sources');
  return join(generated, `${sound.name}.wav`);
}

function encode(ffmpeg, input, gainDb, channels, out) {
  run(ffmpeg, [
    '-i',
    input,
    '-af',
    `volume=${gainDb.toFixed(2)}dB`,
    '-ar',
    String(RATE),
    '-c:a',
    'aac',
    '-b:a',
    `${KBPS_PER_CHANNEL * channels}k`,
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-movflags',
    '+faststart',
    out,
  ]);
}

export function buildInterfaceSounds({ ffmpeg, generated, out }) {
  const { actionLufs, milestoneLufs, truePeakDbtp } = SPEC.loudness;
  const scratch = mkdtempSync(join(tmpdir(), 'taalcut-interface-sounds-'));
  mkdirSync(out, { recursive: true });
  try {
    return SPEC.sounds.map((sound) => {
      const integratedLufs = sound.kind === 'action' ? actionLufs : milestoneLufs;
      const seconds = sound.lengthMs / 1000;
      const fade = sound.fadeMs / 1000;
      const cut = join(scratch, `${sound.name}-cut.wav`);
      run(ffmpeg, [
        '-i',
        sourceFile(sound, generated),
        '-af',
        `aresample=${RATE},atrim=end=${seconds},highpass=f=100,afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}:curve=qsin`,
        '-c:a',
        'pcm_f32le',
        cut,
      ]);
      const before = loudnessOf(ffmpeg, cut);
      const { channels } = channelsOf(ffmpeg, cut);
      const target = join(out, sound.file);
      let gain = Math.min(integratedLufs - before.integrated, truePeakDbtp - before.truePeak);
      encode(ffmpeg, cut, gain, channels, target);
      let after = loudnessOf(ffmpeg, target);
      // AAC can overshoot the peak it was given by a fraction of a dB: turn it down by that much and encode again.
      for (let tries = 0; after.truePeak > truePeakDbtp && tries < 3; tries++) {
        gain -= after.truePeak - truePeakDbtp + 0.1;
        encode(ffmpeg, cut, gain, channels, target);
        after = loudnessOf(ffmpeg, target);
      }
      if (after.truePeak > truePeakDbtp) throw new Error(`${sound.name}: true peak exceeds the ceiling`);
      const { seconds: length } = channelsOf(ffmpeg, target);
      if (Math.abs(length - seconds) > 0.025) throw new Error(`${sound.name}: unexpected encoded length`);
      return {
        name: sound.name,
        file: sound.file,
        source: `Tone.Offline ${SPEC.authoring.version}`,
        ms: Math.round(length * 1000),
        channels,
        lufs: after.integrated,
        dbtp: after.truePeak,
        bytes: statSync(target).size,
        sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
      };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, ffmpeg: { type: 'string' }, generated: { type: 'string' } },
  });
  const ffmpeg =
    values.ffmpeg ?? process.env.TAALCUT_FFMPEG ?? join(REPO, 'tools', 'ffmpeg', 'dist', 'ffmpeg');
  const out = resolve(values.out ?? join(REPO, 'apps', 'renderer', 'src', 'features', 'sounds', 'assets'));
  const rows = buildInterfaceSounds({
    ffmpeg,
    generated: values.generated && resolve(values.generated),
    out,
  });
  console.table(rows);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
