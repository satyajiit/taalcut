// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `listOf`, the kit's one way to join a list in a sentence: the active Lingui locale's own "and" and commas
 * (Intl.ListFormat), never an English join, and no English "and" in the pseudo-locale.
 */
import { describe, expect, it } from 'vitest';
import { listOf } from '../src/index';

const two = ['Camera motion', 'Picture quality'];
const three = ['Agent', 'Seeing your clips', 'Voice-over'];

describe('listOf', () => {
  it.each([
    ['en', 'Camera motion and Picture quality', 'Agent, Seeing your clips, and Voice-over'],
    ['es', 'Camera motion y Picture quality', 'Agent, Seeing your clips y Voice-over'],
    ['pt-BR', 'Camera motion e Picture quality', 'Agent, Seeing your clips e Voice-over'],
    ['hi', 'Camera motion और Picture quality', 'Agent, Seeing your clips, और Voice-over'],
  ])('joins items the %s way', (locale, ofTwo, ofThree) => {
    expect(listOf({ locale }, two)).toBe(ofTwo);
    expect(listOf({ locale }, three)).toBe(ofThree);
  });

  it('leaves one item alone and nothing empty', () => {
    expect(listOf({ locale: 'es' }, ['Agent'])).toBe('Agent');
    expect(listOf({ locale: 'es' }, [])).toBe('');
  });

  it('gives the pseudo-locale commas, with no English "and" to flag', () => {
    expect(listOf({ locale: 'en-XA' }, three)).toBe('Agent, Seeing your clips, Voice-over');
    expect(listOf({ locale: 'en-XA' }, two)).not.toMatch(/\band\b/);
  });
});
