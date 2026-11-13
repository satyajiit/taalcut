// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WAV PCM16 encoding and character-timing alignment for local Chatterbox synthesis (WP-VO-LOCAL).
 *
 * `@taalcut/audio` groups `CharacterAlignment` into word timings on whitespace boundaries (`alignWords` in
 * `packages/audio/src/voice/alignment.ts`). When an on-device ASR aligner (Parakeet or Whisper) supplies word
 * timestamps for the synthesised waveform, `buildCharacterAlignment` distributes each word's `[startSeconds,
 * endSeconds]` across its characters; otherwise it distributes timings proportionally across the spoken text.
 */
import type { CharacterAlignment } from '@taalcut/core';

export interface AlignedWordTiming {
  readonly word: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/** Encodes mono Float32 PCM samples `[-1, 1]` into a 16-bit little-endian RIFF/WAVE byte array (`audio/wav`). */
export function encodeWavPcm16(pcm: Float32Array, sampleRate: number): Uint8Array {
  const rate = Math.max(8_000, Math.floor(sampleRate));
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // Byte rate (mono 16-bit)
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < pcm.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(44 + i * 2, int16, true);
  }
  return new Uint8Array(buffer);
}

/**
 * Builds core's `CharacterAlignment` for `text` over `durationSeconds`. If `words` from local ASR alignment are
 * provided and match the token count, each word's span is subdivided across its characters; otherwise timings are
 * distributed proportionally by character weight.
 */
export function buildCharacterAlignment(
  text: string,
  durationSeconds: number,
  words?: readonly AlignedWordTiming[],
): CharacterAlignment {
  const total = Math.max(0.05, Number.isFinite(durationSeconds) ? durationSeconds : 0.05);
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { characters: [], startSeconds: [], endSeconds: [] };
  }

  const characters: string[] = [];
  const startSeconds: number[] = [];
  const endSeconds: number[] = [];

  const pushSpan = (word: string, start: number, end: number, addTrailingSpace: boolean) => {
    const glyphs = Array.from(word);
    const span = Math.max(0.005, end - start);
    const step = span / Math.max(1, glyphs.length);
    glyphs.forEach((char, idx) => {
      characters.push(char);
      startSeconds.push(Number((start + idx * step).toFixed(4)));
      endSeconds.push(Number((start + (idx + 1) * step).toFixed(4)));
    });
    if (addTrailingSpace) {
      characters.push(' ');
      startSeconds.push(Number(end.toFixed(4)));
      endSeconds.push(Number(end.toFixed(4)));
    }
  };

  if (words && words.length === tokens.length) {
    tokens.forEach((token, index) => {
      const aligned = words[index]!;
      const start = Math.max(0, aligned.startSeconds);
      const end = Math.max(start + 0.005, aligned.endSeconds);
      pushSpan(token, start, end, index < tokens.length - 1);
    });
    return { characters, startSeconds, endSeconds };
  }

  const weights = tokens.map((token) => Math.max(1, Array.from(token).length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let cursor = 0;
  tokens.forEach((token, index) => {
    const share = (weights[index]! / totalWeight) * total;
    const gap = index < tokens.length - 1 ? Math.min(0.02, share * 0.1) : 0;
    const start = cursor;
    const end = cursor + Math.max(0.005, share - gap);
    pushSpan(token, start, end, index < tokens.length - 1);
    cursor += share;
  });
  return { characters, startSeconds, endSeconds };
}
