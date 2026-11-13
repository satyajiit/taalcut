// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The asset's speech PCM on disk: the 16 kHz mono 16-bit WAV the audio pass writes. Read in chunks (an hour is
 * 115 MB, so it never sits in memory whole) as float samples for the VAD, and cut into small WAVs (the
 * language-ID window) by copying sample bytes. The header is parsed, not assumed: FFmpeg may put a LIST chunk
 * before `data`.
 */
import { open, writeFile } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { AudioWriteFailed, NoAudio } from '../errors';

export const SPEECH_RATE = 16_000;
const BYTES_PER_FRAME = 2;
/** RIFF header, then chunks; anything past this without a `data` chunk is not a WAV we wrote. */
const HEADER_SCAN_BYTES = 4096;

export interface SpeechPcm {
  readonly path: string;
  readonly sampleRate: typeof SPEECH_RATE;
  /** Byte offset of the first sample. */
  readonly dataOffset: number;
  readonly frames: number;
  readonly durationMs: number;
}

function unreadable(path: string, detail: string) {
  return err(NoAudio({ name: path }, { detail }));
}

/** The header of a 16 kHz mono s16le WAV, or `audio.no_audio` saying what is wrong with it. */
export async function readSpeechPcm(path: string): AsyncResult<SpeechPcm> {
  let head: Buffer;
  let size: number;
  try {
    const file = await open(path, 'r');
    try {
      size = (await file.stat()).size;
      const buffer = Buffer.alloc(Math.min(HEADER_SCAN_BYTES, size));
      await file.read(buffer, 0, buffer.length, 0);
      head = buffer;
    } finally {
      await file.close();
    }
  } catch (cause) {
    return unreadable(path, cause instanceof Error ? cause.message : 'unreadable');
  }
  if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE')
    return unreadable(path, 'not a RIFF/WAVE file');
  let at = 12;
  let format: { channels: number; rate: number; bits: number } | undefined;
  while (at + 8 <= head.length) {
    const id = head.toString('ascii', at, at + 4);
    const length = head.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= head.length) {
      format = {
        channels: head.readUInt16LE(body + 2),
        rate: head.readUInt32LE(body + 4),
        bits: head.readUInt16LE(body + 14),
      };
    }
    if (id === 'data') {
      if (!format || format.channels !== 1 || format.rate !== SPEECH_RATE || format.bits !== 16)
        return unreadable(path, `expected 16 kHz mono 16-bit PCM, got ${JSON.stringify(format ?? null)}`);
      // FFmpeg fills the size in when it closes the file; a size past the end (or 0xFFFFFFFF) means "to the end".
      const bytes = Math.min(length, size - body);
      const frames = Math.floor(bytes / BYTES_PER_FRAME);
      return ok({
        path,
        sampleRate: SPEECH_RATE,
        dataOffset: body,
        frames,
        durationMs: (frames * 1000) / SPEECH_RATE,
      });
    }
    at = body + length + (length % 2);
  }
  return unreadable(path, 'no data chunk');
}

export function msToFrame(ms: number): number {
  return Math.max(0, Math.round((ms * SPEECH_RATE) / 1000));
}

/**
 * Float samples (−1..1) of frames [start, end), `chunkFrames` at a time. Stops early when the signal aborts;
 * the caller checks it.
 */
export async function* readPcmChunks(
  pcm: SpeechPcm,
  range: { readonly startFrame: number; readonly endFrame: number },
  chunkFrames: number,
  signal?: AbortSignal,
): AsyncGenerator<Float32Array> {
  const start = Math.max(0, Math.min(pcm.frames, range.startFrame));
  const end = Math.max(start, Math.min(pcm.frames, range.endFrame));
  const file = await open(pcm.path, 'r');
  try {
    const bytes = Buffer.alloc(chunkFrames * BYTES_PER_FRAME);
    for (let frame = start; frame < end; frame += chunkFrames) {
      if (signal?.aborted) return;
      const count = Math.min(chunkFrames, end - frame);
      const read = await file.read(
        bytes,
        0,
        count * BYTES_PER_FRAME,
        pcm.dataOffset + frame * BYTES_PER_FRAME,
      );
      const got = Math.floor(read.bytesRead / BYTES_PER_FRAME);
      const samples = new Float32Array(got);
      for (let i = 0; i < got; i++) samples[i] = bytes.readInt16LE(i * BYTES_PER_FRAME) / 32768;
      yield samples;
      if (got < count) return;
    }
  } finally {
    await file.close();
  }
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SPEECH_RATE, 24);
  header.writeUInt32LE(SPEECH_RATE * BYTES_PER_FRAME, 28);
  header.writeUInt16LE(BYTES_PER_FRAME, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Frames [start, end) of the PCM as their own WAV at `out`: the same samples, byte for byte. */
export async function writePcmRange(
  pcm: SpeechPcm,
  range: { readonly startMs: number; readonly endMs: number },
  out: string,
): AsyncResult<string> {
  const start = Math.min(pcm.frames, msToFrame(range.startMs));
  const end = Math.max(start, Math.min(pcm.frames, msToFrame(range.endMs)));
  const body = Buffer.alloc((end - start) * BYTES_PER_FRAME);
  try {
    const file = await open(pcm.path, 'r');
    try {
      await file.read(body, 0, body.length, pcm.dataOffset + start * BYTES_PER_FRAME);
    } finally {
      await file.close();
    }
    await writeFile(out, Buffer.concat([wavHeader(body.length), body]));
  } catch (cause) {
    return err(
      AudioWriteFailed(undefined, {
        detail: cause instanceof Error ? cause.message.slice(0, 300) : 'write failed',
      }),
    );
  }
  return ok(out);
}
