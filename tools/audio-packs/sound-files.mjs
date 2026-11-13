// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One synthesised sound, start to finish, with the bundled FFmpeg: render the recipe's filter graph to 48 kHz
 * mono float, normalise its peak to −1 dBFS, quantise to 16 bits, encode FLAC bit-exactly (no encoder tag, no
 * metadata), then measure the file the pack ships the way audio's `measureSoundShape` measures a generated one:
 * length, the largest absolute sample's position, and the momentary-max loudness (ebur128 M, 400 ms of silence
 * appended so a short sound gets whole windows). Every step is deterministic, so a rebuild gives the same bytes.
 */
import { execFileSync } from 'node:child_process';

export const RATE = 48_000;
/** −1 dBFS. */
const TARGET_PEAK = 10 ** (-1 / 20);
const QUIET_LUFS = -70;

function ffmpeg(binary, args, input) {
  return execFileSync(binary, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    input,
    maxBuffer: 1 << 28,
  });
}

function floats(buffer) {
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.length / 4);
}

/** The recipe's graph (output pad `[out]`) as mono float samples. */
export function renderGraph(binary, graph) {
  const raw = ffmpeg(binary, [
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-f',
    'f32le',
    '-',
  ]);
  return floats(raw);
}

export function peakOf(samples) {
  let peak = 0;
  let at = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i]);
    if (value > peak) {
      peak = value;
      at = i;
    }
  }
  return { peak, at };
}

/** Peak-normalised 16-bit little-endian PCM. */
export function normalisedPcm16(samples) {
  const { peak } = peakOf(samples);
  if (peak === 0) throw new Error('the recipe rendered silence');
  const gain = TARGET_PEAK / peak;
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain * 32767)));
    out.writeInt16LE(value, i * 2);
  }
  return out;
}

/** 16-bit PCM → a FLAC file with no metadata and FFmpeg's bit-exact flags. */
export function writeFlac(binary, pcm16, path) {
  ffmpeg(
    binary,
    [
      '-y',
      '-f',
      's16le',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-i',
      '-',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      '-c:a',
      'flac',
      '-compression_level',
      '8',
      path,
    ],
    pcm16,
  );
}

/**
 * Length, peak position and momentary-max loudness of a pack file, as the catalogue records them. With
 * `attackMs`, the peak is the loudest sample inside the first `attackMs` (an impact's echo can sum louder later,
 * but the attack is what is heard as the hit).
 */
export function measureFile(binary, path, { attackMs } = {}) {
  const samples = floats(ffmpeg(binary, ['-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-']));
  const { at } = peakOf(attackMs ? samples.subarray(0, Math.round((attackMs * RATE) / 1000)) : samples);
  const log = ffmpeg(binary, [
    '-i',
    path,
    '-af',
    'apad=pad_dur=0.4,ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-',
    '-f',
    'null',
    '-',
  ]).toString('utf8');
  let loudest = -Infinity;
  for (const line of log.split('\n')) {
    const m = /^lavfi\.r128\.M=(\S+)/.exec(line);
    const value = m ? Number(m[1]) : NaN;
    if (Number.isFinite(value)) loudest = Math.max(loudest, value);
  }
  const loudnessLufs = Math.round(Math.max(QUIET_LUFS, Math.min(0, loudest)) * 10) / 10;
  return {
    durationMs: Math.max(1, Math.floor((samples.length * 1000) / RATE)),
    peakMs: Math.floor((at * 1000) / RATE),
    loudnessLufs,
  };
}
