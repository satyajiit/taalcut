// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WAV in and out for the parity clips: 32-bit float for generated clips (exact, never committed) and 16-bit PCM
 * for the committed SFX renders. Decoding follows FFmpeg's conversion to float (int16 / 32768), the samples
 * upstream earshot read.
 */

/** RIFF/WAVE bytes for planar float channels; format 'f32' (IEEE float) or 's16' (PCM, rounded and clamped). */
export function encodeWav({ sampleRate, channels, format = 'f32' }) {
  const ch = channels.length;
  const n = channels[0]?.length ?? 0;
  const bytes = format === 'f32' ? 4 : 2;
  const data = n * ch * bytes;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(format === 'f32' ? 3 : 1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * bytes, 28);
  buf.writeUInt16LE(ch * bytes, 32);
  buf.writeUInt16LE(bytes * 8, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  let at = 44;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const v = channels[c][i];
      if (format === 'f32') buf.writeFloatLE(v, at);
      else buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), at);
      at += bytes;
    }
  }
  return buf;
}

/** Planar Float32Array channels from WAV bytes (PCM 16 / 24 / 32-bit or IEEE float 32), as FFmpeg decodes them. */
export function decodeWav(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      let code = buf.readUInt16LE(body);
      if (code === 0xfffe) code = buf.readUInt16LE(body + 24);
      fmt = {
        code,
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before its fmt chunk');
      return readFrames(buf, body, Math.min(size, buf.length - body), fmt);
    }
    at = body + size + (size % 2);
  }
  throw new Error('WAV without a data chunk');
}

function readFrames(buf, from, size, fmt) {
  const width = fmt.bits / 8;
  const n = Math.floor(size / (width * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(n));
  let at = from;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < fmt.channels; c += 1) {
      channels[c][i] = sample(buf, at, fmt);
      at += width;
    }
  }
  return { sampleRate: fmt.sampleRate, channels };
}

function sample(buf, at, fmt) {
  if (fmt.code === 3 && fmt.bits === 32) return buf.readFloatLE(at);
  if (fmt.code !== 1) throw new Error(`WAV format ${fmt.code} / ${fmt.bits}-bit is not supported`);
  if (fmt.bits === 16) return buf.readInt16LE(at) / 32768;
  if (fmt.bits === 24) return buf.readIntLE(at, 3) / 8388608;
  if (fmt.bits === 32) return buf.readInt32LE(at) / 2147483648;
  throw new Error(`${fmt.bits}-bit PCM is not supported`);
}
