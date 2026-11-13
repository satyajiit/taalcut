// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CAPTURE_SAMPLE_RATE, toPcm16 } from './pcm';

/** An ephemeral local playback copy. The durable WAV is written by main from the same samples. */
export function recordingPreview(chunks: readonly Float32Array[]): Blob {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CAPTURE_SAMPLE_RATE, true);
  view.setUint32(28, CAPTURE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  let at = 44;
  for (const chunk of chunks)
    for (const sample of toPcm16(chunk)) {
      view.setInt16(at, sample, true);
      at += 2;
    }
  return new Blob([bytes], { type: 'audio/wav' });
}
