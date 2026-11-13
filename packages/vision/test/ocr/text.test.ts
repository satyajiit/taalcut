// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../src/media/png';
import {
  baseLanguage,
  boxIou,
  boxUnion,
  clampBox,
  levenshtein,
  normaliseText,
  scriptOf,
  textSimilarity,
} from '../../src/ocr/text';
import { decodePng } from './helpers/png-decode';

describe('text helpers', () => {
  it('normalises to NFC with collapsed whitespace', () => {
    // 'é' as e + combining acute becomes one scalar.
    expect(normaliseText('  Café \n  au   lait ')).toBe('Café au lait');
    expect(Array.from(normaliseText('Café')).length).toBe(4);
  });

  it('measures edits over scalars', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('नमस्ते', 'नमस्ते')).toBe(0);
    expect(textSimilarity('Save 20% today', 'Save 20% today')).toBe(1);
    expect(textSimilarity('Save 20% today', 'Save 20% toda')).toBeCloseTo(1 - 1 / 14);
    expect(textSimilarity('', '')).toBe(1);
  });

  it('computes IoU, unions and clamps boxes', () => {
    const a = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const b = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    expect(boxIou(a, a)).toBe(1);
    expect(boxIou(a, b)).toBeCloseTo(0.0625 / (0.25 + 0.25 - 0.0625));
    expect(boxIou(a, { x: 0.6, y: 0.6, width: 0.1, height: 0.1 })).toBe(0);
    expect(boxIou({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 })).toBe(0);
    expect(boxUnion(a, b)).toEqual({ x: 0, y: 0, width: 0.75, height: 0.75 });
    expect(clampBox({ x: -0.1, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0.9,
      width: 0.5,
      height: 0.09999999999999998,
    });
    expect(clampBox({ x: Number.NaN, y: 0, width: 2, height: 1 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('tells scripts apart', () => {
    expect(scriptOf('नमस्ते दोस्तों')).toBe('devanagari');
    expect(scriptOf('Save 20% today')).toBe('latin');
    expect(scriptOf('Não perca')).toBe('latin');
    expect(scriptOf('₹499')).toBe('other');
    expect(scriptOf('Привет')).toBe('other');
    expect(scriptOf('कीमत ₹499 only')).toBe('devanagari');
  });

  it('takes the base language subtag', () => {
    expect(baseLanguage('pt-BR')).toBe('pt');
    expect(baseLanguage('EN')).toBe('en');
  });
});

describe('encodePng', () => {
  it('round-trips rgb24 and gray pixels', () => {
    const rgb = new Uint8Array(4 * 3 * 3).map((_, i) => (i * 37) % 256);
    const decoded = decodePng(encodePng(rgb, 4, 3, 3));
    expect([decoded.width, decoded.height]).toEqual([4, 3]);
    expect([...decoded.data]).toEqual([...rgb]);
    const gray = new Uint8Array(5 * 2).map((_, i) => i * 20);
    const g = decodePng(encodePng(gray, 5, 2, 1));
    expect([...g.data].filter((_, i) => i % 3 === 0)).toEqual([...gray]);
  });

  it('writes a valid stream and refuses bad sizes', () => {
    const png = encodePng(new Uint8Array(3), 1, 1);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    const idatAt = png.indexOf('IDAT');
    const length = png.readUInt32BE(idatAt - 4);
    expect(inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length)).length).toBe(4);
    expect(() => encodePng(new Uint8Array(3), 0, 1)).toThrow(RangeError);
    expect(() => encodePng(new Uint8Array(2), 1, 1)).toThrow(RangeError);
  });
});
