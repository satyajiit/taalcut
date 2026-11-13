// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { searchTerms } from '../src';

describe('searchTerms', () => {
  it('drops the stopwords of each v1 language and keeps a Devanagari word whole', () => {
    expect(searchTerms('Sunset shots on the beach')).toEqual(['sunset', 'beach']);
    expect(searchTerms('समुद्र तट पर सूर्यास्त')).toEqual(['समुद्र', 'तट', 'सूर्यास्त']);
    expect(searchTerms('atardecer en la playa')).toEqual(['atardecer', 'playa']);
    expect(searchTerms('pôr do sol na praia')).toEqual(['pôr', 'sol', 'praia']);
  });

  it('keeps the stopwords when nothing else is left, each term once, at most 32', () => {
    expect(searchTerms('the the')).toEqual(['the']);
    expect(searchTerms('A close-up hook with text on screen')).toEqual([
      'close',
      'up',
      'hook',
      'text',
      'screen',
    ]);
    expect(searchTerms('!!!')).toEqual([]);
    expect(searchTerms(Array.from({ length: 40 }, (_, n) => `w${n}`).join(' '))).toHaveLength(32);
  });
});
