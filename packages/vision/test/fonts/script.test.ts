// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Script of an OCR string: Devanagari wins, digits are Latin, symbols are withheld. */
import { describe, expect, it } from 'vitest';
import { scriptOf } from '../../src/fonts/script';

describe('scriptOf', () => {
  it('reads Hindi as Devanagari', () => {
    expect(scriptOf('नमस्ते')).toBe('devanagari');
  });

  it('reads Latin letters as Latin', () => {
    expect(scriptOf('Hello')).toBe('latin');
  });

  it('reads digits as Latin', () => {
    expect(scriptOf('123')).toBe('latin');
  });

  it('prefers Devanagari when the string is mixed', () => {
    expect(scriptOf('Hello नमस्ते')).toBe('devanagari');
  });

  it('withholds an empty string', () => {
    expect(scriptOf('')).toBeNull();
  });

  it('withholds symbols with no letters or digits', () => {
    expect(scriptOf('---')).toBeNull();
  });
});
