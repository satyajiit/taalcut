// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 5×7 bitmap, one row of five `0`/`1` characters. The bundled ffmpeg has no
 * drawtext, so synthetic words are painted here and encoded as ffv1.
 * Hindi, Spanish and Portuguese queries still use these ASCII stand-in words.
 */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

/** Dark frame with a white word. Unknown letters are skipped. */
export function paintWord(word: string, width = 64, height = 32): Buffer {
  const frame = Buffer.alloc(width * height * 3, 32);
  let cursor = 2;
  for (const char of word.toUpperCase()) {
    const rows = GLYPHS[char];
    if (rows === undefined) continue;
    rows.forEach((bits, row) => {
      for (let col = 0; col < 5; col += 1) {
        if (bits[col] !== '1') continue;
        const x = cursor + col;
        const y = 8 + row;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const offset = (y * width + x) * 3;
        frame[offset] = 255;
        frame[offset + 1] = 255;
        frame[offset + 2] = 255;
      }
    });
    cursor += 6;
  }
  return frame;
}
