// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The microphone's samples as main's voice capture takes them (core's voiceCaptureContract): 16-bit mono PCM at
 * 48 kHz, little-endian, base64 in numbered chunks of at most VOICE_CAPTURE_CHUNK_BASE64 characters. Also the
 * level the consent card's meter shows. Pure.
 */

export const CAPTURE_SAMPLE_RATE = 48_000;
/** A quarter of a second per chunk: 24 000 bytes, 32 000 base64 characters (the contract allows 350 000). */
export const CHUNK_SAMPLES = 12_000;

/** Float samples (-1 to 1) as 16-bit integers, clipped. */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return pcm;
}

/** 16-bit samples as little-endian bytes in base64. */
export function pcmBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  pcm.forEach((sample, i) => view.setInt16(i * 2, sample, true));
  let binary = '';
  // In slices: String.fromCharCode takes its arguments on the stack.
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** How loud a block is for a meter: its RMS in dBFS, -60 dB (silence) to 0 dB mapped to 0 to 1. */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** Gathers samples into chunks of `size`; `flush` sends what is left (a shorter last chunk). */
export function createChunker(size: number, emit: (pcm: Int16Array) => void) {
  let buffer = new Float32Array(size);
  let filled = 0;
  return {
    push(samples: Float32Array) {
      let offset = 0;
      while (offset < samples.length) {
        const take = Math.min(size - filled, samples.length - offset);
        buffer.set(samples.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === size) {
          emit(toPcm16(buffer));
          buffer = new Float32Array(size);
          filled = 0;
        }
      }
    },
    flush() {
      if (filled === 0) return;
      emit(toPcm16(buffer.subarray(0, filled)));
      buffer = new Float32Array(size);
      filled = 0;
    },
  };
}
