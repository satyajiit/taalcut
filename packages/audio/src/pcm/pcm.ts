// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Planar float PCM in memory: what Phase 3's audio work (stretching, metering, voice activity) reads and
 * writes. One Float32Array per channel, all the same length.
 */
export interface Pcm {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export function pcmFrames(pcm: Pcm): number {
  return pcm.channels[0]?.length ?? 0;
}

export function pcmDurationMs(pcm: Pcm): number {
  return pcm.sampleRate > 0 ? (pcmFrames(pcm) * 1000) / pcm.sampleRate : 0;
}

/** Interleaved little-endian f32 (FFmpeg's `f32le`) → planar. A trailing partial frame is dropped. */
export function fromInterleaved(bytes: Buffer, channelCount: number, sampleRate: number): Pcm {
  const frameBytes = 4 * channelCount;
  const frames = Math.floor(bytes.length / frameBytes);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const target = channels[channel];
      if (target) target[frame] = bytes.readFloatLE(frame * frameBytes + channel * 4);
    }
  }
  return { sampleRate, channels };
}

/** A 32-bit float WAV (WAVE_FORMAT_IEEE_FLOAT) of the PCM, interleaved. */
export function encodeFloatWav(pcm: Pcm): Buffer {
  const channelCount = pcm.channels.length;
  const frames = pcmFrames(pcm);
  const dataBytes = frames * channelCount * 4;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(3, 20);
  out.writeUInt16LE(channelCount, 22);
  out.writeUInt32LE(pcm.sampleRate, 24);
  out.writeUInt32LE(pcm.sampleRate * channelCount * 4, 28);
  out.writeUInt16LE(channelCount * 4, 32);
  out.writeUInt16LE(32, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of pcm.channels) {
      out.writeFloatLE(channel[frame] ?? 0, offset);
      offset += 4;
    }
  }
  return out;
}
