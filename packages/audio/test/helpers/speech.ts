// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Speech and beds for audio's tests: macOS `say` through the bundled FFmpeg, and FFmpeg-made pads. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runFfmpeg, runProcess, type MediaContext } from '@taalcut/media';

/** macOS's `say`, which the synthetic speech fixtures are spoken with; suites that need it skip without it. */
export const HAS_SAY = existsSync('/usr/bin/say');

export async function sayToWav(
  media: MediaContext,
  dir: string,
  name: string,
  text: string,
  options: {
    readonly voice?: string;
    readonly sampleRate?: number;
    readonly leadMs?: number;
    readonly rate?: number;
  } = {},
): Promise<string> {
  const aiff = join(dir, `${name}.aiff`);
  const rate = options.rate ? ['-r', String(options.rate)] : [];
  const said = await runProcess('say', [
    '-v',
    options.voice ?? 'Eddy (English (US))',
    ...rate,
    '-o',
    aiff,
    text,
  ]);
  if (!said.ok || said.value.exitCode !== 0) throw new Error(`say failed for ${name}`);
  const wav = join(dir, `${name}.wav`);
  const lead = options.leadMs ? ['-af', `adelay=${options.leadMs}|${options.leadMs}`] : [];
  const converted = await runFfmpeg(media, [
    '-nostdin',
    '-y',
    '-i',
    aiff,
    ...lead,
    '-ac',
    '1',
    '-ar',
    String(options.sampleRate ?? 48_000),
    '-c:a',
    'pcm_s16le',
    wav,
  ]);
  if (!converted.ok) throw new Error(`ffmpeg failed for ${name}: ${converted.error.detail ?? ''}`);
  return wav;
}

/** A loud sustained chord, `seconds` long, 48 kHz stereo WAV: a music bed that buries speech. */
export async function chordPad(
  media: MediaContext,
  dir: string,
  seconds: number,
  amplitude = 0.25,
): Promise<string> {
  const out = join(dir, 'pad.wav');
  const expr = `${amplitude}*sin(2*PI*220*t)+${amplitude * 0.8}*sin(2*PI*277.2*t)+${amplitude * 0.8}*sin(2*PI*329.6*t)+${amplitude * 0.5}*sin(2*PI*1760*t)`;
  const made = await runFfmpeg(media, [
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${expr}|${expr}:s=48000:d=${seconds}`,
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  if (!made.ok) throw new Error(`pad failed: ${made.error.detail ?? ''}`);
  return out;
}
