// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The 44-byte header of a canonical PCM WAV file (16-bit, little-endian), and the length of its data in
 * milliseconds. A capture writes a zeroed header first and fills it in once the data length is known.
 */
export const WAV_HEADER_BYTES = 44;

export interface PcmFormat {
  readonly sampleRate: number;
  readonly channels: number;
  /** 16 for the capture's s16le. */
  readonly bitsPerSample: number;
}

export function wavHeader(format: PcmFormat, dataBytes: number): Buffer {
  const blockAlign = (format.channels * format.bitsPerSample) / 8;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  // 1: integer PCM.
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(format.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Whole milliseconds of `dataBytes` of PCM in this format. */
export function pcmDurationMs(format: PcmFormat, dataBytes: number): number {
  const frames = dataBytes / ((format.channels * format.bitsPerSample) / 8);
  return Math.round((frames * 1000) / format.sampleRate);
}
