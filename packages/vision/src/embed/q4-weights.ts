// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 4-bit weights to fp16, bit for bit as numpy writes them (IX3-N3): the arithmetic of the Core ML component's weight
 * recipe (coreml-weights.ts), q4_surgery.py's `(code - zero) * scale` in float32, then `astype(float16)`.
 */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A float32 value's nearest fp16 bit pattern (ties to even), as numpy's `astype(float16)`. */
export function halfBits(value: number): number {
  f32[0] = value;
  const bits = u32[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa === 0 ? 0 : 0x200);
  const e = exponent - 112;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) return sign | roundShift(mantissa | 0x800000, 14 - e);
  return sign | ((e << 10) + roundShift(mantissa, 13));
}

/** `value >> shift`, rounded to nearest, ties to even; 0 past 24 bits. */
function roundShift(value: number, shift: number): number {
  if (shift > 24) return 0;
  const kept = value >>> shift;
  const rest = value - kept * 2 ** shift;
  const half = 2 ** (shift - 1);
  return rest > half || (rest === half && kept % 2 === 1) ? kept + 1 : kept;
}

/** An fp16 bit pattern's value. */
export function halfValue(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

export interface Q4Matrix {
  readonly rows: number;
  readonly columns: number;
  readonly block: number;
  /** rows × columns/2 bytes, two codes a byte, the low nibble first. */
  readonly codes: Uint8Array;
  /** rows × columns/block scales. */
  readonly scales: Float32Array;
  /** rows × ceil(blocks/2) bytes of 4-bit zero points, the low nibble first; null: 8. */
  readonly zeros: Uint8Array | null;
}

/** The fp16 matrix (bit patterns, row-major) of 4-bit codes: fp16(scale × (code − zero)), the product in float32. */
export function dequantiseQ4(m: Q4Matrix): Uint16Array {
  const blocks = m.columns / m.block;
  const zeroRow = Math.ceil(blocks / 2);
  const out = new Uint16Array(m.rows * m.columns);
  const table = new Uint16Array(16);
  for (let r = 0; r < m.rows; r += 1) {
    for (let b = 0; b < blocks; b += 1) {
      const packed = m.zeros?.[r * zeroRow + (b >> 1)] ?? 0x88;
      const zero = b % 2 === 0 ? packed & 15 : packed >> 4;
      const scale = m.scales[r * blocks + b] ?? 0;
      for (let code = 0; code < 16; code += 1) table[code] = halfBits(Math.fround((code - zero) * scale));
      const start = r * m.columns + b * m.block;
      for (let i = 0; i < m.block; i += 2) {
        const byte = m.codes[(start + i) >> 1] ?? 0;
        out[start + i] = table[byte & 15] ?? 0;
        out[start + i + 1] = table[byte >> 4] ?? 0;
      }
    }
  }
  return out;
}

/** Little-endian float32 or fp16 scales as float32 values. */
export function scalesOf(bytes: Uint8Array, type: 'f32' | 'f16'): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = type === 'f32' ? 4 : 2;
  const out = new Float32Array(bytes.byteLength / width);
  for (let i = 0; i < out.length; i += 1)
    out[i] = type === 'f32' ? view.getFloat32(i * 4, true) : halfValue(view.getUint16(i * 2, true));
  return out;
}
