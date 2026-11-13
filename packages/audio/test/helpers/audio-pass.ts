// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-ins for the audio pass: a normalisation plan for an audio file, and an FFmpeg runner that writes the
 * speech WAV and prints the log lines the pass reads (no FFmpeg needed), or that waits to be cancelled.
 */
import { writeFile } from 'node:fs/promises';
import { err, ok, RationalTime, FrameRate } from '@taalcut/core';
import {
  MediaCancelled,
  type MediaContext,
  type NormalisationPlan,
  type ProcessRunner,
} from '@taalcut/media';

const MS = FrameRate.of(1000, 1);

export function audioPlan(durationMs: number, offsetMs = 0): NormalisationPlan {
  return {
    version: 1,
    recipe: 1,
    kind: 'audio',
    decode: { backend: 'software', fallbackReason: { code: 'no_hardware_backend', detail: 'audio' } },
    rotation: 0,
    mirrored: false,
    hdr: 'none',
    toneMap: 'none',
    frameRate: { output: FrameRate.of(30, 1) },
    start: RationalTime.of(0, MS),
    duration: RationalTime.of(durationMs, MS),
    frames: 0,
    audio: { offset: RationalTime.of(offsetMs, MS), trimToVideo: false },
    speed: { kind: 'normal', factor: 1, retimedInFile: false },
    source: {
      width: 0,
      height: 0,
      displayWidth: 0,
      displayHeight: 0,
      colour: {},
      hdrFormats: [],
      vfr: false,
    },
    facts: {
      version: 1,
      width: 1,
      height: 1,
      orientation: 'landscape',
      variableFrameRate: false,
      hdr: 'none',
      speed: 'normal',
      speedFactor: 1,
      retimedInFile: false,
      hasAudio: true,
    },
    warnings: [],
  };
}

/** A 16 kHz mono s16 WAV of `frames` samples of a quiet tone. */
export function speechWav(frames: number): Buffer {
  return wavOf((i) => Math.round(3000 * Math.sin(i / 9)), frames);
}

/** A 16 kHz mono s16 WAV whose sample i is `sample(i)`. */
export function wavOf(sample: (i: number) => number, frames: number): Buffer {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(sample(i), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export const PASS_LOG = [
  '[Parsed_silencedetect_3 @ 0x1] silence_start: 0.5',
  '[Parsed_silencedetect_3 @ 0x1] silence_end: 1.25 | silence_duration: 0.75',
  '[Parsed_ebur128_2 @ 0x1] Summary:',
  '  Integrated loudness:',
  '    I:         -21.4 LUFS',
  '  Loudness range:',
  '    LRA:         3.2 LU',
  '  True peak:',
  '    Peak:       -2.5 dBFS',
].join('\n');

export interface FakeFfmpeg {
  readonly ctx: MediaContext;
  readonly calls: () => number;
}

/** Writes the WAV (the last argument) and the log; `hold` waits for the abort signal instead. */
export function fakePassFfmpeg(
  options: { readonly frames?: number; readonly hold?: boolean } = {},
): FakeFfmpeg {
  let calls = 0;
  const runner: ProcessRunner = async (_command, args, run) => {
    calls += 1;
    const out = args[args.length - 1] ?? '';
    await writeFile(out, speechWav(options.frames ?? 32_000));
    if (options.hold) {
      await new Promise<void>((resolve) => {
        if (run?.signal?.aborted) resolve();
        run?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return err(MediaCancelled());
    }
    run?.onStderr?.(Buffer.from(PASS_LOG));
    return ok({ exitCode: 0, signal: null, stdout: Buffer.alloc(0), stderrTail: '', durationMs: 1 });
  };
  return {
    ctx: { binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'env' }, runner },
    calls: () => calls,
  };
}
